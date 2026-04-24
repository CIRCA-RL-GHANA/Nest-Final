import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DigitalAsset } from './entities/digital-asset.entity';
import { EplayLicense } from './entities/eplay-license.entity';
import { CreatorProfile } from './entities/creator-profile.entity';
import { RevenueRecord } from '../revenue/entities/revenue-record.entity';
import { EplayService } from './eplay.service';
import { EplayController } from './eplay.controller';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DigitalAsset,
      EplayLicense,
      CreatorProfile,
      RevenueRecord,
    ]),
    WalletsModule,
  ],
  controllers: [EplayController],
  providers: [EplayService],
  exports: [EplayService],
})
export class EplayModule {}
