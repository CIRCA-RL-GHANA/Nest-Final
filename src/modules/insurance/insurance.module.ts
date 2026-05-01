import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsurancePolicy } from './entities/insurance-policy.entity';
import { InsuranceClaim } from './entities/insurance-claim.entity';
import { FiProfile } from '../loans/entities/fi-profile.entity';
import { InsuranceService } from './insurance.service';
import { InsuranceController } from './insurance.controller';
import { QPointsModule } from '../qpoints/qpoints.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InsurancePolicy, InsuranceClaim, FiProfile]),
    QPointsModule,
  ],
  controllers: [InsuranceController],
  providers: [InsuranceService],
  exports: [InsuranceService, TypeOrmModule],
})
export class InsuranceModule {}
