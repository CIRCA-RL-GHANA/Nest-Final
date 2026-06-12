import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DepositAccount, DepositStatus } from './entities/deposit-account.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';

/** Platform distribution fee on matured deposits: 0.25% p.a. split to AI Treasury. */
const DISTRIBUTION_FEE_RATE = (() => {
  const raw = parseFloat(process.env.DEPOSIT_DISTRIBUTION_FEE_RATE ?? '0.0025');
  if (isNaN(raw) || raw < 0 || raw > 1) {
    throw new Error(
      `DEPOSIT_DISTRIBUTION_FEE_RATE must be a number between 0 and 1 (got "${process.env.DEPOSIT_DISTRIBUTION_FEE_RATE}")`,
    );
  }
  return raw;
})();

const AI_TREASURY_USER_ID = (() => {
  const id = process.env.AI_TREASURY_USER_ID;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(
      'AI_TREASURY_USER_ID env var is missing or not a valid UUID. Set it to a real treasury account UUID.',
    );
  }
  return id;
})();

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    @InjectRepository(DepositAccount)
    private readonly depositRepo: Repository<DepositAccount>,
    @InjectRepository(FiProfile)
    private readonly fiProfileRepo: Repository<FiProfile>,
    private readonly qpoints: QPointsTransactionService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Create Deposit ────────────────────────────────────────────────────────

  async createDeposit(userId: string, dto: CreateDepositDto): Promise<DepositAccount> {
    const fiProfile = await this.getVerifiedFiProfile(dto.fiEntityId);

    const maturityDate = new Date();
    maturityDate.setDate(maturityDate.getDate() + dto.termDays);

    // Lock Q-Points: transfer from user to a segregated internal FI sub-account
    const lockTx = await this.qpoints.transfer(
      {
        toUserId: dto.fiEntityId,
        amount: dto.amountQp,
        description: `Deposit lock for ${dto.termDays} days`,
        metadata: { depositType: 'DEPOSIT_LOCK', termDays: dto.termDays },
      },
      userId,
    );

    // ISSUE-05: if deposit record save fails, reverse the QP lock to prevent orphaned balance
    let deposit: DepositAccount;
    try {
      deposit = await this.dataSource.transaction(async (manager) =>
        manager.getRepository(DepositAccount).save(
          manager.getRepository(DepositAccount).create({
            userId,
            fiEntityId: dto.fiEntityId,
            lockedQp: dto.amountQp,
            interestRate: fiProfile.baseInterestRate,
            termDays: dto.termDays,
            maturityDate,
            status: DepositStatus.ACTIVE,
            lockTxId: lockTx.id,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`Deposit record save failed — reversing QP lock for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      await this.qpoints.transfer(
        { toUserId: userId, amount: dto.amountQp, description: 'Deposit lock reversal', metadata: { depositType: 'DEPOSIT_LOCK_REVERSAL' } },
        dto.fiEntityId,
      ).catch((reverseErr) => {
        this.logger.error(`CRITICAL: QP lock reversal failed for user ${userId} — manual intervention required: ${reverseErr instanceof Error ? reverseErr.message : String(reverseErr)}`);
      });
      throw err;
    }

    this.logger.log(`Deposit ${deposit.id} created: ${dto.amountQp} QP locked for ${dto.termDays} days`);
    return deposit;
  }

  // ─── Mature Deposit ────────────────────────────────────────────────────────

  async matureDeposit(depositId: string, _triggeredByUserId?: string): Promise<DepositAccount> {
    const deposit = await this.findOrFail(depositId);

    if (deposit.status !== DepositStatus.ACTIVE) {
      throw new BadRequestException(`Deposit ${depositId} is not active`);
    }

    const now = new Date();
    if (deposit.maturityDate > now) {
      throw new BadRequestException(
        `Deposit ${depositId} matures on ${deposit.maturityDate.toISOString()}, cannot mature early`,
      );
    }

    const principal = parseFloat(deposit.lockedQp.toString());
    const rate = parseFloat(deposit.interestRate.toString());
    // Simple interest: P * r * (t/365)
    const interest = parseFloat(
      (principal * rate * (deposit.termDays / 365)).toFixed(4),
    );
    const distributionFee = parseFloat(
      (principal * DISTRIBUTION_FEE_RATE * (deposit.termDays / 365)).toFixed(4),
    );
    const netPayout = principal + interest - distributionFee;

    // FI pays back principal + interest to user
    const unlockTx = await this.qpoints.transfer(
      {
        toUserId: deposit.userId,
        amount: netPayout,
        description: `Deposit maturity payout #${depositId}`,
        metadata: { depositType: 'DEPOSIT_UNLOCK', depositId },
      },
      deposit.fiEntityId,
    );

    // Platform takes distribution fee → AI Treasury
    if (distributionFee > 0) {
      await this.qpoints.transfer(
        {
          toUserId: AI_TREASURY_USER_ID,
          amount: distributionFee,
          description: `Deposit distribution fee #${depositId}`,
          metadata: { depositType: 'DEPOSIT_FEE', depositId },
        },
        deposit.fiEntityId,
      );
    }

    deposit.status = DepositStatus.MATURED;
    deposit.unlockTxId = unlockTx.id;
    deposit.interestPaidQp = interest;
    const saved = await this.depositRepo.save(deposit);

    this.logger.log(
      `Deposit ${depositId} matured: ${netPayout} QP paid out (interest: ${interest}, fee: ${distributionFee})`,
    );
    return saved;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getDeposits(userId: string): Promise<DepositAccount[]> {
    return this.depositRepo.find({
      where: [{ userId }, { fiEntityId: userId }],
      order: { createdAt: 'DESC' },
    });
  }

  /** Returns all active deposits whose maturity date has passed (for the scheduler). */
  async findMaturedDeposits(): Promise<DepositAccount[]> {
    return this.depositRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: DepositStatus.ACTIVE })
      .andWhere('d.maturityDate <= :now', { now: new Date() })
      .getMany();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async findOrFail(id: string): Promise<DepositAccount> {
    const dep = await this.depositRepo.findOne({ where: { id } });
    if (!dep) throw new NotFoundException(`Deposit ${id} not found`);
    return dep;
  }

  private async getVerifiedFiProfile(entityId: string): Promise<FiProfile> {
    const profile = await this.fiProfileRepo.findOne({ where: { entityId } });
    if (!profile) throw new NotFoundException(`FI profile for entity ${entityId} not found`);
    if (!profile.licenseVerified) {
      throw new BadRequestException(`FI ${entityId} is not license-verified`);
    }
    return profile;
  }
}
