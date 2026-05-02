import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstitutionConfig } from './entities/institution-config.entity';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { QPointTransaction } from '../qpoints/entities/qpoint-transaction.entity';
import { FacilitatorInstitutionsService } from './facilitator-institutions.service';
import { FacilitatorInstitutionsController } from './facilitator-institutions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([InstitutionConfig, QPointAccount, QPointTransaction]),
  ],
  controllers: [FacilitatorInstitutionsController],
  providers: [FacilitatorInstitutionsService],
  exports: [FacilitatorInstitutionsService, TypeOrmModule],
})
export class FacilitatorInstitutionsModule {}
