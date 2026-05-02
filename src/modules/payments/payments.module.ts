import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../entities/payment.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { AIModule } from '../ai/ai.module';
import { QPointsModule } from '../qpoints/qpoints.module';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), WalletsModule, AIModule, QPointsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
