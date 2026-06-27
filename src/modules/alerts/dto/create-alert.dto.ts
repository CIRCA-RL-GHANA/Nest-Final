import { IsString, IsEnum, IsOptional, IsArray, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertPriority, AlertCategory } from '../entities/alert.entity';

export class CreateAlertDto {
  @ApiProperty() @IsString() @MaxLength(500) title: string;
  @ApiProperty() @IsString() description: string;

  @ApiPropertyOptional({ enum: AlertPriority })
  @IsEnum(AlertPriority) @IsOptional() priority?: AlertPriority;

  @ApiPropertyOptional({ enum: AlertCategory })
  @IsEnum(AlertCategory) @IsOptional() category?: AlertCategory;

  @ApiPropertyOptional() @IsString() @IsOptional() subCategory?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() createdBy?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() entityId?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() assigneeId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() assigneeName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() assigneeRole?: string;
  @ApiPropertyOptional({ type: [String] }) @IsArray() @IsOptional() tags?: string[];
  @ApiPropertyOptional() @IsOptional() slaInfo?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() technicalDetails?: Record<string, unknown>;
}
