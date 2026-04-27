import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QPointOrder, QPointOrderStatus, QPointOrderType } from '../entities/q-point-order.entity';
import { OrderBookService, FIXED_QP_PRICE } from './order-book.service';
import { MarketBalanceService } from './market-balance.service';

export interface AIConfig {
  enabled: boolean;
  participantUserId: string;
  targetInventory: number;
  minInventory: number;
  maxInventory: number;
  orderBaseQty: number;
  maxOrderQty: number;
  maxOpenOrders: number;
  orderTtlSeconds: number;
  runIntervalSeconds: number;
  minCashReserveUsd: number;
}

/**
 * AI Participant Service — §5.2 of the Q Points Terms of Service
 *
 * The AI Participant is an ORDINARY USER of the order book.
 * Per the Q Points ToS §5.2 and the fixed-peg final clause:
 *
 *   - Maintains standing BUY and SELL orders at $1.00 as an operational
 *     last-resort service — filling only when no peer counterparty matches first.
 *   - Does NOT act as a dynamic market maker or price stabilizer —
 *     the price is fixed by the Terms, not by this service.
 *   - Trades solely for the Company's own operational purposes.
 *   - Is subject to the same matching rules, order types, and limitations
 *     as any other User.
 *
 * Standing orders are an operational commitment, NOT a legal guarantee
 * of redemption or liquidity (see ToS §6.1).
 */
/** Minimum quantity for the last-resort standing orders (TOS §5.2, operational). */
const MIN_STANDBY_QTY = 1_000;

@Injectable()
export class AiParticipantService {
  private readonly logger = new Logger(AiParticipantService.name);
  private readonly cfg: AIConfig;

  /** Circuit-breaker state */
  private ordersPlacedThisMinute = 0;
  private circuitBreakerResetAt: Date = new Date();
  private circuitBreakerOpen = false;
  /** Hard cap: prevents the AI Participant from placing bursts of orders
   *  that could be construed as market manipulation (TOS §8). */
  private readonly MAX_ORDERS_PER_MINUTE = 20;

  constructor(
    @InjectRepository(QPointOrder)
    private readonly orderRepo: Repository<QPointOrder>,
    private readonly orderBook: OrderBookService,
    private readonly balance: MarketBalanceService,
    private readonly config: ConfigService,
  ) {
    this.cfg = {
      enabled: config.get<boolean>('ai.market.enabled') ?? true, // On by default: maintains last-resort standing orders per TOS §5.2 operational commitment
      participantUserId:
        config.get<string>('ai.market.participantUserId') ?? '00000000-0000-0000-0000-000000000001',
      targetInventory: config.get<number>('ai.market.targetInventory') ?? 50_000,
      minInventory: config.get<number>('ai.market.minInventory') ?? 10_000,
      maxInventory: config.get<number>('ai.market.maxInventory') ?? 100_000,
      // targetSpreadPct intentionally omitted — price is fixed at $1.00 per TOS final clause.
      // The AI Participant maintains last-resort standing orders at $1.00 (TOS §5.2 operational, not legal).
      orderBaseQty: config.get<number>('ai.market.orderBaseQty') ?? 500,
      maxOrderQty: config.get<number>('ai.market.maxOrderQty') ?? 2_500,
      maxOpenOrders: config.get<number>('ai.market.maxOpenOrders') ?? 10,
      orderTtlSeconds: config.get<number>('ai.market.orderTtlSeconds') ?? 300,
      runIntervalSeconds: config.get<number>('ai.market.runIntervalSeconds') ?? 30,
      minCashReserveUsd: config.get<number>('ai.market.minCashReserveUsd') ?? 5_000,
    };
  }

  // =====================================================================
  // Scheduled runner
  // =====================================================================

  /**
   * Runs every 5 seconds.
   *
   * Phase 1 (ALWAYS, not circuit-breaker-gated):
   *   _ensureStandingOrders() — places last-resort BUY + SELL standing orders if none open.
   *   This fulfils the TOS §5.2 operational commitment. Peers are matched first;
   *   the AI fills only when no peer counterparty is available at $1.00.
   *
   * Phase 2 (circuit-breaker-gated):
   *   _runInternal() — inventory management (acquire/release excess QP).
   */
  // Note: disabling the AI Participant suspends last-resort liquidity, which is an
  // operational breach of TOS §5.2. It is NOT a legal obligation (see TOS §6.1).
  @Cron('*/5 * * * * *')
  async run(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn(
        'AI Participant is administratively disabled. ' +
        'Last-resort standing orders will NOT be maintained (TOS §5.2 operational commitment suspended). ' +
        'This is not a legal breach but is operationally undesirable. ' +
        'Use POST /qpoints/admin/trading/suspend for compliant maintenance windows.',
      );
      return;
    }

