import { IsString, IsOptional, IsNumber, IsDateString, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCampaignDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() type?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() endDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() budget?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() targetAudience?: Record<string, any>;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() content?: Record<string, any>;
}
