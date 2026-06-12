import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('webhook_subscriptions')
export class WebhookSubscription extends BaseEntity {
  @ApiProperty({ description: 'Entity (enterprise) that owns this subscription' })
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ description: 'HTTPS URL to deliver events to' })
  @Column({ type: 'text' })
  url: string;

  @ApiProperty({ description: 'SHA-256 hash of the signing secret (for display/lookup only)' })
  @Column({ type: 'text' })
  secretHash: string;

  @ApiProperty({ description: 'AES-256-GCM encrypted signing secret (used for HMAC delivery)' })
  @Column({ type: 'text', nullable: true })
  secretEncrypted: string | null;

  @ApiProperty({ description: 'First 8 chars of secret for display' })
  @Column({ type: 'varchar', length: 8 })
  secretPrefix: string;

  @ApiProperty({ description: 'List of event types subscribed to', type: [String] })
  @Column({ type: 'jsonb', default: [] })
  events: string[];

  @ApiProperty({ description: 'Whether the subscription is active' })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Number of successful deliveries' })
  @Column({ type: 'int', default: 0 })
  deliveryCount: number;

  @ApiProperty({ description: 'Number of consecutive failures' })
  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveredAt: Date | null;
}
