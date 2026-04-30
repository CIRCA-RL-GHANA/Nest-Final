import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { FacilitatorProvider } from '../services/payment-facilitator.service';

/**
 * Stores the external account / recipient ID that a payment facilitator
 * (Flutterwave, Paystack, …) issued for a platform user.
 *
 * One row per (userId, provider) pair – a user can onboard to multiple
 * providers independently.
 *
 * The `externalId` interpretation is provider-specific:
 *   - Paystack    → recipient_code  (e.g. "RCP_xxxxxxxxxxxxxxxxxx")
 *   - Flutterwave → "bankCode|accountNumber" composite (e.g. "044|0690000031")
 *   - mock        → "mock_acct_<userId>"
 */
@Entity('facilitator_accounts')
@Index('uq_facilitator_accounts_user_provider', ['userId', 'provider'], { unique: true })
export class FacilitatorAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Internal platform user ID. */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('idx_facilitator_accounts_user_id')
  userId: string;

  /** Which external payment provider owns this account record. */
  @Column({
    type: 'varchar',
    length: 32,
  })
  provider: FacilitatorProvider;

  /**
   * The provider-issued account or recipient identifier.
   * Used as the destination in transfer API calls.
   */
  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId: string;

  /**
   * Optional extra data returned by the provider at account creation
   * (account name, bank name, currency, etc.) stored for audit / display.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  /**
   * The provider-issued payout destination used for withdrawals.
   * For Stripe: "ba_..." (bank account ID on the connected account).
   * For Paystack: recipient_code (e.g. "RCP_...").
   * For Flutterwave: "bankCode|accountNumber".
   * For MTN MoMo / M-Pesa: phone number in international format.
   * For Wise: profileId or recipient account ID.
   * Populated at registration via meta.payoutMethodId or updated separately.
   */
  @Column({ name: 'default_payout_method_id', type: 'varchar', length: 255, nullable: true })
  defaultPayoutMethodId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
