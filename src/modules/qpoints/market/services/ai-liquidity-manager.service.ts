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
  targetSpreadPct: number;
  orderBaseQty: number;
  maxOrderQty: number;
  maxOpenOrders: number;
  orderTtlSeconds: number;
  runIntervalSeconds: number;
  minCashReserveUsd: number;
}

@Injectable()
export class AiLiquidityManagerService {
  private readonly logger = new Logger(AiLiquidityManagerService.name);
  private readonly cfg: AIConfig;

  /** Circuit-breaker state */
  private ordersPlacedThisMinute = 0;
  private circuitBreakerResetAt: Date = new Date();
  private circuitBreakerOpen = false;
  private readonly MAX_ORDERS_PER_MINUTE = 20;

  constructor(
    @InjectRepository(QPointOrder)
    private readonly orderRepo: Repository<QPointOrder>,
    private readonly orderBook: OrderBookService,
    private readonly balance: MarketBalanceService,
    private readonly config: ConfigService,
  ) {
    this.cfg = {
      enabled: config.get<boolean>('ai.market.enabled') ?? false,
      participantUserId:
        config.get<string>('ai.market.participantUserId') ?? '00000000-0000-0000-0000-000000000001',
      targetInventory: config.get<number>('ai.market.targetInventory') ?? 50_000,
      minInventory: config.get<number>('ai.market.minInventory') ?? 10_000,
      maxInventory: config.get<number>('ai.market.maxInventory') ?? 100_000,
      targetSpreadPct: config.get<number>('ai.market.targetSpreadPct') ?? 2.0,
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

  /** Runs every 30 s (configurable via cron, defaulting to every 30 s). */
  @Cron('*/30 * * * * *')
  async run(): Promise<void> {
    if (!this.cfg.enabled) return;

    this._resetCircuitBreakerIfNeeded();
    if (this.circuitBreakerOpen) {
      this.logger.warn('AI Liquidity Manager: circuit breaker OPEN – skipping run');
      return;
    }

    try {
      await this._runInternal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI Liquidity Manager run failed: ${msg}`);
    }
  }

  // =====================================================================
  // Core algorithm
  // =====================================================================

  private async _runInternal(): Promise<void> {
    const { balance: platformQP } = await this.balance.getBalance(this.cfg.participantUserId);

    const currentAiOrders = await this._getAiOpenOrders();

    this.logger.log(
      `AI run: qp_balance=${platformQP}, price=${FIXED_QP_PRICE} (fixed), openOrders=${currentAiOrders.length}`,
    );

    // ---- 1. Cancel stale orders ----------------------------------------
    await this._cancelStaleOrders(currentAiOrders);

    // Refresh after cancellation
    const activeOrders = await this._getAiOpenOrders();
    if (activeOrders.length >= this.cfg.maxOpenOrders) {
      this.logger.log('AI max open orders reached – no new orders this cycle');
      return;
    }

    // ---- 2. Inventory management ----------------------------------------
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

    // ---- 3. Spread tightening -------------------------------------------
    // Not applicable – price is fixed at $1.00. Skip spread tightening.
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

    this.logger.log(`AI placing ${type} order: price=${price}, qty=${quantity}`);

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
    circuitBreakerOpen: boolean;
    ordersPlacedThisMinute: number;
    config: AIConfig;
  } {
    return {
      enabled: this.cfg.enabled,
      circuitBreakerOpen: this.circuitBreakerOpen,
      ordersPlacedThisMinute: this.ordersPlacedThisMinute,
      config: this.cfg,
    };
  }

  setEnabled(enabled: boolean): void {
    (this.cfg as { enabled: boolean }).enabled = enabled;
    this.logger.log(`AI Liquidity Manager: enabled=${enabled}`);
  }
}
