import { IsUUID, IsNumber, IsString, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplyLoanDto {
  @ApiProperty({ description: 'FI entity ID to apply to. If omitted, all verified FIs are queried.', required: false })
  @IsOptional()
  @IsUUID()
  fiEntityId?: string;

  @ApiProperty({ description: 'Loan amount in Q-Points', example: 1000 })
  @IsNumber()
  @Min(1)
  amountQp: number;

  @ApiProperty({ description: 'Purpose of the loan', example: 'inventory' })
  @IsString()
  @MaxLength(500)
  purpose: string;

  @ApiProperty({ description: 'Desired term in days', example: 30, required: false })
  @IsOptional()
  @IsNumber()
  @Min(7)
  @Max(1825)
  termDays?: number;
}

export class ApproveLoanDto {
  @ApiProperty({ description: 'Final interest rate (overrides FI default if set)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  interestRate?: number;

  @ApiProperty({ description: 'Term in days', required: false })
  @IsOptional()
  @IsNumber()
  @Min(7)
  termDays?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RepayLoanDto {
  @ApiProperty({ description: 'Amount in Q-Points to repay' })
  @IsNumber()
  @Min(0.01)
  amountQp: number;
}
