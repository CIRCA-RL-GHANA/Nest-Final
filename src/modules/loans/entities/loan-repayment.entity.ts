import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('loan_repayments')
export class LoanRepayment extends BaseEntity {
  @ApiProperty({ description: 'Loan application ID' })
  @Column({ type: 'uuid' })
  @Index()
  applicationId: string;

  @ApiProperty({ description: 'Repayment amount in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  amountQp: number;

  @ApiProperty({ required: false, description: 'Q-Points ledger transaction ID' })
  @Column({ type: 'uuid', nullable: true })
  txId: string | null;

  @ApiProperty({ description: 'Was this triggered by automated revenue sweep?' })
  @Column({ type: 'boolean', default: false })
  isAutoSweep: boolean;
}
