import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateWithdrawalDto {
  @ApiProperty({
    example: 50.00,
    description: 'Withdrawal amount. Min $5, max $5,000.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(5)
  @Max(5000)
  amount: number;

  @ApiProperty({
    example: 'USD',
    required: false,
    description: 'ISO 4217 currency code. Defaults to USD.',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({
    example: 'ba_1Px...',
    required: false,
    description:
      'Payout method ID from the facilitator (bank account ID, recipient code, phone number). ' +
      'If omitted the account default stored at registration is used.',
  })
  @IsOptional()
  @IsString()
  payoutMethodId?: string;
}
