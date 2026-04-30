import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Idempotency log for incoming facilitator webhook events.
 *
 * Before processing any webhook, the handler checks whether the eventId already
 * exists in this table.  If it does, the event is skipped (already processed).
 * If not, the event is processed and then recorded here.
 *
 * The unique constraint on event_id prevents double-processing even under
 * concurrent webhook delivery (facilitators may send duplicates on retry).
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Provider-scoped unique event identifier.
   * Format: "{provider}:{provider_event_id}" to namespace across facilitators.
   * Example: "stripe:evt_3Px...", "paystack:charge.success:12345"
   */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  @Index('uq_webhook_event_id', { unique: true })
  eventId: string;

  /** Which facilitator sent this event. */
  @Column({ type: 'varchar', length: 64 })
  provider: string;

  /** The event type string from the provider (e.g. "payment_intent.succeeded"). */
  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType: string;

  /** Raw event payload for audit / replay. */
  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
