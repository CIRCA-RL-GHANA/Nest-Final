import { IsNotEmpty, IsUUID, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferQPointsDto {
  @ApiProperty({ description: 'Source account ID (derived from JWT if omitted)', example: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @ApiProperty({ description: 'Destination account ID (derived from toUserId if omitted)', example: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  destinationAccountId?: string;

  @ApiProperty({ description: 'Recipient user ID (alternative to destinationAccountId)', example: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiProperty({ description: 'Amount to transfer', example: 50.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Transfer description', required: false, example: 'Payment for services' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Additional metadata', type: 'object', required: false })
  @IsOptional()
  metadata?: Record<string, any>;
}
