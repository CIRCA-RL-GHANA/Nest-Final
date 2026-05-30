import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Place } from './entities/place.entity';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { AIModule } from '../ai/ai.module';
import { GoogleMapsModule } from '../google-maps/google-maps.module';

@Module({
  imports: [TypeOrmModule.forFeature([Place]), AIModule, GoogleMapsModule],
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [TypeOrmModule, PlacesService],
})
export class PlacesModule {}
