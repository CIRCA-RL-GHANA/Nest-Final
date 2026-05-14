import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum TransactionType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',
  TRANSFER = 'Transfer',
  PURCHASE = 'Purchase',
  REFUND = 'Refund',
  REWARD = 'Reward',
  FEE = 'Fee',
  PENALTY = 'Penalty',
  // â”€â”€ Financial Institution Extension â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  LOAN_DISBURSEMENT = 'LoanDisbursement',
  LOAN_REPAYMENT = 'LoanRepayment',
  LOAN_ORIGINATION_FEE = 'LoanOriginationFee',
  DEPOSIT_LOCK = 'DepositLock',
  DEPOSIT_UNLOCK = 'DepositUnlock',
  DEPOSIT_INTEREST = 'DepositInterest',
  INSURANCE_PREMIUM = 'InsurancePremium',
  INSURANCE_CLAIM_PAYOUT = 'InsuranceClaimPayout',
  CREDIT_DATA_FEE = 'CreditDataFee',
}

export enum TransactionStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  REVERSED = 'Reversed',
  CANCELLED = 'Cancelled',
  FLAGGED = 'Flagged',
}

export enum RiskLevel {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  CRITICAL = 'Critical',
}

@Entity('qpoint_transactions')
export class QPointTransaction extends BaseEntity {
  @ApiProperty({
    description: 'Source account ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  sourceAccountId: string | null;

  @ApiProperty({
    description: 'Destination account ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  destinationAccountId: string | null;

  @ApiProperty({
    description: 'Transaction amount',
    example: 100.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @ApiProperty({
    description: 'Transaction type',
    enum: TransactionType,
    example: TransactionType.TRANSFER,
  })
  @Column({ type: 'enum', enum: TransactionType })
  @Index()
  type: TransactionType;

  @ApiProperty({
    description: 'Transaction status',
    enum: TransactionStatus,
    example: TransactionStatus.COMPLETED,
  })
  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  @Index()
  status: TransactionStatus;

  @ApiProperty({
    description: 'Transaction reference/ID',
    example: 'TXN-20240101-123456',
  })
  @Column({ type: 'varchar', unique: true })
  @Index()
  reference: string;

  @ApiProperty({
    description: 'Transaction description',
    example: 'Payment for Order #12345',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'User ID who initiated the transaction',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  @Index()
  initiatedBy: string | null;

  @ApiProperty({
    description: 'Balance before transaction',
    example: 1000.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  balanceBefore: number;

  @ApiProperty({
    description: 'Balance after transaction',
    example: 1100.0,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  balanceAfter: number;

  @ApiProperty({
    description: 'Transaction fee (if applicable)',
    example: 1.5,
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  fee: number;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({
    description: 'IP address of transaction initiator',
    required: false,
  })
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @ApiProperty({
    description: 'Error message (if failed)',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  // AML & Fraud Detection Fields
  @ApiProperty({
    description: 'Risk score (0-100)',
    example: 25,
  })
  @Column({ type: 'int', default: 0 })
  riskScore: number;

  @ApiProperty({
    description: 'Risk level',
    enum: RiskLevel,
    example: RiskLevel.LOW,
  })
  @Column({ type: 'enum', enum: RiskLevel, default: RiskLevel.LOW })
  @Index()
  riskLevel: RiskLevel;

  @ApiProperty({
    description: 'Whether transaction is flagged for fraud',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  @Index()
  fraudFlag: boolean;

  @ApiProperty({
    description: 'Fraud detection reason',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  fraudReason: string | null;

  @ApiProperty({
    description: 'Whether transaction is verified',
    example: true,
  })
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @ApiProperty({
    description: 'Whether transaction is approved',
    example: true,
  })
  @Column({ type: 'boolean', default: false })
  approved: boolean;

  @ApiProperty({
    description: 'Approval timestamp',
    required: false,
  })
  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @ApiProperty({
    description: 'User who approved the transaction',
    required: false,
  })
  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  @ApiProperty({
    description: 'Device fingerprint',
    required: false,
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceFingerprint: string | null;

  @ApiProperty({
    description: 'Geolocation data',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  geolocation: Record<string, any> | null;

  @ApiProperty({
    description: 'Fee waived flag',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  feeWaived: boolean;
}
