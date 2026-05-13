import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RevenueRecord, RevenueType } from './entities/revenue-record.entity';
import { BusinessTransactionCounter } from './entities/business-transaction-counter.entity';
import { QPointMarketBalance } from '@modules/qpoints/market/entities/q-point-market-balance.entity';
import { QPointAccount } from '@modules/qpoints/entities/qpoint-account.entity';

/** Platform's AI-participant market-balance UUID (genesis supply holder). */
const AI_PARTICIPANT_ID = '00000000-0000-0000-0000-000000000001';

/** $1 = 1 QP (peg). All fees are expressed in QP. */
export const QP_PER_USD = 1;

/** Per-transaction fee charged to businesses (in QP). */
export const TRANSACTION_FEE_QP = 0.02;

/** Per-trade fee charged per trade execution (in QP). */
export const TRADE_FEE_QP = 0.02;

/** Free transaction quota per calendar month for non-trial businesses. */
export const FREE_TX_QUOTA = 100;

export interface RevenueStats {
  totalQPoints: number;
  byType: Record<RevenueType, number>;
  monthlyQPoints: number;
}

@Injectable()
export class RevenueService {
  private readonly logger = new Logger(RevenueService.name);

  constructor(
    @InjectRepository(RevenueRecord)
    private readonly revenueRepo: Repository<RevenueRecord>,
    @InjectRepository(BusinessTransactionCounter)
    private readonly counterRepo: Repository<BusinessTransactionCounter>,
    @InjectRepository(QPointAccount)
    private readonly qpAccountRepo: Repository<QPointAccount>,
    @InjectRepository(QPointMarketBalance)
    private readonly marketBalanceRepo: Repository<QPointMarketBalance>,
    private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Subscription revenue
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record subscription fee revenue.
   * Called by SubscriptionsService after successfully deducting Q Points.
   */
  async recordSubscriptionRevenue(
    entityId: string,
    amountQPoints: number,
    staffCount: number,
    assignmentId: string,
  ): Promise<RevenueRecord> {
    const record = this.revenueRepo.create({
      type: RevenueType.SUBSCRIPTION,
      amountQPoints,
      entityId,
      userId: null,
      refId: assignmentId,
      metadata: { staffCount },
    });
    const saved = await this.revenueRepo.save(record);
    this.logger.log(
      `Subscription revenue: ${amountQPoints} QP from entity ${entityId} (${staffCount} staff)`,
    );
    return saved;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Transaction fee revenue
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Charge a $0.02 transaction fee to the business entity.
   * The first FREE_TX_QUOTA transactions per calendar month are free,
   * UNLESS the entity is in its free trial (quota = 0).
   *
   * @param entityId   Business entity ID
   * @param orderRef   Unique reference for the underlying order/operation
   * @param isFreeTrial Whether this entity is in its first-month free trial
   * @returns Fee charged (0 if within free quota)
   */
  async chargeTransactionFee(
    entityId: string,
    orderRef: string,
    isFreeTrial: boolean,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const month = this._currentMonth();
      const freeQuota = isFreeTrial ? 0 : FREE_TX_QUOTA;

      // Upsert counter row with row-level lock
      await manager
        .createQueryBuilder()
        .insert()
        .into(BusinessTransactionCounter)
        .values({ entityId, calendarMonth: month, transactionCount: 0, totalFeesQPoints: 0, freeQuota })
        .orIgnore()
        .execute();

      const counter = await manager
        .getRepository(BusinessTransactionCounter)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.entity_id = :entityId AND c.calendar_month = :month', { entityId, month })
        .getOne();

      if (!counter) {
        throw new Error(`Counter row not found for entity ${entityId}`);
      }

      // Increment total transaction count
      counter.transactionCount += 1;

      // Determine if this transaction is chargeable
      const chargeable = counter.transactionCount > counter.freeQuota;

      if (chargeable) {
        // Deduct from entity's Q Points account
        const account = await manager
          .getRepository(QPointAccount)
          .createQueryBuilder('a')
          .setLock('pessimistic_write')
          .where('a.entity_id = :entityId', { entityId })
          .getOne();

        if (!account) {
          // Log and skip; don't hard-fail a business operation for a missing account
          this.logger.warn(`No QPoint account for entity ${entityId}; skipping tx fee`);
          await manager.save(BusinessTransactionCounter, counter);
          return 0;
        }

        if (Number(account.balance) < TRANSACTION_FEE_QP) {
          this.logger.warn(
            `Entity ${entityId} has insufficient QP balance for tx fee; skipping`,
          );
          await manager.save(BusinessTransactionCounter, counter);
          return 0;
        }

        account.balance = Number(account.balance) - TRANSACTION_FEE_QP;
        account.totalSpent = Number(account.totalSpent) + TRANSACTION_FEE_QP;
        account.lastTransactionAt = new Date();
        await manager.save(QPointAccount, account);

        counter.totalFeesQPoints = Number(counter.totalFeesQPoints) + TRANSACTION_FEE_QP;
        await manager.save(BusinessTransactionCounter, counter);

        // Record revenue
        const record = manager.create(RevenueRecord, {
          type: RevenueType.TRANSACTION_FEE,
          amountQPoints: TRANSACTION_FEE_QP,
          entityId,
          userId: null,
          refId: orderRef,
          metadata: {
            transactionCount: counter.transactionCount,
            freeQuota: counter.freeQuota,
            calendarMonth: month,
          },
        });
        await manager.save(RevenueRecord, record);

        this.logger.log(
          `Tx fee ${TRANSACTION_FEE_QP} QP charged to entity ${entityId} (tx #${counter.transactionCount}, quota ${counter.freeQuota})`,
        );
        return TRANSACTION_FEE_QP;
      }

      await manager.save(BusinessTransactionCounter, counter);
      return 0;
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Trade fee revenue
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Charge a $0.02 trade fee from the trade initiator (taker) on the Q Points
   * order book.  The fee is deducted from the user's market QP balance and
   * credited to the AI Participant (platform treasury).
   *
   * @param takerId  User ID of the order that triggered the match
   * @param tradeId  UUID of the QPointTrade record
   */
  async chargeTradeFee(takerId: string, tradeId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      // Debit taker
      const takerRow = await manager
        .getRepository(QPointMarketBalance)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.user_id = :userId', { userId: takerId })
        .getOne();

      if (!takerRow || Number(takerRow.balance) < TRADE_FEE_QP) {
        this.logger.warn(
          `User ${takerId} insufficient market balance for trade fee; skipping`,
        );
        return;
      }

      takerRow.balance = Number(takerRow.balance) - TRADE_FEE_QP;
      await manager.save(QPointMarketBalance, takerRow);

      // Credit AI Participant (platform treasury)
      await manager
        .createQueryBuilder()
        .insert()
        .into(QPointMarketBalance)
        .values({ userId: AI_PARTICIPANT_ID, balance: 0 })
        .orIgnore()
        .execute();

      const platformRow = await manager
        .getRepository(QPointMarketBalance)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.user_id = :userId', { userId: AI_PARTICIPANT_ID })
        .getOne();

      if (platformRow) {
        platformRow.balance = Number(platformRow.balance) + TRADE_FEE_QP;
        await manager.save(QPointMarketBalance, platformRow);
      }

      // Record revenue
      const record = manager.create(RevenueRecord, {
        type: RevenueType.TRADE_FEE,
        amountQPoints: TRADE_FEE_QP,
        entityId: null,
        userId: takerId,
        refId: tradeId,
        metadata: null,
      });
      await manager.save(RevenueRecord, record);

      this.logger.log(`Trade fee ${TRADE_FEE_QP} QP charged to user ${takerId} for trade ${tradeId}`);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stats / admin
  // ──────────────────────────────────────────────────────────────────────────

  async getStats(): Promise<RevenueStats> {
    const rows: { type: string; total: string }[] = (await this.revenueRepo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('SUM(r.amount_q_points)', 'total')
      .groupBy('r.type')
      .getRawMany()) as { type: string; total: string }[];

    const byType: Record<RevenueType, number> = {
      [RevenueType.SUBSCRIPTION]: 0,
      [RevenueType.TRANSACTION_FEE]: 0,
      [RevenueType.TRADE_FEE]: 0,
    };
    let totalQPoints = 0;
    for (const row of rows) {
      const val = parseFloat(row.total);
      byType[row.type as RevenueType] = val;
      totalQPoints += val;
    }

    // This month
    const month = this._currentMonth();
    const monthResult: { monthly: string } = (await this.revenueRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.amount_q_points), 0)', 'monthly')
      .where("TO_CHAR(r.created_at, 'YYYY-MM') = :month", { month })
      .getRawOne()) as { monthly: string };

    return {
      totalQPoints,
      byType,
      monthlyQPoints: parseFloat(monthResult.monthly),
    };
  }

  async getEntityMonthlyFees(entityId: string, calendarMonth?: string): Promise<BusinessTransactionCounter[]> {
    const where = calendarMonth
      ? { entityId, calendarMonth }
      : { entityId };
    return this.counterRepo.find({ where, order: { calendarMonth: 'DESC' } });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private _currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
