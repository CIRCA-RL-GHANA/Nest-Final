import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionAssignment } from './entities/subscription-assignment.entity';
import { QPointAccount } from '@modules/qpoints/entities/qpoint-account.entity';
import { BoosterPointsAccount } from '@modules/qpoints/entities/booster-points-account.entity';
import { EntityProfile } from '@modules/entities/entities/entity.entity';
import { AuditLog } from '@modules/users/entities/audit-log.entity';
import { AIModule } from '../ai/ai.module';
import { RevenueModule } from '@modules/revenue/revenue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      SubscriptionAssignment,
      QPointAccount,
      BoosterPointsAccount,
      EntityProfile,
      AuditLog,
    ]),
    AIModule,
    RevenueModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService, TypeOrmModule],
})
export class SubscriptionsModule {}
