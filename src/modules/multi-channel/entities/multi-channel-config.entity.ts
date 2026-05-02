import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ChannelType {
  SHOPIFY = 'shopify',
  WALMART = 'walmart',
  AMAZON = 'amazon',
  MAGENTO = 'magento',
  WOOCOMMERCE = 'woocommerce',
  CUSTOM = 'custom',
  POS = 'pos',
  MARKETPLACE = 'marketplace',
}

export enum ChannelSyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  ERROR = 'error',
  PAUSED = 'paused',
}

@Entity('multi_channel_configs')
export class MultiChannelConfig extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ enum: ChannelType })
  @Column({ type: 'enum', enum: ChannelType })
  channelType: ChannelType;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  channelName: string;

  @ApiProperty({ description: 'Encrypted channel credentials (store URL, API key, secret)' })
  @Column({ type: 'jsonb', nullable: true })
  credentials: Record<string, any> | null;

  @ApiProperty({ enum: ChannelSyncStatus })
  @Column({ type: 'enum', enum: ChannelSyncStatus, default: ChannelSyncStatus.IDLE })
  syncStatus: ChannelSyncStatus;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  lastSyncError: string | null;

  @ApiProperty({ description: 'Whether this channel is active' })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ required: false, description: 'Webhook URL to push events to this channel' })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  webhookUrl: string | null;
}
