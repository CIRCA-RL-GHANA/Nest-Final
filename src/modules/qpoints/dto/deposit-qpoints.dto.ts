import { IsNotEmpty, IsUUID, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DepositQPointsDto {
  @ApiProperty({ description: 'Account ID to deposit into (derived from JWT if omitted)', example: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({ description: 'Amount to deposit', example: 100.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Payment reference/method', example: 'Bank Transfer', required: false })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiProperty({ description: 'Description (alias for paymentReference)', example: 'Wallet top-up', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Additional metadata', type: 'object', required: false })
  @IsOptional()
  metadata?: Record<string, any>;
}
