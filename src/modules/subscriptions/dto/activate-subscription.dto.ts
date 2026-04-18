import { IsNotEmpty, IsUUID, IsEnum, IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionTargetType } from '../entities/subscription-assignment.entity';

export class ActivateSubscriptionDto {
  @ApiProperty({
    description: 'Target type (Entity or Branch)',
    enum: SubscriptionTargetType,
    example: SubscriptionTargetType.ENTITY,
  })
  @IsNotEmpty()
  @IsEnum(SubscriptionTargetType)
  targetType: SubscriptionTargetType;

  @ApiProperty({ description: 'Target ID (Entity or Branch ID)', example: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  targetId: string;

  @ApiProperty({ description: 'Subscription plan ID', example: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  planId: string;

  @ApiProperty({ description: 'Entity ID (for Q-Points deduction)', example: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  entityId: string;

  @ApiProperty({
    description:
      'Number of active staff members. Monthly cost = pricePerStaffQPoints × staffCount. ' +
      'Defaults to 1 if not provided.',
    example: 5,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  staffCount?: number;
}
