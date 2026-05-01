import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditDataQuery } from './entities/credit-data-query.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { LoanApplication } from '../loans/entities/loan-application.entity';
import { CreditDataService } from './credit-data.service';
import { CreditDataController } from './credit-data.controller';
import { QPointsModule } from '../qpoints/qpoints.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CreditDataQuery, FiProfile, LoanApplication]),
    QPointsModule,
  ],
  controllers: [CreditDataController],
  providers: [CreditDataService],
  exports: [CreditDataService, TypeOrmModule],
})
export class CreditDataModule {}
