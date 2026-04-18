import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevenueRecord } from './entities/revenue-record.entity';
import { BusinessTransactionCounter } from './entities/business-transaction-counter.entity';
import { QPointAccount } from '@modules/qpoints/entities/qpoint-account.entity';
import { QPointMarketBalance } from '@modules/qpoints/market/entities/q-point-market-balance.entity';
import { RevenueService } from './revenue.service';
import { RevenueController } from './revenue.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RevenueRecord,
      BusinessTransactionCounter,
      QPointAccount,
      QPointMarketBalance,
    ]),
  ],
  controllers: [RevenueController],
  providers: [RevenueService],
  exports: [RevenueService],
})
export class RevenueModule {}
