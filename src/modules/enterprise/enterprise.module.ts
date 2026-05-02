import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnterpriseProfile } from './entities/enterprise-profile.entity';
import { EnterpriseApiKey } from './entities/enterprise-api-key.entity';
import { EnterpriseService } from './enterprise.service';
import { EnterpriseController } from './enterprise.controller';
import { EnterpriseAnalyticsService } from './enterprise-analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([EnterpriseProfile, EnterpriseApiKey])],
  controllers: [EnterpriseController],
  providers: [EnterpriseService, EnterpriseAnalyticsService],
  exports: [EnterpriseService, EnterpriseAnalyticsService, TypeOrmModule],
})
export class EnterpriseModule {}
