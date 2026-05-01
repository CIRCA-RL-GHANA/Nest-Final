import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DepositsService } from '../deposits.service';

/** Scheduler: runs nightly at 01:00 to mature eligible deposits. */
@Injectable()
export class DepositMaturityScheduler {
  private readonly logger = new Logger(DepositMaturityScheduler.name);

  constructor(private readonly depositsService: DepositsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async processMaturedDeposits(): Promise<void> {
    this.logger.log('Running deposit maturity sweep...');
    const matured = await this.depositsService.findMaturedDeposits();
    this.logger.log(`Found ${matured.length} deposit(s) ready for maturity payout`);

    for (const deposit of matured) {
      try {
        await this.depositsService.matureDeposit(deposit.id);
      } catch (err) {
        this.logger.error(`Failed to mature deposit ${deposit.id}: ${err.message}`, err.stack);
      }
    }
  }
}
