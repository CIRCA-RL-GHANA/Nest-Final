import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { LoanApplication } from './entities/loan-application.entity';
import { LoanRepayment } from './entities/loan-repayment.entity';
import { FiProfile } from './entities/fi-profile.entity';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { LoanSweepProcessor } from './processors/loan-sweep.processor';
import { QPointsModule } from '../qpoints/qpoints.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LoanApplication, LoanRepayment, FiProfile]),
    BullModule.registerQueue({ name: 'loan-sweep' }),
    QPointsModule,
  ],
  controllers: [LoansController],
  providers: [LoansService, LoanSweepProcessor],
  exports: [LoansService, TypeOrmModule],
})
export class LoansModule {}
