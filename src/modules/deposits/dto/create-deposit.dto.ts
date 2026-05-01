import { IsUUID, IsNumber, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDepositDto {
  @ApiProperty({ description: 'FI entity ID' })
  @IsUUID()
  fiEntityId: string;

  @ApiProperty({ description: 'Amount in Q-Points to lock' })
  @IsNumber()
  @Min(1)
  amountQp: number;

  @ApiProperty({ description: 'Term in days (min 7, max 1825)' })
  @IsInt()
  @Min(7)
  @Max(1825)
  termDays: number;
}
