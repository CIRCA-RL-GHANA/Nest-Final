import {
  IsUUID,
  IsNumber,
  IsEnum,
  IsString,
  IsOptional,
  Min,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { InsurancePolicyType } from '../entities/insurance-policy.entity';

export class PurchasePolicyDto {
  @ApiProperty()
  @IsUUID()
  fiEntityId: string;

  @ApiProperty({ enum: InsurancePolicyType })
  @IsEnum(InsurancePolicyType)
  policyType: InsurancePolicyType;

  @ApiProperty({ description: 'Max coverage in Q-Points' })
  @IsNumber()
  @Min(1)
  coverageQp: number;

  @ApiProperty({ description: 'Premium in Q-Points' })
  @IsNumber()
  @Min(0.01)
  premiumQp: number;

  @ApiProperty({ description: 'Policy duration in days', example: 365 })
  @IsNumber()
  @Min(1)
  durationDays: number;

  @ApiProperty({ required: false })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class FileClaimDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  amountClaimedQp: number;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  attachments?: Record<string, any>[];
}

export class ReviewClaimDto {
  @ApiProperty({ description: 'approved | rejected' })
  @IsString()
  action: 'approved' | 'rejected';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewerNotes?: string;
}
