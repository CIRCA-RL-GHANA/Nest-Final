import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { Ride } from './entities/ride.entity';
import { RideTracking } from './entities/ride-tracking.entity';
import { RideFeedback } from './entities/ride-feedback.entity';
import { RideReferral } from './entities/ride-referral.entity';
import { WaitTimeTracking } from './entities/wait-time-tracking.entity';
import { RideSOSAlert } from './entities/ride-sos-alert.entity';
import { QPointsModule } from '../qpoints/qpoints.module';
import { AIModule } from '../ai/ai.module';
import { GoogleMapsModule } from '../google-maps/google-maps.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ride,
      RideTracking,
      RideFeedback,
      RideReferral,
      WaitTimeTracking,
      RideSOSAlert,
    ]),
    QPointsModule,
    AIModule,
    GoogleMapsModule,
  ],
  controllers: [RidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}
