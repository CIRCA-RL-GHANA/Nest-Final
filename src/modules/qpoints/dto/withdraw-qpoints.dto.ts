import { IsNotEmpty, IsUUID, IsNumber, IsString, IsOptional, IsObject, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawQPointsDto {
  @ApiProperty({ description: 'Account ID to withdraw from (derived from JWT if omitted)', example: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({ description: 'Amount to withdraw', example: 75.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Withdrawal method', example: 'Bank Account', required: false })
  @IsOptional()
  @IsString()
  withdrawalMethod?: string;

  @ApiProperty({ description: 'Destination details (bank account, etc)', example: '1234567890', required: false })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiProperty({ description: 'Description (alias for destination)', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Additional metadata', required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
