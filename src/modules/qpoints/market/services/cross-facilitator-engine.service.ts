import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { QPointOrder, QPointOrderStatus, QPointOrderType } from '../entities/q-point-order.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { AiFacilitatorBalance } from '../entities/ai-facilitator-balance.entity';
import { MarketBalanceService } from './market-balance.service';
import { SettlementService } from './settlement.service';
import { MarketNotificationService } from './market-notification.service';
import { FacilitatorProvider } from './payment-facilitator.service';
import { RevenueService } from '@modules/revenue/revenue.service';
import { FIXED_QP_PRICE } from './order-book.service';

/**
 * AI Participant UUID (TOS §5.2 — ordinary user, not a market maker).
 * Must match the UUID used by MarketBalanceService and AiParticipantService.
 */
export const AI_BRIDGE_PARTICIPANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * The buy-side spread applied when the AI sells QP to buyers.
 * The AI sells at $1.001 per QP (buyer pays slightly more).
 * Covers facilitator transfer fees and platform operational costs.
 */
const AI_SELL_SPREAD = 0.001; // AI sells at $1.001

/**
 * The sell-side spread applied when the AI buys QP from sellers.
 * The AI buys at $0.999 per QP (seller receives slightly less).
 */
const AI_BUY_SPREAD = 0.001; // AI buys at $0.999

/** Computed prices */
export const AI_BRIDGE_SELL_PRICE = FIXED_QP_PRICE + AI_SELL_SPREAD; // $1.001
export const AI_BRIDGE_BUY_PRICE = FIXED_QP_PRICE - AI_BUY_SPREAD;  // $0.999

/**
 * Cross-Facilitator Engine — The Genius Solution
 *
 * When a user on Facilitator X wants to trade with a user on Facilitator Y, a direct
 * cash transfer between them is impossible (would make the platform a money transmitter).
 *
 * Solution: The AI Participant acts as a MATCHED PRINCIPAL between the two facilitators.
 *
 * For a buy order (User A on Facilitator X, buying QP from User B on Facilitator Y):
 *
 *   Leg 1: User A buys 100 QP from the AI (settled via Facilitator X).
 *           → Facilitator X transfers $100.1 from A to AI's Facilitator X account.
 *
 *   Leg 2: AI buys 100 QP from User B (settled via Facilitator Y).
 *           → Facilitator Y transfers $99.9 from AI's Facilitator Y account to B.
 *
 * Net effect:
 *   - A has 100 QP, paid $100.1.
 *   - B has $99.9, lost 100 QP.
 *   - AI's QP inventory unchanged (sold 100 in Leg 1, bought 100 in Leg 2).
 *   - AI's cash: +$100.1 at Facilitator X, -$99.9 at Facilitator Y. Net: +$0.2 (spread).
 *   - Platform never touches user cash. All cash moves: user ↔ AI via facilitator.
 *
 * Legal basis (TOS §5.2 + §4.3):
 *   - The AI is an ordinary user, trading for its own account (matched principal).
 *   - Two separate trades with full disclosure — no direct user-to-user cash transfer.
 *   - Platform records QP ledger changes only; fiat settlement confirmed by facilitator webhook.
 *   - AI's participation is DISCRETIONARY (bridge pauses if reserve runs low — TOS §6.1).
 */
@Injectable()
export class CrossFacilitatorEngineService {
  private readonly logger = new Logger(CrossFacilitatorEngineService.name);

