import {
  IsUUID, IsEnum, IsOptional, IsString, IsBoolean,
  IsArray, IsNumber, MaxLength, IsUrl,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EnterpriseType } from '../entities/enterprise-profile.entity';
import { ApiKeyPermission } from '../entities/enterprise-api-key.entity';

export class RegisterEnterpriseDto {
  @ApiProperty({ description: 'Entity ID of the enterprise' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ enum: EnterpriseType, required: false })
  @IsOptional()
  @IsEnum(EnterpriseType)
  enterpriseType?: EnterpriseType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  licenceDocumentUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiProperty({ required: false, description: 'Integration pathways (1–5)' })
  @IsOptional()
  @IsArray()
  enabledPathways?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  settings?: Record<string, any>;
}

export class UpdateEnterpriseSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  settings?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  enabledPathways?: number[];
}

export class VerifyEnterpriseDto {
  @ApiProperty()
  @IsBoolean()
  verified: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isFacilitator?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  qpIssuanceCap?: number;
}

export class CreateApiKeyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ enum: ApiKeyPermission, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(ApiKeyPermission, { each: true })
  permissions?: ApiKeyPermission[];

  @ApiProperty({ required: false })
  @IsOptional()
  expiresAt?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  ipWhitelist?: string[];
}
