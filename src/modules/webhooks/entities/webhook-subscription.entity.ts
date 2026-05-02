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

  @ApiProperty({ description: 'HMAC-SHA256 signing secret (stored hashed)' })
  @Column({ type: 'text' })
  secretHash: string;

  @ApiProperty({ description: 'First 8 chars of secret for display' })
  @Column({ length: 8 })
  secretPrefix: string;

  @ApiProperty({ description: 'List of event types subscribed to', type: [String] })
  @Column({ type: 'jsonb', default: [] })
  events: string[];

  @ApiProperty({ description: 'Whether the subscription is active' })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Number of successful deliveries' })
  @Column({ default: 0 })
  deliveryCount: number;

  @ApiProperty({ description: 'Number of consecutive failures' })
  @Column({ default: 0 })
  failureCount: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveredAt: Date | null;
}
