import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditDataQuery } from './entities/credit-data-query.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { LoanApplication, LoanStatus } from '../loans/entities/loan-application.entity';

const AI_TREASURY_USER_ID = process.env.AI_TREASURY_USER_ID ?? 'ai-treasury';

/** Maximum score value returned by the platform's credit scoring model. */
const MAX_SCORE = 1000;

@Injectable()
export class CreditDataService {
  private readonly logger = new Logger(CreditDataService.name);

  constructor(
    @InjectRepository(CreditDataQuery)
    private readonly queryRepo: Repository<CreditDataQuery>,
    @InjectRepository(FiProfile)
    private readonly fiProfileRepo: Repository<FiProfile>,
    @InjectRepository(QPointAccount)
    private readonly accountRepo: Repository<QPointAccount>,
    @InjectRepository(LoanApplication)
    private readonly loanAppRepo: Repository<LoanApplication>,
    private readonly qpoints: QPointsTransactionService,
  ) {}

  /**
   * FI requests a credit score for a subject user.
   * Charges a per-query fee from the FI's QP account to AI Treasury.
   */
  async requestCreditScore(
    requestingFiEntityId: string,
    subjectUserId: string,
    consentId?: string,
  ): Promise<CreditDataQuery> {
    const fiProfile = await this.getVerifiedFiProfile(requestingFiEntityId);

    if (!consentId) {
      throw new BadRequestException('User consent (consentId) is required for credit data queries');
    }

    // Pull anonymised metrics
    const metrics = await this.collectMetrics(subjectUserId);
    const score = this.computeScore(metrics);

    // Charge per-query fee
    let feeTxId: string | null = null;
    if (fiProfile.creditQueryFeeQp > 0) {
      const feeTx = await this.qpoints.transfer(
        {
          toUserId: AI_TREASURY_USER_ID,
          amount: parseFloat(fiProfile.creditQueryFeeQp.toString()),
          description: `Credit data query fee for subject ${subjectUserId}`,
          metadata: { creditType: 'CREDIT_DATA_FEE', subjectUserId },
        },
        requestingFiEntityId,
      );
      feeTxId = feeTx.id;
    }

    const record = await this.queryRepo.save(
      this.queryRepo.create({
        requestingFiEntityId,
        subjectUserId,
        consentId,
        score,
        dataJson: metrics,
        feeQp: fiProfile.creditQueryFeeQp,
        feeTxId,
      }),
    );

    this.logger.log(
      `Credit score query by FI ${requestingFiEntityId} for user ${subjectUserId}: score ${score}`,
    );
    return record;
  }

  /**
   * Update the subscription tier for a FI, enabling unlimited credit queries
   * at a fixed monthly QP rate (fee management is out of scope for MVP).
   */
  async subscribeToCreditData(
    fiEntityId: string,
    planTier: 'basic' | 'professional' | 'enterprise',
  ): Promise<FiProfile> {
    const profile = await this.fiProfileRepo.findOne({ where: { entityId: fiEntityId } });
    if (!profile) throw new NotFoundException(`FI profile ${fiEntityId} not found`);
    profile.creditSubTier = planTier;
    return this.fiProfileRepo.save(profile);
  }

  // ─── Internal Scoring ─────────────────────────────────────────────────────

  private async collectMetrics(userId: string): Promise<Record<string, any>> {
    // Q-Points balance
    const account = await this.accountRepo
      .createQueryBuilder('account')
      .innerJoin('entities', 'entity', 'entity.id = account."entityId"')
      .where('entity."ownerId" = :userId', { userId })
      .getOne();

    const balance = account ? parseFloat(account.balance.toString()) : 0;

    // Repayment history: count repaid vs total active/closed loans
    const allLoans = await this.loanAppRepo.find({ where: { borrowerUserId: userId } });
    const repaid = allLoans.filter((l) => l.status === LoanStatus.REPAID).length;
    const defaulted = allLoans.filter((l) => l.status === LoanStatus.DEFAULTED).length;

    return {
      qpBalance: balance,
      totalLoans: allLoans.length,
      repaidLoans: repaid,
      defaultedLoans: defaulted,
      repaymentRatio: allLoans.length > 0 ? repaid / allLoans.length : null,
    };
  }

  private computeScore(metrics: Record<string, any>): number {
    let score = 500; // baseline

    // Balance contribution (max +200)
    score += Math.min(200, Math.floor(metrics.qpBalance / 50));

    // Repayment history (max +200, min -200)
    if (metrics.repaymentRatio !== null) {
      score += Math.round((metrics.repaymentRatio - 0.5) * 400);
    }

    // Penalise defaults (-100 per default, max -300)
    score -= Math.min(300, metrics.defaultedLoans * 100);

    return Math.max(0, Math.min(MAX_SCORE, score));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getVerifiedFiProfile(entityId: string): Promise<FiProfile> {
    const profile = await this.fiProfileRepo.findOne({ where: { entityId } });
    if (!profile) throw new NotFoundException(`FI profile ${entityId} not found`);
    if (!profile.licenseVerified) {
      throw new ForbiddenException(`FI ${entityId} is not license-verified`);
    }
    return profile;
  }
}
