import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { TabStatus } from '../entities/tab.entity';

export class CreateTabDto {
  @ApiProperty() @IsString() entityId: string;
  @ApiProperty() @IsString() customerId: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() displayName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currency?: string;
}

export class UpdateTabDto extends PartialType(CreateTabDto) {
  @ApiProperty({ enum: TabStatus, required: false }) @IsOptional() @IsEnum(TabStatus) status?: TabStatus;
}

export class ChargeTabDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
}

export class SettleTabDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
}
