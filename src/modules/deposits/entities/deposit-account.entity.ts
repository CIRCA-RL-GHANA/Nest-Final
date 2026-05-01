import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum DepositStatus {
  ACTIVE = 'active',
  MATURED = 'matured',
  WITHDRAWN = 'withdrawn',
  CANCELLED = 'cancelled',
}

@Entity('deposit_accounts')
export class DepositAccount extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  fiEntityId: string;

  @ApiProperty({ description: 'Amount locked in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  lockedQp: number;

  @ApiProperty({ description: 'Annual interest rate (e.g. 0.08 = 8%)' })
  @Column({ type: 'numeric', precision: 6, scale: 4, default: 0.08 })
  interestRate: number;

  @ApiProperty({ description: 'Term in days' })
  @Column({ type: 'int', default: 90 })
  termDays: number;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  @Index()
  maturityDate: Date;

  @ApiProperty({ enum: DepositStatus })
  @Column({ type: 'enum', enum: DepositStatus, default: DepositStatus.ACTIVE })
  @Index()
  status: DepositStatus;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  lockTxId: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  unlockTxId: string | null;

  @ApiProperty({ description: 'Interest earned and paid out to user' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  interestPaidQp: number;
}
