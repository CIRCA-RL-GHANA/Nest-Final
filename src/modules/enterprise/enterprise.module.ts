import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnterpriseProfile } from './entities/enterprise-profile.entity';
import { EnterpriseApiKey } from './entities/enterprise-api-key.entity';
import { EnterpriseService } from './enterprise.service';
import { EnterpriseController } from './enterprise.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EnterpriseProfile, EnterpriseApiKey])],
  controllers: [EnterpriseController],
  providers: [EnterpriseService],
  exports: [EnterpriseService, TypeOrmModule],
})
export class EnterpriseModule {}
