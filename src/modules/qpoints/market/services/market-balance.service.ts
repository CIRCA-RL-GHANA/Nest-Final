import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { QPointMarketBalance } from '../entities/q-point-market-balance.entity';

/** Fixed supply: 500 trillion QP. No QP may ever be minted beyond this value. */
export const QPOINTS_TOTAL_SUPPLY = 500_000_000_000_000;

/**
 * UUID of the AI Participant (TOS §5.2 — ordinary user; does NOT act as a market maker,
 * liquidity provider, or stabilizer). Holds the genesis supply for operational purposes only.
 */
export const AI_PARTICIPANT_ID = '00000000-0000-0000-0000-000000000001';

export interface BalanceResult {
  balance: number;
  updatedAt: Date;
}

@Injectable()
export class MarketBalanceService {
  private readonly logger = new Logger(MarketBalanceService.name);

  constructor(
    @InjectRepository(QPointMarketBalance)
    private readonly repo: Repository<QPointMarketBalance>,
    private readonly dataSource: DataSource,
  ) {}

  /** Return the current market QP balance for a user. */
  async getBalance(userId: string): Promise<BalanceResult> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row) {
      return { balance: 0, updatedAt: new Date() };
    }
    return { balance: Number(row.balance), updatedAt: row.updatedAt };
  }

  /**
   * Atomically adjust a user's market QP balance.
   * Creates the row if it does not yet exist.
   * Throws BadRequestException if the result would go below 0.
   *
   * @param userId  Target user (or AI participant UUID)
   * @param delta   Positive to credit, negative to debit
   * @param reason  Audit label, e.g. "trade_<id>"
   */
  async adjustBalance(userId: string, delta: number, reason: string): Promise<number> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // INSERT ... ON CONFLICT DO NOTHING — ensures the row exists before the SELECT FOR UPDATE
      await manager
        .createQueryBuilder()
        .insert()
        .into(QPointMarketBalance)
        .values({ userId, balance: 0 })
        .orIgnore()
        .execute();

      const row = await manager
        .getRepository(QPointMarketBalance)
        .createQueryBuilder('b')
        .setLock('pessimistic_write')
        .where('b.user_id = :userId', { userId })
        .getOne();

      if (!row) {
        throw new NotFoundException(`Balance row not found for user ${userId}`);
      }

      const newBalance = Number(row.balance) + delta;
      if (newBalance < 0) {
        throw new BadRequestException(
          `Insufficient Q Point balance for user ${userId} (have ${row.balance}, need ${Math.abs(delta)}). Reason: ${reason}`,
        );
      }

      // Supply-cap guard: QP are never minted beyond QPOINTS_TOTAL_SUPPLY.
      // The AI Participant (TOS §5.2) holds the genesis supply for operational purposes.
      // Human balances are funded only by QP the AI Participant distributes.
      // Crediting any account more than what the AI Participant has debited would violate the hard cap.
      if (delta > 0 && userId !== AI_PARTICIPANT_ID) {
        const sumResult = await manager
          .getRepository(QPointMarketBalance)
          .createQueryBuilder('b')
          .select('SUM(b.balance)', 'total')
          .getRawOne<{ total: string }>();
        const currentTotal = parseFloat(sumResult?.total ?? '0');
        if (currentTotal + delta > QPOINTS_TOTAL_SUPPLY) {
          throw new BadRequestException(
            `Operation would exceed the platform Q Points hard cap of ${QPOINTS_TOTAL_SUPPLY}. ` +
              `Current total supply in circulation: ${currentTotal}. Reason: ${reason}`,
          );
        }
      }

      row.balance = newBalance;
      await manager.save(row);

      this.logger.debug(
        `Balance adjusted for ${userId}: ${Number(row.balance) - newBalance + newBalance} → ${newBalance} [${reason}]`,
      );
      return newBalance;
    });
  }

  /** Create a balance row with zero balance. Safe to call multiple times (idempotent). */
  async initializeBalance(userId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(QPointMarketBalance)
      .values({ userId, balance: 0 })
      .orIgnore()
      .execute();
  }
}
