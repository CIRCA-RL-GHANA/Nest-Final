import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InsurancePolicy,
  InsurancePolicyStatus,
} from './entities/insurance-policy.entity';
import {
  InsuranceClaim,
  InsuranceClaimStatus,
} from './entities/insurance-claim.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { PurchasePolicyDto, FileClaimDto, ReviewClaimDto } from './dto/insurance.dto';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';

/** 5% platform commission on insurance premium, routed to AI Treasury. */
const PLATFORM_COMMISSION_RATE = 0.05;
const AI_TREASURY_USER_ID = process.env.AI_TREASURY_USER_ID ?? 'ai-treasury';

@Injectable()
export class InsuranceService {
  private readonly logger = new Logger(InsuranceService.name);

  constructor(
    @InjectRepository(InsurancePolicy)
    private readonly policyRepo: Repository<InsurancePolicy>,
    @InjectRepository(InsuranceClaim)
    private readonly claimRepo: Repository<InsuranceClaim>,
    @InjectRepository(FiProfile)
    private readonly fiProfileRepo: Repository<FiProfile>,
    private readonly qpoints: QPointsTransactionService,
  ) {}

  // ─── Purchase Policy ───────────────────────────────────────────────────────

  async purchasePolicy(userId: string, dto: PurchasePolicyDto): Promise<InsurancePolicy> {
    const fiProfile = await this.getVerifiedFiProfile(dto.fiEntityId);

    const platformFee = parseFloat((dto.premiumQp * PLATFORM_COMMISSION_RATE).toFixed(4));
    const netPremium = parseFloat((dto.premiumQp - platformFee).toFixed(4));

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + dto.durationDays);

    // Deduct full premium from user, send net to FI
    const premiumTx = await this.qpoints.transfer(
      {
        toUserId: dto.fiEntityId,
        amount: netPremium,
        description: `Insurance premium: ${dto.policyType}`,
        metadata: { insuranceType: 'INSURANCE_PREMIUM', policyType: dto.policyType },
      },
      userId,
    );

    // Platform commission to AI Treasury
    if (platformFee > 0) {
      await this.qpoints.transfer(
        {
          toUserId: AI_TREASURY_USER_ID,
          amount: platformFee,
          description: `Insurance platform commission (${dto.policyType})`,
          metadata: { insuranceType: 'INSURANCE_COMMISSION' },
        },
        userId,
      );
    }

    const policy = await this.policyRepo.save(
      this.policyRepo.create({
        userId,
        fiEntityId: dto.fiEntityId,
        policyType: dto.policyType,
        premiumQp: dto.premiumQp,
        coverageQp: dto.coverageQp,
        platformFeeQp: platformFee,
        startDate,
        endDate,
        status: InsurancePolicyStatus.ACTIVE,
        premiumTxId: premiumTx.id,
        metadata: dto.metadata ?? null,
      }),
    );

    this.logger.log(`Policy ${policy.id} purchased by user ${userId} (FI: ${dto.fiEntityId})`);
    return policy;
  }

  // ─── File Claim ────────────────────────────────────────────────────────────

  async fileClaim(
    policyId: string,
    userId: string,
    dto: FileClaimDto,
  ): Promise<InsuranceClaim> {
    const policy = await this.policyRepo.findOne({ where: { id: policyId } });
    if (!policy) throw new NotFoundException(`Policy ${policyId} not found`);
    if (policy.userId !== userId) throw new ForbiddenException('Not your policy');
    if (policy.status !== InsurancePolicyStatus.ACTIVE) {
      throw new BadRequestException(`Policy ${policyId} is not active`);
    }
    if (dto.amountClaimedQp > parseFloat(policy.coverageQp.toString())) {
      throw new BadRequestException('Claimed amount exceeds coverage');
    }

    const claim = await this.claimRepo.save(
      this.claimRepo.create({
        policyId,
        userId,
        amountClaimedQp: dto.amountClaimedQp,
        description: dto.description,
        attachments: dto.attachments ?? null,
        status: InsuranceClaimStatus.SUBMITTED,
      }),
    );

    this.logger.log(`Claim ${claim.id} filed for policy ${policyId} by user ${userId}`);
    return claim;
  }

  // ─── Review Claim (FI Admin) ───────────────────────────────────────────────

  async reviewClaim(
    claimId: string,
    reviewerUserId: string,
    dto: ReviewClaimDto,
  ): Promise<InsuranceClaim> {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    if (
      claim.status !== InsuranceClaimStatus.SUBMITTED &&
      claim.status !== InsuranceClaimStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(`Claim ${claimId} cannot be reviewed in its current state`);
    }

    if (dto.action === 'approved') {
      const policy = await this.policyRepo.findOne({ where: { id: claim.policyId } });
      if (!policy) throw new NotFoundException(`Policy ${claim.policyId} not found`);

      // FI pays payout to claimant
      const payoutTx = await this.qpoints.transfer(
        {
          toUserId: claim.userId,
          amount: parseFloat(claim.amountClaimedQp.toString()),
          description: `Insurance claim payout #${claimId}`,
          metadata: { insuranceType: 'INSURANCE_CLAIM_PAYOUT', claimId },
        },
        reviewerUserId,
      );

      claim.status = InsuranceClaimStatus.PAID_OUT;
      claim.payoutTxId = payoutTx.id;
      policy.status = InsurancePolicyStatus.CLAIMED;
      await this.policyRepo.save(policy);
    } else {
      claim.status = InsuranceClaimStatus.REJECTED;
    }

    claim.reviewerNotes = dto.reviewerNotes ?? null;
    return this.claimRepo.save(claim);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getPolicies(userId: string): Promise<InsurancePolicy[]> {
    return this.policyRepo.find({
      where: [{ userId }, { fiEntityId: userId }],
      order: { createdAt: 'DESC' },
    });
  }

  async getClaims(userId: string): Promise<InsuranceClaim[]> {
    return this.claimRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
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
