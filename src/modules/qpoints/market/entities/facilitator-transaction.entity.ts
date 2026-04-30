import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { FacilitatorProvider } from '../services/payment-facilitator.service';

export enum FacilitatorTransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

export enum FacilitatorTransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Tracks every deposit (on-ramp) and withdrawal (off-ramp) request
 * initiated through a licensed payment facilitator.
 *
 * The platform NEVER holds user funds. This table records intent and outcome.
 * Actual money movement is performed by the facilitator and confirmed via webhook.
 *
 * Idempotency: idempotencyKey is globally unique — prevents double submission.
 * Status machine: pending → processing → completed | failed | cancelled
 */
@Entity('facilitator_transactions')
@Index('idx_ft_user_id', ['userId'])
@Index('idx_ft_external_id', ['externalId'])
@Index('idx_ft_user_type_created', ['userId', 'type', 'createdAt'])
export class FacilitatorTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Internal platform user ID. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Which payment facilitator is processing this transaction. */
  @Column({ type: 'varchar', length: 32 })
  provider: FacilitatorProvider;

  /** deposit = on-ramp (fiat → facilitator account); withdraw = off-ramp (facilitator → bank). */
  @Column({
    type: 'enum',
    enum: FacilitatorTransactionType,
  })
  type: FacilitatorTransactionType;

  /** Amount in the declared currency, 2 decimal places. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /** ISO 4217 currency code (default USD — converted by facilitator if needed). */
  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: FacilitatorTransactionStatus,
    default: FacilitatorTransactionStatus.PENDING,
  })
  status: FacilitatorTransactionStatus;

  /**
   * The ID returned by the facilitator (PaymentIntent ID, transfer code,
   * payout ID, reference UUID, etc.). Used to match incoming webhooks.
   */
  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  externalId?: string;

  /**
   * Globally unique key used when calling the facilitator API to prevent
   * duplicate charges on retries.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, unique: true })
  idempotencyKey: string;

  /**
   * For deposit flows that redirect the user to a hosted checkout page
   * (Stripe Checkout, Paystack, Flutterwave, etc.).
   * The frontend opens this URL in the system browser.
   */
  @Column({ name: 'checkout_url', type: 'varchar', length: 1024, nullable: true })
  checkoutUrl?: string;

  /** Error details when status = failed. */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  /** Set when status transitions to completed. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
