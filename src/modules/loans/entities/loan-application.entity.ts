import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum LoanStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  ACTIVE = 'active',
  REPAID = 'repaid',
  DEFAULTED = 'defaulted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('loan_applications')
export class LoanApplication extends BaseEntity {
  @ApiProperty({ description: 'Borrower user ID' })
  @Column({ type: 'uuid' })
  @Index()
  borrowerUserId: string;

  @ApiProperty({ description: 'FI entity ID offering the loan' })
  @Column({ type: 'uuid' })
  @Index()
  fiEntityId: string;

  @ApiProperty({ description: 'Loan amount in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  amountQp: number;

  @ApiProperty({ description: 'Purpose of the loan' })
  @Column({ type: 'varchar', length: 500 })
  purpose: string;

  @ApiProperty({ enum: LoanStatus })
  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.PENDING })
  @Index()
  status: LoanStatus;

  @ApiProperty({ description: 'Annual interest rate (e.g. 0.15 = 15%)' })
  @Column({ type: 'numeric', precision: 6, scale: 4, default: 0.15 })
  interestRate: number;

  @ApiProperty({ description: 'Loan term in days' })
  @Column({ type: 'int', default: 30 })
  termDays: number;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamptz', nullable: true })
  disbursedAt: Date | null;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  disbursementTxId: string | null;

  @ApiProperty({ description: '1% origination fee deducted at disbursement' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  originationFeeQp: number;

  @ApiProperty({ description: 'Remaining outstanding balance in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  outstandingQp: number;

  @ApiProperty({ description: 'Auto-sweep percentage of incoming revenue (0.10 = 10%)' })
  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.10 })
  autoSweepPct: number;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
