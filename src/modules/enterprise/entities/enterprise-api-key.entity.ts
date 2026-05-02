import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ApiKeyPermission {
  PAYMENTS = 'payments',
  ORDERS = 'orders',
  PRODUCTS = 'products',
  FULFILLMENT = 'fulfillment',
  EPLAY = 'eplay',
  ANALYTICS = 'analytics',
  MULTI_CHANNEL = 'multi_channel',
  CONCIERGE = 'concierge',
  FACILITATOR = 'facilitator',
  ALL = 'all',
}

@Entity('enterprise_api_keys')
export class EnterpriseApiKey extends BaseEntity {
  @ApiProperty({ description: 'Enterprise entity ID this key belongs to' })
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ description: 'bcrypt hash of the raw API key' })
  @Column({ type: 'varchar', length: 255 })
  keyHash: string;

  @ApiProperty({ description: 'First 8 chars of the key for display (pk_live_XXXXXXXX...)' })
  @Column({ type: 'varchar', length: 20 })
  keyPrefix: string;

  @ApiProperty({ description: 'Human-readable label' })
  @Column({ type: 'varchar', length: 200, default: 'Default Key' })
  label: string;

  @ApiProperty({ description: 'Permissions granted to this key' })
  @Column({ type: 'jsonb', default: () => "'[\"all\"]'" })
  permissions: ApiKeyPermission[];

  @ApiProperty({ description: 'Whether the key is still active' })
  @Column({ type: 'boolean', default: true })
  @Index()
  isActive: boolean;

  @ApiProperty({ required: false, description: 'Optional expiry timestamp' })
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ required: false, description: 'IP whitelist (CIDR ranges)' })
  @Column({ type: 'jsonb', nullable: true })
  ipWhitelist: string[] | null;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
