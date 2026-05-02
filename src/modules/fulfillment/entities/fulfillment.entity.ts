import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum FulfillmentProvider {
  GENIE_LIVE = 'genie_live',
  UBER_DIRECT = 'uber_direct',
  AMAZON_MCF = 'amazon_mcf',
  GLOVO = 'glovo',
  DOORDASH_DRIVE = 'doordash_drive',
  CUSTOM = 'custom',
}

export enum FulfillmentStatus {
  PENDING = 'pending',
  DISPATCHED = 'dispatched',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * A routing rule maps an enterprise + channel/region combination to a
 * preferred fulfillment provider, with an optional fallback chain.
 */
@Entity('fulfillment_routing_rules')
export class FulfillmentRoutingRule extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ required: false, description: 'Restrict rule to a specific region code (ISO 3166-1 alpha-2)' })
  @Column({ type: 'varchar', length: 10, nullable: true })
  regionCode: string | null;

  @ApiProperty({ required: false, description: 'Restrict rule to a specific channel' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  channelType: string | null;

  @ApiProperty({ enum: FulfillmentProvider })
  @Column({ type: 'enum', enum: FulfillmentProvider })
  primaryProvider: FulfillmentProvider;

  @ApiProperty({ type: [String], enum: FulfillmentProvider, required: false })
  @Column({ type: 'jsonb', default: [] })
  fallbackProviders: FulfillmentProvider[];

  @ApiProperty({ description: 'Rule priority — lower number wins' })
  @Column({ type: 'int', default: 100 })
  priority: number;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}

/**
 * One fulfillment task per order dispatch.
 */
@Entity('fulfillment_tasks')
export class FulfillmentTask extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ApiProperty({ enum: FulfillmentProvider })
  @Column({ type: 'enum', enum: FulfillmentProvider })
  provider: FulfillmentProvider;

  @ApiProperty({ enum: FulfillmentStatus })
  @Column({ type: 'enum', enum: FulfillmentStatus, default: FulfillmentStatus.PENDING })
  status: FulfillmentStatus;

  @ApiProperty({ required: false, description: 'Tracking ID from the fulfillment provider' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  trackingId: string | null;

  @ApiProperty({ required: false, description: 'Estimated delivery timestamp' })
  @Column({ type: 'timestamptz', nullable: true })
  estimatedDeliveryAt: Date | null;

  @ApiProperty({ required: false })
  @Column({ type: 'jsonb', nullable: true })
  providerPayload: Record<string, any> | null;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  failureReason: string | null;
}