  constructor(
    @InjectRepository(QPointOrder)
    private readonly orderRepo: Repository<QPointOrder>,
    @InjectRepository(QPointTrade)
    private readonly tradeRepo: Repository<QPointTrade>,
    @InjectRepository(AiFacilitatorBalance)
    private readonly aiFacilitatorBalanceRepo: Repository<AiFacilitatorBalance>,
    private readonly dataSource: DataSource,
    private readonly balance: MarketBalanceService,
    private readonly settlement: SettlementService,
    private readonly notifications: MarketNotificationService,
    private readonly revenue: RevenueService,
  ) {}

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Determine whether two orders require cross-facilitator bridging.
   *
   * Returns true when:
   *   - Both orders have facilitator IDs set.
   *   - The facilitator IDs differ.
   *   - The AI bridge is active for both facilitators.
   */
  async isCrossFacilitatorTrade(
    buyerFacilitatorId: FacilitatorProvider | undefined,
    sellerFacilitatorId: FacilitatorProvider | undefined,
  ): Promise<boolean> {
    if (!buyerFacilitatorId || !sellerFacilitatorId) return false;
    if (buyerFacilitatorId === sellerFacilitatorId) return false;

    const [buyerBalance, sellerBalance] = await Promise.all([
      this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId: buyerFacilitatorId } }),
      this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId: sellerFacilitatorId } }),
    ]);

    // Bridge is active when the AI has sufficient reserves at both facilitators
    const buyerBridgeActive = buyerBalance?.isBridgeActive ?? false;
    const sellerBridgeActive = sellerBalance?.isBridgeActive ?? false;

    return buyerBridgeActive && sellerBridgeActive;
  }

  /**
   * Execute a cross-facilitator matched-principal bridge transaction.
   *
   * @param buyerUserId         The buyer (on Facilitator X)
   * @param buyerFacilitatorId  Buyer's facilitator
   * @param sellerUserId        The seller (on Facilitator Y)
   * @param sellerFacilitatorId Seller's facilitator
   * @param quantity            Number of QP to exchange
   *
   * @returns The two trade records (Leg 1: AI→Buyer, Leg 2: AI←Seller)
   */
  async executeBridge(
    buyerUserId: string,
    buyerFacilitatorId: FacilitatorProvider,
    sellerUserId: string,
    sellerFacilitatorId: FacilitatorProvider,
    quantity: number,
  ): Promise<{ leg1: QPointTrade; leg2: QPointTrade }> {
    // Guard: verify AI has sufficient reserves at the seller's facilitator
    // (the AI needs cash there to pay the seller)
    await this._assertBridgeCapacity(sellerFacilitatorId, quantity * AI_BRIDGE_BUY_PRICE);

    const pairId = uuidv4();

    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      const orderMgr = manager.getRepository(QPointOrder);
      const tradeMgr = manager.getRepository(QPointTrade);

      // ── Leg 1: AI sells QP to the buyer (settled via buyer's facilitator) ────────
      // AI places a SELL order; buyer's order matches it.
      const aiSellOrder = orderMgr.create({
        userId: AI_BRIDGE_PARTICIPANT_ID,
        type: QPointOrderType.SELL,
        price: AI_BRIDGE_SELL_PRICE,
        quantity,
        filledQuantity: quantity,
        status: QPointOrderStatus.FILLED,
        facilitatorId: buyerFacilitatorId,
      });
      await orderMgr.save(aiSellOrder);

      // Create a synthetic buy order for the buyer (immediately filled)
      const buyerOrder = orderMgr.create({
        userId: buyerUserId,
        type: QPointOrderType.BUY,
        price: AI_BRIDGE_SELL_PRICE,
        quantity,
        filledQuantity: quantity,
        status: QPointOrderStatus.FILLED,
        facilitatorId: buyerFacilitatorId,
      });
      await orderMgr.save(buyerOrder);

      const leg1 = tradeMgr.create({
        buyOrderId: buyerOrder.id,
        sellOrderId: aiSellOrder.id,
        price: AI_BRIDGE_SELL_PRICE,
        quantity,
        buyerId: buyerUserId,
        sellerId: AI_BRIDGE_PARTICIPANT_ID,
        buyerFacilitatorId,
        sellerFacilitatorId: buyerFacilitatorId, // AI is the seller; uses buyer's facilitator
        isCrossFacilitator: true,
        crossFacilitatorPairId: pairId,
      });
      await tradeMgr.save(leg1);

      // ── Leg 2: AI buys QP from the seller (settled via seller's facilitator) ─────
      // AI places a BUY order; seller's order matches it.
      const aiBuyOrder = orderMgr.create({
        userId: AI_BRIDGE_PARTICIPANT_ID,
        type: QPointOrderType.BUY,
        price: AI_BRIDGE_BUY_PRICE,
        quantity,
        filledQuantity: quantity,
        status: QPointOrderStatus.FILLED,
        facilitatorId: sellerFacilitatorId,
      });
      await orderMgr.save(aiBuyOrder);

      const sellerOrder = orderMgr.create({
        userId: sellerUserId,
        type: QPointOrderType.SELL,
        price: AI_BRIDGE_BUY_PRICE,
        quantity,
        filledQuantity: quantity,
        status: QPointOrderStatus.FILLED,
        facilitatorId: sellerFacilitatorId,
      });
      await orderMgr.save(sellerOrder);

      const leg2 = tradeMgr.create({
        buyOrderId: aiBuyOrder.id,
        sellOrderId: sellerOrder.id,
        price: AI_BRIDGE_BUY_PRICE,
        quantity,
        buyerId: AI_BRIDGE_PARTICIPANT_ID,
        sellerId: sellerUserId,
        buyerFacilitatorId: sellerFacilitatorId, // AI is the buyer; uses seller's facilitator
        sellerFacilitatorId,
        isCrossFacilitator: true,
        crossFacilitatorPairId: pairId,
      });
      await tradeMgr.save(leg2);

      // ── QP Ledger Updates ────────────────────────────────────────────────────
      // Buyer receives QP from AI (Leg 1)
      await this.balance.adjustBalance(buyerUserId, quantity, `cf_bridge_leg1_buy_${pairId}`);
      // AI QP inventory: sold (Leg 1) then bought back (Leg 2) — net 0 change
      // But we still do the explicit two-step for audit completeness:
      await this.balance.adjustBalance(AI_BRIDGE_PARTICIPANT_ID, -quantity, `cf_bridge_leg1_ai_sell_${pairId}`);
      await this.balance.adjustBalance(AI_BRIDGE_PARTICIPANT_ID, quantity, `cf_bridge_leg2_ai_buy_${pairId}`);
      // Seller loses QP (Leg 2)
      await this.balance.adjustBalance(sellerUserId, -quantity, `cf_bridge_leg2_sell_${pairId}`);

      return { leg1, leg2 };
    });

    // ── Post-transaction: cash balance tracking + settlements ─────────────────
    // Update AI cash balances (async, non-blocking — failure doesn't reverse the trade)
    this._updateAiCashBalances(
      buyerFacilitatorId,
      quantity * AI_BRIDGE_SELL_PRICE,    // AI receives this from buyer
      sellerFacilitatorId,
      quantity * AI_BRIDGE_BUY_PRICE,     // AI pays this to seller
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI cash balance update failed for pair ${pairId}: ${msg}`);
    });

    // Create settlement records for both legs (TOS §4.3 — platform records only; fiat via facilitator)
    this.settlement.createCrossFacilitatorSettlement(
      result.leg1,
      result.leg2,
      buyerUserId,
      sellerUserId,
      quantity * AI_BRIDGE_SELL_PRICE,
      quantity * AI_BRIDGE_BUY_PRICE,
      pairId,
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Settlement error for CF pair ${pairId}: ${msg}`);
    });

    // Charge trade fee on taker side (buyer is the taker in a cross-facilitator scenario)
    this.revenue.chargeTradeFee(buyerUserId, result.leg1.id).catch(() => void 0);

    // Notify both parties
    this._notifyBridgeTrade(
      buyerUserId, sellerUserId, quantity, buyerFacilitatorId, sellerFacilitatorId,
    ).catch(() => void 0);

    this.logger.log(
      `Cross-facilitator bridge executed: pairId=${pairId}, ` +
      `buyer=${buyerUserId}@${buyerFacilitatorId}, seller=${sellerUserId}@${sellerFacilitatorId}, ` +
      `qty=${quantity}, spread=${(AI_SELL_SPREAD + AI_BUY_SPREAD).toFixed(4)}`,
    );

    return result;
  }

  /**
   * Get the AI Participant's cash balance at a specific facilitator.
   */
  async getAiBalance(facilitatorId: FacilitatorProvider): Promise<AiFacilitatorBalance | null> {
    return this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId } });
  }

  /**
   * Get all AI Participant cash balances across all facilitators.
   * Used by admin dashboard and netting engine.
   */
  async getAllAiBalances(): Promise<AiFacilitatorBalance[]> {
    return this.aiFacilitatorBalanceRepo.find({ order: { facilitatorId: 'ASC' } });
  }

  /**
   * Ensure a balance row exists for a facilitator. Called when a new facilitator is onboarded.
   */
  async ensureBalanceRow(
    facilitatorId: FacilitatorProvider,
    minReserveUsd = 10_000,
  ): Promise<AiFacilitatorBalance> {
    const existing = await this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId } });
    if (existing) return existing;

    const row = this.aiFacilitatorBalanceRepo.create({
      facilitatorId,
      cashBalanceUsd: 0,
      minReserveUsd,
      isBridgeActive: false, // Inactive until funded by platform finance team
      dailyOutflowUsd: 0,
      dailyOutflowResetAt: null,
    });
    return this.aiFacilitatorBalanceRepo.save(row);
  }

  /**
   * Record an external funding injection into the AI's account at a facilitator.
   * Called when the platform finance team deposits new operational funds.
   * Unlike applyRebalancingTransfer (which moves between two facilitators),
   * this only increases the target facilitator's balance.
   */
  async recordExternalFunding(
    facilitatorId: FacilitatorProvider,
    amountUsd: number,
  ): Promise<AiFacilitatorBalance> {
    let row = await this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId } });
    if (!row) {
      row = await this.ensureBalanceRow(facilitatorId);
    }

    const newBalance = Number(row.cashBalanceUsd) + amountUsd;
    const shouldActivate = newBalance >= Number(row.minReserveUsd);

    await this.aiFacilitatorBalanceRepo.update({ facilitatorId }, {
      cashBalanceUsd: newBalance,
      isBridgeActive: shouldActivate ? true : row.isBridgeActive,
    });

    this.logger.log(
      `External funding recorded: +$${amountUsd} at ${facilitatorId}. ` +
      `New balance: $${newBalance.toFixed(2)}. Bridge active: ${shouldActivate}.`,
    );

    return (await this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId } }))!;
  }

  /**
   * Update the AI's cash balance at a facilitator after a manual rebalancing transfer.
   * Called when admin completes a NettingTask.
   */
  async applyRebalancingTransfer(
    sourceFacilitatorId: FacilitatorProvider,
    targetFacilitatorId: FacilitatorProvider,
    amountUsd: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const repo = manager.getRepository(AiFacilitatorBalance);

      const [source, target] = await Promise.all([
        repo.findOne({ where: { facilitatorId: sourceFacilitatorId } }),
        repo.findOne({ where: { facilitatorId: targetFacilitatorId } }),
      ]);

      if (source) {
        const newBalance = Number(source.cashBalanceUsd) - amountUsd;
        await repo.update({ facilitatorId: sourceFacilitatorId }, {
          cashBalanceUsd: Math.max(0, newBalance),
        });
      }

      if (target) {
        const newBalance = Number(target.cashBalanceUsd) + amountUsd;
        const needsActivation = newBalance >= Number(target.minReserveUsd);
        await repo.update({ facilitatorId: targetFacilitatorId }, {
          cashBalanceUsd: newBalance,
          isBridgeActive: needsActivation ? true : target.isBridgeActive,
        });
      }
    });

    this.logger.log(
      `AI cash rebalancing applied: $${amountUsd} from ${sourceFacilitatorId} → ${targetFacilitatorId}`,
    );
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  private async _assertBridgeCapacity(
    facilitatorId: FacilitatorProvider,
    requiredUsd: number,
  ): Promise<void> {
    const row = await this.aiFacilitatorBalanceRepo.findOne({ where: { facilitatorId } });

    if (!row) {
      throw new ServiceUnavailableException(
        `Cash-out via your payment method (${facilitatorId}) is temporarily unavailable. ` +
        'The AI Participant does not yet have an account with this facilitator. ' +
        'Please try again later or contact support. (TOS §6.1)',
      );
    }

    if (!row.isBridgeActive) {
      throw new ServiceUnavailableException(
        `Cash-out via your payment method (${facilitatorId}) is temporarily limited. ` +
        'The AI Participant\'s reserve for this payment method is being replenished. ' +
        'Please try again later or use a different payment method. (TOS §6.1)',
      );
    }

    const available = Number(row.cashBalanceUsd);
    if (available < requiredUsd) {
      throw new ServiceUnavailableException(
        `Cash-out via ${facilitatorId} is temporarily limited. ` +
        `Available bridge capacity: $${available.toFixed(2)}. Please try a smaller amount ` +
        'or try again later. The AI Participant reserves are being replenished. (TOS §6.1)',
      );
    }
  }

  private async _updateAiCashBalances(
    incomingFacilitatorId: FacilitatorProvider,
    incomingAmountUsd: number,
    outgoingFacilitatorId: FacilitatorProvider,
    outgoingAmountUsd: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const repo = manager.getRepository(AiFacilitatorBalance);
      const now = new Date();

      // Credit the incoming facilitator (AI received cash from buyer)
      await repo
        .createQueryBuilder()
        .update(AiFacilitatorBalance)
        .set({
          cashBalanceUsd: () => `cash_balance_usd + ${incomingAmountUsd}`,
          updatedAt: now,
        })
        .where('facilitator_id = :id', { id: incomingFacilitatorId })
        .execute();

      // Debit the outgoing facilitator (AI paid cash to seller)
      // Also update the 24h outflow rolling counter
      const outgoing = await repo.findOne({ where: { facilitatorId: outgoingFacilitatorId } });
      if (outgoing) {
        const newBalance = Math.max(0, Number(outgoing.cashBalanceUsd) - outgoingAmountUsd);

        // Reset daily outflow counter if it's a new day
        let dailyOutflow = Number(outgoing.dailyOutflowUsd) + outgoingAmountUsd;
        let resetAt = outgoing.dailyOutflowResetAt;
        if (!resetAt || now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000) {
          dailyOutflow = outgoingAmountUsd;
          resetAt = now;
        }

        // 10% daily volume rule: if balance falls below 10% of daily volume, suspend the bridge
        const suspendThreshold = Math.max(
          Number(outgoing.minReserveUsd),
          dailyOutflow * 0.1,
        );
        const shouldSuspend = newBalance < suspendThreshold;

        await repo.update({ facilitatorId: outgoingFacilitatorId }, {
          cashBalanceUsd: newBalance,
          dailyOutflowUsd: dailyOutflow,
          dailyOutflowResetAt: resetAt,
          isBridgeActive: shouldSuspend ? false : outgoing.isBridgeActive,
          updatedAt: now,
        });

        if (shouldSuspend) {
          this.logger.warn(
            `AI bridge SUSPENDED for ${outgoingFacilitatorId}: ` +
            `balance=$${newBalance.toFixed(2)}, threshold=$${suspendThreshold.toFixed(2)}. ` +
            'NettingEngine will create a rebalancing task.',
          );
        }
      }
    });
  }

  private async _notifyBridgeTrade(
    buyerUserId: string,
    sellerUserId: string,
    quantity: number,
    buyerFacilitatorId: FacilitatorProvider,
    sellerFacilitatorId: FacilitatorProvider,
  ): Promise<void> {
    const buyerAmount = (quantity * AI_BRIDGE_SELL_PRICE).toFixed(2);
    const sellerAmount = (quantity * AI_BRIDGE_BUY_PRICE).toFixed(2);

    await Promise.all([
      this.notifications.notifyUser(
        buyerUserId,
        'trade_executed',
        `Bought ${quantity.toFixed(4)} QP for $${buyerAmount} via ${buyerFacilitatorId}. ` +
        'Your payment will be collected by the AI Participant via your registered payment method.',
        { quantity, amount: buyerAmount, facilitator: buyerFacilitatorId, type: 'cross_facilitator' },
      ),
      this.notifications.notifyUser(
        sellerUserId,
        'trade_executed',
        `Sold ${quantity.toFixed(4)} QP. You will receive $${sellerAmount} via ${sellerFacilitatorId}. ` +
        'Payment will be sent to your registered payment account.',
        { quantity, amount: sellerAmount, facilitator: sellerFacilitatorId, type: 'cross_facilitator' },
      ),
    ]);
  }
}
