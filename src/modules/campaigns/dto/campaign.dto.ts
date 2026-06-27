import { IsString, IsEnum, IsOptional, IsDateString, IsNumber, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CampaignType, CampaignStatus } from '../entities/campaign.entity';
import { PartialType } from '@nestjs/swagger';

export class CreateCampaignDto {
  @ApiProperty() @IsString() entityId: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: CampaignType }) @IsEnum(CampaignType) type: CampaignType;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() endDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() budget?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() targeting?: Record<string, any>;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() rules?: Record<string, any>;
}

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {
  @ApiProperty({ enum: CampaignStatus, required: false }) @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
}
