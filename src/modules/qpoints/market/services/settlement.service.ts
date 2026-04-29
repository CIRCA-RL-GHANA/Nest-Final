import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  QPointSettlement,
  SettlementStatus,
  SettlementType,
} from '../entities/q-point-settlement.entity';
import { QPointTrade } from '../entities/q-point-trade.entity';
import { MarketNotificationService } from './market-notification.service';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectRepository(QPointSettlement)
    private readonly repo: Repository<QPointSettlement>,
    private readonly notifications: MarketNotificationService,
  ) {}

  /**
   * Record a pending cash settlement for a completed trade.
   *
   * COMPLIANCE — TOS §4.3 & §2.3:
   *   "The Company does not initiate, facilitate, or confirm fiat transfers."
   *   "The Platform merely records the Q Points transfer; the fiat transfer is
   *    handled solely by the Facilitator."
   *
   * The Platform creates PENDING settlement records for audit purposes ONLY.
   * It does NOT call the Facilitator's transfer API.  Actual fiat movement
   * occurs directly between the Users through their registered Facilitator
   * accounts — outside this Platform.  Settlement records are marked COMPLETED
   * when the Facilitator sends a confirmation webhook to
   *   POST /api/v1/qpoints/settlement/webhook
   * or remain PENDING if no webhook is received (e.g., if Users settle manually).
   */
  async createSettlement(
    trade: QPointTrade,
    buyerId: string,
    sellerId: string,
    cashAmount: number,
  ): Promise<void> {
    this.logger.log(
      `Trade ${trade.id} matched. Recording PENDING settlement ` +
        `(buyer=${buyerId}, seller=${sellerId}, amount=$${cashAmount.toFixed(2)}). ` +
        'Fiat transfer is the sole responsibility of the Facilitator (TOS §4.3).',
    );

    // Create PENDING audit records (append-only; never initiate fiat movement here).
    const debitRecord = this.repo.create({
      tradeId: trade.id,
      userId: buyerId,
      amount: cashAmount,
      type: SettlementType.DEBIT,
      status: SettlementStatus.PENDING,
    });

    const creditRecord = this.repo.create({
      tradeId: trade.id,
      userId: sellerId,
      amount: cashAmount,
      type: SettlementType.CREDIT,
      status: SettlementStatus.PENDING,
    });

    await this.repo.save([debitRecord, creditRecord]);

    // Notify both parties with instructions to complete fiat payment directly
    // via their registered Facilitator account.  Per TOS §4.2, the Facilitator
    // handles the fiat transfer outside this Platform.
    await Promise.all([
      this.notifications.notifyUser(
        buyerId,
        'settlement_pending',
        `Trade matched (ID: ${trade.id}). You owe $${cashAmount.toFixed(2)} to the seller. ` +
          'Please complete payment via your registered Facilitator account. ' +
          'Per Q Points Terms of Service §4.2, fiat transfers are handled exclusively by the Facilitator.',
        { tradeId: trade.id, amount: cashAmount, section: '4.2' },
      ),
      this.notifications.notifyUser(
        sellerId,
        'settlement_pending',
        `Trade matched (ID: ${trade.id}). You will receive $${cashAmount.toFixed(2)} from the buyer. ` +
          'The buyer is completing payment via their registered Facilitator account. ' +
          'Per Q Points Terms of Service §4.2, fiat transfers are handled exclusively by the Facilitator.',
        { tradeId: trade.id, amount: cashAmount, section: '4.2' },
      ),
    ]);
  }

  /**
   * Confirm fiat settlement via a Facilitator webhook callback.
   *
   * Called from POST /api/v1/qpoints/settlement/webhook when the Facilitator
   * confirms that the fiat transfer for a trade has been completed.
   * This is the ONLY mechanism by which the Platform marks a settlement
   * COMPLETED — the Platform itself never initiates the transfer (TOS §4.3).
   *
   * @param tradeId          The trade ID (used as the Facilitator payment reference)
   * @param facilitatorRef   The Facilitator's own transfer/transaction ID
   */
  async confirmSettlementByWebhook(tradeId: string, facilitatorRef: string): Promise<void> {
    const records = await this.repo.find({ where: { tradeId } });
    if (!records.length) {
      this.logger.warn(`Webhook: no settlement records found for trade ${tradeId}`);
      return;
    }

    const now = new Date();
    await Promise.all(
      records.map((r: QPointSettlement) =>
        this.repo.update(
          { id: r.id },
          {
            status: SettlementStatus.COMPLETED,
            facilitatorReference: facilitatorRef,
            completedAt: now,
          },
        ),
      ),
    );

    this.logger.log(
      `Settlement CONFIRMED for trade ${tradeId} via Facilitator webhook ref=${facilitatorRef}`,
    );
  }

  /**
   * Record pending settlements for a cross-facilitator bridge transaction.
   *
   * Two separate settlement records are created:
   *   Leg 1: Buyer DEBIT (buyer pays AI via buyer's facilitator).
   *   Leg 2: Seller CREDIT (AI pays seller via seller's facilitator).
   *
   * These are separate settlements because they occur in different payment networks.
   * Neither settlement involves a direct user-to-user cash transfer.
   * The AI is the counterparty in each leg (TOS §5.2 matched principal).
   *
   * @param leg1              The trade record for Leg 1 (AI sells QP to buyer)
   * @param leg2              The trade record for Leg 2 (AI buys QP from seller)
   * @param buyerUserId       The buyer's user ID
   * @param sellerUserId      The seller's user ID
   * @param buyerAmountUsd    Amount the buyer pays the AI (at AI_BRIDGE_SELL_PRICE)
   * @param sellerAmountUsd   Amount the AI pays the seller (at AI_BRIDGE_BUY_PRICE)
   * @param pairId            Cross-facilitator pair UUID linking both legs
   */
  async createCrossFacilitatorSettlement(
    leg1: QPointTrade,
    leg2: QPointTrade,
    buyerUserId: string,
    sellerUserId: string,
    buyerAmountUsd: number,
    sellerAmountUsd: number,
    pairId: string,
  ): Promise<void> {
    this.logger.log(
      `Cross-facilitator bridge settlement: pairId=${pairId}, ` +
        `buyer=${buyerUserId} owes $${buyerAmountUsd.toFixed(2)} to AI (Leg 1), ` +
        `seller=${sellerUserId} receives $${sellerAmountUsd.toFixed(2)} from AI (Leg 2).`,
    );

    // Leg 1: buyer pays AI (DEBIT the buyer)
    const leg1Debit = this.repo.create({
      tradeId: leg1.id,
      userId: buyerUserId,
      amount: buyerAmountUsd,
      type: SettlementType.DEBIT,
      status: SettlementStatus.PENDING,
    });

    // Leg 2: AI pays seller (CREDIT the seller)
    const leg2Credit = this.repo.create({
      tradeId: leg2.id,
      userId: sellerUserId,
      amount: sellerAmountUsd,
      type: SettlementType.CREDIT,
      status: SettlementStatus.PENDING,
    });

    await this.repo.save([leg1Debit, leg2Credit]);

    await Promise.all([
      this.notifications.notifyUser(
        buyerUserId,
        'settlement_pending',
        `Your Q Points purchase is confirmed (pair ${pairId}). ` +
          `Please complete payment of $${buyerAmountUsd.toFixed(2)} to the AI Participant ` +
          'via your registered payment method. Per Q Points ToS §4.2, fiat transfers are ' +
          'handled exclusively by the Facilitator.',
        { tradeId: leg1.id, pairId, amount: buyerAmountUsd, section: '4.2', type: 'cross_facilitator' },
      ),
      this.notifications.notifyUser(
        sellerUserId,
        'settlement_pending',
        `Your Q Points sale is confirmed (pair ${pairId}). ` +
          `You will receive $${sellerAmountUsd.toFixed(2)} from the AI Participant ` +
          'to your registered payment account. Per Q Points ToS §4.2, fiat transfers are ' +
          'handled exclusively by the Facilitator.',
        { tradeId: leg2.id, pairId, amount: sellerAmountUsd, section: '4.2', type: 'cross_facilitator' },
      ),
    ]);
  }

  async getSettlementStatus(settlementId: string): Promise<QPointSettlement> {
    const s = await this.repo.findOne({ where: { id: settlementId } });
    if (!s) throw new Error(`Settlement ${settlementId} not found`);
    return s;
  }
}
