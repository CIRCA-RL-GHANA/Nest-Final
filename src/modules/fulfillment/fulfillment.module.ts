import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FulfillmentRoutingRule, FulfillmentTask } from './entities/fulfillment.entity';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentController } from './fulfillment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FulfillmentRoutingRule, FulfillmentTask])],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService, TypeOrmModule],
})
export class FulfillmentModule {}
