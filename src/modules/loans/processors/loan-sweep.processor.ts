import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoanApplication, LoanStatus } from '../entities/loan-application.entity';
import { LoansService } from '../loans.service';

export interface LoanSweepJobData {
  applicationId: string;
  borrowerUserId: string;
  sweepAmountQp: number;
}

@Processor('loan-sweep')
export class LoanSweepProcessor {
  private readonly logger = new Logger(LoanSweepProcessor.name);

  constructor(
    @InjectRepository(LoanApplication)
    private readonly loanRepo: Repository<LoanApplication>,
    private readonly loansService: LoansService,
  ) {}

  @Process('auto-sweep')
  async handleAutoSweep(job: Job<LoanSweepJobData>): Promise<void> {
    const { applicationId, borrowerUserId, sweepAmountQp } = job.data;
    this.logger.log(`Auto-sweep job for loan ${applicationId}: ${sweepAmountQp} QP`);

    const application = await this.loanRepo.findOne({ where: { id: applicationId } });
    if (!application || application.status !== LoanStatus.ACTIVE) {
      this.logger.warn(`Skipping auto-sweep: loan ${applicationId} not active`);
      return;
    }

    const outstanding = parseFloat(application.outstandingQp.toString());
    if (outstanding <= 0) {
      this.logger.log(`Loan ${applicationId} already repaid, skipping sweep`);
      return;
    }

    const repayAmount = Math.min(sweepAmountQp, outstanding);

    try {
      await this.loansService.repayLoan(
        applicationId,
        borrowerUserId,
        { amountQp: repayAmount },
        true,
      );
      this.logger.log(`Auto-sweep of ${repayAmount} QP completed for loan ${applicationId}`);
    } catch (err) {
      this.logger.error(`Auto-sweep failed for loan ${applicationId}: ${err.message}`, err.stack);
      throw err;
    }
  }
}
