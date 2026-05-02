import { IsUUID, IsEnum, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InstitutionTier } from '../entities/institution-config.entity';

export class OnboardInstitutionDto {
  @ApiProperty({ description: 'Entity ID to register as an institutional facilitator' })
  @IsUUID()
  entityId: string;

  @ApiPropertyOptional({ enum: InstitutionTier })
  @IsEnum(InstitutionTier)
  @IsOptional()
  tier?: InstitutionTier;

  @ApiProperty({ description: 'Maximum QP issuance cap approved for this institution' })
  @IsNumber()
  @Min(0)
  issueCap: number;

  @ApiPropertyOptional({ description: 'Facility fee rate (default 0.001)' })
  @IsNumber()
  @Min(0)
  @Max(0.1)
  @IsOptional()
  facilityFeeRate?: number;
}

export class IssueQpDto {
  @ApiProperty({ description: 'Entity ID of the issuing institution' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ description: 'QP amount to mint' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason / reference for the issuance' })
  @IsOptional()
  reason?: string;
}

export class InitiateSettlementDto {
  @ApiProperty({ description: 'Source entity ID (debtor)' })
  @IsUUID()
  fromEntityId: string;

  @ApiProperty({ description: 'Destination entity ID (creditor)' })
  @IsUUID()
  toEntityId: string;

  @ApiProperty({ description: 'QP amount to net-settle' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  reference?: string;
}
