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
    _purpose: string,
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

    if (dto.interestRate !== undefined && dto.interestRate !== application.interestRate) {
      throw new BadRequestException(
        `Interest rate mismatch: application quoted ${application.interestRate}, ` +
        `approval attempted ${dto.interestRate}. Create a new application if terms changed.`,
      );
    }

    const netDisbursement = parseFloat(
      (application.amountQp - application.originationFeeQp).toFixed(4),
    );
    const effectiveRate = application.interestRate;
    const effectiveTermDays = dto.termDays ?? application.termDays;
    const interest = parseFloat(
      (application.amountQp * effectiveRate * (effectiveTermDays / 365)).toFixed(4),
    );

    // ISSUE-O: perform transfers FIRST so the loan is never ACTIVE without funds.
    // Step 1: Disburse from FI entity account to borrower
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

    // Step 2: Route origination fee to AI Treasury (best-effort; disbursal already succeeded)
    if (application.originationFeeQp > 0) {
      await this.qpoints.transfer(
        {
          toUserId: AI_TREASURY_USER_ID,
          amount: application.originationFeeQp,
          description: `Loan origination fee #${applicationId}`,
          metadata: { loanApplicationId: applicationId, loanType: 'LOAN_ORIGINATION_FEE' },
        },
        officerUserId,
      ).catch((feeErr: Error) => {
        this.logger.error(
          `Origination fee routing failed for loan ${applicationId} — disbursal already succeeded: ${feeErr.message}`,
        );
      });
    }

    // Step 3: Atomically flip status to ACTIVE now that funds are confirmed transferred.
    // Use a pessimistic lock to guard against concurrent approval attempts.
    const saved = await this.dataSource.transaction(async (manager) => {
      const app = await manager.getRepository(LoanApplication).findOne({
        where: { id: applicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!app) throw new BadRequestException(`Loan ${applicationId} not found`);
      if (app.status !== LoanStatus.PENDING) {
        throw new BadRequestException(`Loan ${applicationId} was already processed concurrently`);
      }
      app.status = LoanStatus.ACTIVE;
      app.approvedBy = officerUserId;
      app.approvedAt = new Date();
      app.disbursedAt = new Date();
      app.termDays = effectiveTermDays;
      app.outstandingQp = parseFloat((application.amountQp + interest).toFixed(4));
      app.notes = dto.notes ?? null;
      app.disbursementTxId = disburseTx.id;
      return manager.getRepository(LoanApplication).save(app);
    }).catch(async (dbErr: Error) => {
      // DB update failed after successful transfer — reverse the disbursement.
      this.logger.error(
        `Loan ${applicationId} DB update failed after disbursal — reversing: ${dbErr.message}`,
      );
      await this.qpoints.transfer(
        {
          toUserId: officerUserId,
          amount: netDisbursement,
          description: `Loan disbursement reversal #${applicationId}`,
          metadata: { loanApplicationId: applicationId, loanType: 'LOAN_DISBURSEMENT_REVERSAL' },
        },
        application.borrowerUserId,
      ).catch((revErr: Error) => {
        this.logger.error(
          `CRITICAL: Loan disbursal reversal failed for ${applicationId} — manual intervention required: ${revErr.message}`,
        );
      });
      throw dbErr;
    });

    this.logger.log(`Loan ${applicationId} approved and disbursed by officer ${officerUserId}`);
    return saved;
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

    // ISSUE-30: perform QP transfer first, then atomically persist repayment + loan update
    const tx = await this.qpoints.transfer(
      {
        toUserId: application.fiEntityId,
        amount: repayAmount,
        description: `Loan repayment #${applicationId}`,
        metadata: { loanApplicationId: applicationId, loanType: 'LOAN_REPAYMENT', isAutoSweep },
      },
      payerUserId,
    );

    const repayment = await this.dataSource.transaction(async (manager) => {
      const newOutstanding = parseFloat(
        (parseFloat(application.outstandingQp.toString()) - repayAmount).toFixed(4),
      );
      application.outstandingQp = newOutstanding;
      if (newOutstanding <= 0) {
        application.status = LoanStatus.REPAID;
      }

      const saved = await manager.getRepository(LoanRepayment).save(
        manager.getRepository(LoanRepayment).create({
          applicationId,
          amountQp: repayAmount,
          txId: tx.id,
          isAutoSweep,
        }),
      );
      await manager.getRepository(LoanApplication).save(application);
      return saved;
    }).catch(async (dbErr: Error) => {
      // ISSUE-C: DB transaction failed after successful QP transfer — reverse it.
      this.logger.error(
        `Loan ${applicationId} DB update failed after QP transfer — reversing: ${dbErr.message}`,
      );
      await this.qpoints.transfer(
        {
          toUserId: payerUserId,
          amount: repayAmount,
          description: `Loan repayment reversal #${applicationId}`,
          metadata: { loanApplicationId: applicationId, loanType: 'LOAN_REPAYMENT_REVERSAL', isAutoSweep },
        },
        application.fiEntityId,
      ).catch((revErr: Error) => {
        this.logger.error(
          `CRITICAL: Loan repayment reversal failed for ${applicationId} — manual intervention required: ${revErr.message}`,
        );
      });
      throw dbErr;
    });

    this.logger.log(
      `Repayment of ${repayAmount} QP for loan ${applicationId} (outstanding: ${application.outstandingQp})`,
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