    // Phase 1 — ALWAYS ensure last-resort standing orders exist (TOS §5.2 operational commitment)
    try {
      await this._ensureStandingOrders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Participant: _ensureStandingOrders FAILED: ${msg}`);
    }

    // Phase 2 — Inventory management (circuit-breaker-gated)
    this._resetCircuitBreakerIfNeeded();
    if (this.circuitBreakerOpen) {
      this.logger.warn('AI Participant: circuit breaker OPEN – skipping inventory management');
      return;
    }

    try {
      await this._runInternal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Participant inventory run failed: ${msg}`);
    }
  }

  // =====================================================================
  // Core algorithm
  // =====================================================================

  private async _runInternal(): Promise<void> {
    const { balance: platformQP } = await this.balance.getBalance(this.cfg.participantUserId);

    const currentAiOrders = await this._getAiOpenOrders();

    this.logger.log(
      `AI Participant run (§5.2): qp_balance=${platformQP}, price=${FIXED_QP_PRICE} (fixed $1.00 peg), openOrders=${currentAiOrders.length}`,
    );

    // ---- 1. Cancel stale orders ----------------------------------------
    await this._cancelStaleOrders(currentAiOrders);

    // Refresh after cancellation
    const activeOrders = await this._getAiOpenOrders();
    if (activeOrders.length >= this.cfg.maxOpenOrders) {
      this.logger.log('AI Participant: max open orders reached – no new orders this cycle');
      return;
    }

    // ---- 2. Inventory management ----------------------------------------
    //  Ensure the platform's QP balance stays within configured bounds,
    //  on TOP of the last-resort standing orders already placed in Phase 1.
    if (platformQP < this.cfg.minInventory) {
      // Need to buy more QP at the fixed price
      const qty = this._calcQty(platformQP, 'buy');
      if (qty > 0) {
        await this._placeOrder(QPointOrderType.BUY, FIXED_QP_PRICE, qty);
      }
    } else if (platformQP > this.cfg.maxInventory) {
      // Need to sell excess QP at the fixed price
      const qty = this._calcQty(platformQP, 'sell');
      if (qty > 0) {
        await this._placeOrder(QPointOrderType.SELL, FIXED_QP_PRICE, qty);
      }
    }

    // ---- 3. Spread management ------------------------------------------
    // Not applicable: price is fixed at $1.00 per TOS final clause.
    // Last-resort standing orders at $1.00 are maintained by _ensureStandingOrders().
  }

  // =====================================================================
  // TOS §5.2 Last-Resort Standing Orders (operational, not legal guarantee)
  // =====================================================================

  /**
   * Ensures at least one open BUY and one open SELL standing order exists
   * for the AI Participant at the fixed price of $1.00.
   *
   * These are last-resort orders: standard price-time priority means
   * peer-to-peer orders at the same price are matched first. The AI
   * fills only when no peer counterparty is available.
   *
   * NOT circuit-breaker-gated — this is the TOS §5.2 operational commitment
   * (not a legal guarantee; see TOS §6.1).
   */
  private async _ensureStandingOrders(): Promise<void> {
    const openOrders = await this._getAiOpenOrders();
    const hasOpenBuy = openOrders.some((o) => o.type === QPointOrderType.BUY);
    const hasOpenSell = openOrders.some((o) => o.type === QPointOrderType.SELL);

    if (!hasOpenBuy) {
      await this._placeStandingOrder(QPointOrderType.BUY, MIN_STANDBY_QTY);
    }
    if (!hasOpenSell) {
      await this._placeStandingOrder(QPointOrderType.SELL, MIN_STANDBY_QTY);
    }
  }

  /**
   * Places a last-resort standing order (BUY or SELL) at the fixed price.
   * NOT circuit-breaker-gated — this fulfils the TOS §5.2 operational commitment.
   * Peer orders at the same price are matched first (price-time priority).
   * This is operationally available but not a legal guarantee (see TOS §6.1).
   */
  private async _placeStandingOrder(type: QPointOrderType, quantity: number): Promise<void> {
    const price = parseFloat(FIXED_QP_PRICE.toFixed(4));
    const qty = parseFloat(quantity.toFixed(4));
    this.logger.log(
      `AI Participant placing last-resort ${type} standing order (TOS §5.2, operational): price=${price}, qty=${qty}`,
    );
    try {
      await this.orderBook.createOrder(this.cfg.participantUserId, type, price, qty);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI standing order (${type}) placement failed: ${msg}`);
    }
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  private _calcQty(currentBalance: number, direction: 'buy' | 'sell'): number {
    const delta =
      direction === 'buy'
        ? this.cfg.targetInventory - currentBalance
        : currentBalance - this.cfg.targetInventory;

    const qty = Math.min(this.cfg.maxOrderQty, Math.abs(delta) / 2);
    return qty < 0.0001 ? 0 : parseFloat(qty.toFixed(4));
  }

  private async _placeOrder(type: QPointOrderType, price: number, quantity: number): Promise<void> {
    this._incrementCircuitBreaker();
    if (this.circuitBreakerOpen) return;

    price = parseFloat(price.toFixed(4));
    quantity = parseFloat(quantity.toFixed(4));

    this.logger.log(`AI Participant placing ${type} order for operational purposes (§5.1): price=${price}, qty=${quantity}`);

    try {
      await this.orderBook.createOrder(this.cfg.participantUserId, type, price, quantity);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI order placement failed: ${msg}`);
    }
  }

  private async _getAiOpenOrders(): Promise<QPointOrder[]> {
    return this.orderRepo.find({
      where: {
        userId: this.cfg.participantUserId,
        status: QPointOrderStatus.OPEN,
      },
    });
  }

  private async _cancelStaleOrders(orders: QPointOrder[]): Promise<void> {
    const ttlMs = this.cfg.orderTtlSeconds * 1000;
    const now = Date.now();

    for (const o of orders) {
      if (now - o.createdAt.getTime() > ttlMs) {
        this.logger.log(`AI cancelling stale order ${o.id}`);
        try {
          await this.orderBook.cancelOrder(o.id, this.cfg.participantUserId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to cancel stale AI order ${o.id}: ${msg}`);
        }
      }
    }
  }

  private _incrementCircuitBreaker(): void {
    this.ordersPlacedThisMinute++;
    if (this.ordersPlacedThisMinute >= this.MAX_ORDERS_PER_MINUTE) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerResetAt = new Date(Date.now() + 60_000);
      this.logger.error('AI circuit breaker TRIPPED – too many orders placed in one minute');
    }
  }

  private _resetCircuitBreakerIfNeeded(): void {
    if (this.circuitBreakerOpen && Date.now() > this.circuitBreakerResetAt.getTime()) {
      this.circuitBreakerOpen = false;
      this.ordersPlacedThisMinute = 0;
      this.logger.log('AI circuit breaker RESET');
    }

    // Rolling count – reset every minute regardless
    if (!this.circuitBreakerOpen && Date.now() > this.circuitBreakerResetAt.getTime()) {
      this.ordersPlacedThisMinute = 0;
      this.circuitBreakerResetAt = new Date(Date.now() + 60_000);
    }
  }

  // =====================================================================
  // Admin API
  // =====================================================================

  getStatus(): {
    enabled: boolean;
    /** True when the service is enabled and last-resort standing orders are being maintained (TOS §5.2 operational). */
    standingOrdersActive: boolean;
    circuitBreakerOpen: boolean;
    ordersPlacedThisMinute: number;
    config: AIConfig;
  } {
    return {
      enabled: this.cfg.enabled,
      // Operational last-resort standing orders are active whenever the service is enabled.
      // This is NOT a legal guarantee of liquidity or redemption (see TOS §6.1).
      standingOrdersActive: this.cfg.enabled,
      circuitBreakerOpen: this.circuitBreakerOpen,
      ordersPlacedThisMinute: this.ordersPlacedThisMinute,
      config: this.cfg,
    };
  }

  setEnabled(enabled: boolean): void {
    (this.cfg as { enabled: boolean }).enabled = enabled;
    this.logger.log(`AI Participant (§5.2): enabled=${enabled}`);
  }
}
