import { IsString, IsEnum, IsOptional, IsArray, IsUUID, IsBoolean, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlertPriority, AlertStatus, AlertCategory } from '../entities/alert.entity';

export class UpdateAlertDto {
  @ApiPropertyOptional() @IsString() @MaxLength(500) @IsOptional() title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: AlertPriority }) @IsEnum(AlertPriority) @IsOptional() priority?: AlertPriority;
  @ApiPropertyOptional({ enum: AlertStatus }) @IsEnum(AlertStatus) @IsOptional() status?: AlertStatus;
  @ApiPropertyOptional({ enum: AlertCategory }) @IsEnum(AlertCategory) @IsOptional() category?: AlertCategory;
  @ApiPropertyOptional() @IsString() @IsOptional() subCategory?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() assigneeId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() assigneeName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() assigneeRole?: string;
  @ApiPropertyOptional({ type: [String] }) @IsArray() @IsOptional() tags?: string[];
  @ApiPropertyOptional() @IsOptional() slaInfo?: Record<string, unknown>;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isBookmarked?: boolean;
}

export class ResolveAlertDto {
  @ApiPropertyOptional() @IsString() @IsOptional() method?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() summary?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() rootCause?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() preventionMeasures?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() resolverName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerNotified?: string;
  @ApiPropertyOptional() @IsOptional() qualityScore?: number;
}

export class AddTimelineEventDto {
  @ApiPropertyOptional() @IsString() @IsOptional() type?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() actorName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() details?: string;
}
