import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateDepositDto {
  @ApiProperty({
    example: 100.00,
    description: 'Deposit amount. Min $1, max $10,000.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiProperty({
    example: 'USD',
    required: false,
    description: 'ISO 4217 currency code. Defaults to USD.',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}
