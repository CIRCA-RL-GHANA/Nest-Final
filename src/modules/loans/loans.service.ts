import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { LoanApplication, LoanStatus } from './entities/loan-application.entity';
import { LoanRepayment } from './entities/loan-repayment.entity';
import { FiProfile } from './entities/fi-profile.entity';
import { ApplyLoanDto, ApproveLoanDto, RepayLoanDto } from './dto/loans.dto';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';
import { TransactionType } from '../qpoints/entities/qpoint-transaction.entity';

/** Platform origination fee rate applied to disbursed amount. */
const ORIGINATION_FEE_RATE = 0.01;

/** AI Treasury internal account entity ID (platform revenue sink). */
const AI_TREASURY_USER_ID = process.env.AI_TREASURY_USER_ID ?? 'ai-treasury';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    @InjectRepository(LoanApplication)
    private readonly loanRepo: Repository<LoanApplication>,
    @InjectRepository(LoanRepayment)
    private readonly repaymentRepo: Repository<LoanRepayment>,
    @InjectRepository(FiProfile)
    private readonly fiProfileRepo: Repository<FiProfile>,
    private readonly qpoints: QPointsTransactionService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * User requests a loan. If fiEntityId is provided, a single application is
   * created and the FI is notified. Otherwise, offers are returned.
   */
  async requestLoan(userId: string, dto: ApplyLoanDto): Promise<LoanApplication> {
    const fiEntityId = dto.fiEntityId;
    if (!fiEntityId) {
      throw new BadRequestException('fiEntityId is required to apply for a loan');
    }

    const fiProfile = await this.getVerifiedFiProfile(fiEntityId);
    const amount = dto.amountQp;

    if (amount < fiProfile.minLoanAmountQp || amount > fiProfile.maxLoanAmountQp) {
      throw new BadRequestException(
        `Loan amount must be between ${fiProfile.minLoanAmountQp} and ${fiProfile.maxLoanAmountQp} QP`,
      );
    }

    const originationFee = parseFloat((amount * ORIGINATION_FEE_RATE).toFixed(4));

    const application = this.loanRepo.create({
      borrowerUserId: userId,
      fiEntityId,
      amountQp: amount,
      purpose: dto.purpose,
      termDays: dto.termDays ?? 30,
      interestRate: fiProfile.baseInterestRate,
      originationFeeQp: originationFee,
      outstandingQp: amount,
      status: LoanStatus.PENDING,
    });

    const saved = await this.loanRepo.save(application);
    this.logger.log(`Loan application ${saved.id} created for user ${userId} with FI ${fiEntityId}`);
    return saved;
  }

  /**
   * Returns competing loan offers from all verified FIs.
   */
  async getLoanOffers(
    userId: string,
    amountQp: number,
    purpose: string,
  ): Promise<Array<{ fiEntityId: string; interestRate: number; termDays: number; maxAmount: number }>> {
    const profiles = await this.fiProfileRepo.find({
      where: { licenseVerified: true },
    });

    return profiles
      .filter((p) => amountQp >= p.minLoanAmountQp && amountQp <= p.maxLoanAmountQp)
      .map((p) => ({
        fiEntityId: p.entityId,
        interestRate: parseFloat(p.baseInterestRate.toString()),
        termDays: 30,
        maxAmount: parseFloat(p.maxLoanAmountQp.toString()),
      }));
  }

  /**
   * FI Loan Officer approves a pending application and disburses Q-Points.
   */
  async approveLoan(
    applicationId: string,
    officerUserId: string,
    dto: ApproveLoanDto,
  ): Promise<LoanApplication> {
    const application = await this.findApplicationOrFail(applicationId);

    if (application.status !== LoanStatus.PENDING) {
      throw new BadRequestException(`Loan ${applicationId} is not in pending status`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update loan status
      const netDisbursement = parseFloat(
        (application.amountQp - application.originationFeeQp).toFixed(4),
      );
      const interest = parseFloat(
        (application.amountQp * (dto.interestRate ?? application.interestRate) * (application.termDays / 365)).toFixed(4),
      );

      application.status = LoanStatus.ACTIVE;
      application.approvedBy = officerUserId;
      application.approvedAt = new Date();
      application.disbursedAt = new Date();
      application.interestRate = dto.interestRate ?? application.interestRate;
      application.termDays = dto.termDays ?? application.termDays;
      application.outstandingQp = parseFloat((application.amountQp + interest).toFixed(4));
      application.notes = dto.notes ?? null;

      // Disburse from FI entity account to borrower
      const disburseTx = await this.qpoints.transfer(
        {
          toUserId: application.borrowerUserId,
          amount: netDisbursement,
          description: `Loan disbursement #${applicationId}`,
          metadata: {
            transactionSubType: TransactionType.TRANSFER,
            loanApplicationId: applicationId,
            loanType: 'LOAN_DISBURSEMENT',
          },
        },
        officerUserId,
      );

      // Route origination fee to AI Treasury
      if (application.originationFeeQp > 0) {
        await this.qpoints.transfer(
          {
            toUserId: AI_TREASURY_USER_ID,
            amount: application.originationFeeQp,
            description: `Loan origination fee #${applicationId}`,
            metadata: { loanApplicationId: applicationId, loanType: 'LOAN_ORIGINATION_FEE' },
          },
          officerUserId,
        );
      }

      application.disbursementTxId = disburseTx.id;
      const saved = await queryRunner.manager.save(application);

      await queryRunner.commitTransaction();
      this.logger.log(`Loan ${applicationId} approved and disbursed by officer ${officerUserId}`);
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Reject a pending loan application.
   */
  async rejectLoan(applicationId: string, officerUserId: string, notes?: string): Promise<LoanApplication> {
    const application = await this.findApplicationOrFail(applicationId);
    if (application.status !== LoanStatus.PENDING) {
      throw new BadRequestException(`Loan ${applicationId} is not in pending status`);
    }
    application.status = LoanStatus.REJECTED;
    application.approvedBy = officerUserId;
    application.approvedAt = new Date();
    application.notes = notes ?? null;
    return this.loanRepo.save(application);
  }

  /**
   * Repay a loan (manual or system auto-sweep).
   */
  async repayLoan(
    applicationId: string,
    payerUserId: string,
    dto: RepayLoanDto,
    isAutoSweep = false,
  ): Promise<LoanRepayment> {
    const application = await this.findApplicationOrFail(applicationId);

    if (application.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(`Loan ${applicationId} is not active`);
    }

    const repayAmount = Math.min(dto.amountQp, parseFloat(application.outstandingQp.toString()));

    const tx = await this.qpoints.transfer(
      {
        toUserId: application.fiEntityId,
        amount: repayAmount,
        description: `Loan repayment #${applicationId}`,
        metadata: { loanApplicationId: applicationId, loanType: 'LOAN_REPAYMENT', isAutoSweep },
      },
      payerUserId,
    );

    const repayment = await this.repaymentRepo.save(
      this.repaymentRepo.create({
        applicationId,
        amountQp: repayAmount,
        txId: tx.id,
        isAutoSweep,
      }),
    );

    // Update outstanding balance
    const newOutstanding = parseFloat(
      (parseFloat(application.outstandingQp.toString()) - repayAmount).toFixed(4),
    );
    application.outstandingQp = newOutstanding;
    if (newOutstanding <= 0) {
      application.status = LoanStatus.REPAID;
    }
    await this.loanRepo.save(application);

    this.logger.log(
      `Repayment of ${repayAmount} QP for loan ${applicationId} (outstanding: ${newOutstanding})`,
    );
    return repayment;
  }

  /**
   * Get all loan applications for a borrower or FI.
   */
  async getApplications(userId: string): Promise<LoanApplication[]> {
    return this.loanRepo.find({
      where: [{ borrowerUserId: userId }, { fiEntityId: userId }],
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async findApplicationOrFail(id: string): Promise<LoanApplication> {
    const app = await this.loanRepo.findOne({ where: { id } });
    if (!app) throw new NotFoundException(`Loan application ${id} not found`);
    return app;
  }

  async getVerifiedFiProfile(entityId: string): Promise<FiProfile> {
    const profile = await this.fiProfileRepo.findOne({ where: { entityId } });
    if (!profile) throw new NotFoundException(`FI profile for entity ${entityId} not found`);
    if (!profile.licenseVerified) {
      throw new ForbiddenException(`FI ${entityId} is not license-verified`);
    }
    return profile;
  }
}
