import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepositAccount } from './entities/deposit-account.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { DepositMaturityScheduler } from './schedulers/deposit-maturity.scheduler';
import { QPointsModule } from '../qpoints/qpoints.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DepositAccount, FiProfile]),
    QPointsModule,
  ],
  controllers: [DepositsController],
  providers: [DepositsService, DepositMaturityScheduler],
  exports: [DepositsService, TypeOrmModule],
})
export class DepositsModule {}
