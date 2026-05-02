import {
  IsUUID, IsEnum, IsOptional, IsString, IsArray, IsBoolean, IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FulfillmentProvider, FulfillmentStatus } from '../entities/fulfillment.entity';

export class CreateRoutingRuleDto {
  @ApiProperty()
  @IsUUID()
  entityId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  regionCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  channelType?: string;

  @ApiProperty({ enum: FulfillmentProvider })
  @IsEnum(FulfillmentProvider)
  primaryProvider: FulfillmentProvider;

  @ApiProperty({ type: [String], enum: FulfillmentProvider, required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(FulfillmentProvider, { each: true })
  fallbackProviders?: FulfillmentProvider[];

  @ApiProperty({ required: false, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  priority?: number;
}

export class DispatchFulfillmentDto {
  @ApiProperty()
  @IsUUID()
  entityId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ required: false, description: 'If provided, override automatic routing' })
  @IsOptional()
  @IsEnum(FulfillmentProvider)
  overrideProvider?: FulfillmentProvider;

  @ApiProperty({ required: false })
  @IsOptional()
  providerPayload?: Record<string, any>;
}

export class UpdateFulfillmentStatusDto {
  @ApiProperty({ enum: FulfillmentStatus })
  @IsEnum(FulfillmentStatus)
  status: FulfillmentStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  trackingId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
