import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MultiChannelConfig } from './entities/multi-channel-config.entity';
import { MultiChannelService } from './multi-channel.service';
import { MultiChannelController } from './multi-channel.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MultiChannelConfig])],
  controllers: [MultiChannelController],
  providers: [MultiChannelService],
  exports: [MultiChannelService, TypeOrmModule],
})
export class MultiChannelModule {}
