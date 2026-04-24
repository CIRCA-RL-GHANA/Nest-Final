import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum LicenseStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

/**
 * A user's cloud locker entry — their right to access a DigitalAsset.
 * This is the "e-play cloud slot": content is never downloaded locally.
 * Pinning for offline use is handled client-side as a temporary cache,
 * but the authoritative record of access lives here.
 */
@Entity('eplay_licenses')
@Index(['userId'])
@Index(['digitalAssetId'])
@Index(['userId', 'digitalAssetId'], { unique: true })
@Index(['status'])
@Index(['expiresAt'])
export class EplayLicense extends BaseEntity {
  @ApiProperty({ description: 'User who purchased access' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'The content item' })
  @Column({ type: 'uuid' })
  digitalAssetId: string;

  @ApiProperty({ enum: LicenseStatus })
  @Column({ type: 'enum', enum: LicenseStatus, default: LicenseStatus.ACTIVE })
  status: LicenseStatus;

  @ApiProperty({ description: 'When access expires (null = perpetual)', required: false })
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ description: 'Q Points paid at time of purchase', example: 5.00 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amountPaidQPoints: number;

  @ApiProperty({ description: 'Reference to the payment / QPoints transaction', required: false })
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @ApiProperty({ description: 'Last streamed / accessed timestamp', required: false })
  @Column({ type: 'timestamptz', nullable: true })
  lastAccessedAt: Date | null;

  @ApiProperty({ description: 'Client-side pin for offline access', default: false })
  @Column({ type: 'boolean', default: false })
  isPinned: boolean;
}
