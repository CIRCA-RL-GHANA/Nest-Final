import {
  IsUUID, IsEnum, IsString, IsOptional, IsBoolean, IsUrl, MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ChannelType } from '../entities/multi-channel-config.entity';

export class RegisterChannelDto {
  @ApiProperty()
  @IsUUID()
  entityId: string;

  @ApiProperty({ enum: ChannelType })
  @IsEnum(ChannelType)
  channelType: ChannelType;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  channelName: string;

  @ApiProperty({ required: false, description: 'Channel API credentials' })
  @IsOptional()
  credentials?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}

export class SyncChannelDto {
  @ApiProperty({ required: false, description: 'Force full resync instead of incremental' })
  @IsOptional()
  @IsBoolean()
  fullResync?: boolean;
}
