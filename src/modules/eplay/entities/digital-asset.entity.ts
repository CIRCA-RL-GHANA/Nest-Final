import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum DigitalAssetType {
  MUSIC = 'music',
  MOVIE = 'movie',
  PODCAST = 'podcast',
  EBOOK = 'ebook',
  SHOW = 'show',
}

export enum DigitalAssetStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  UNLISTED = 'unlisted',
  REMOVED = 'removed',
}

export enum AccessModel {
  PERPETUAL = 'perpetual',  // Buy-once cloud access forever
  RENTAL = 'rental',        // Time-bound (e.g. 30 days)
  SUBSCRIPTION = 'subscription', // Active while plan is active
}

/**
 * A piece of digital IP content uploaded by a creator.
 * Content is NOT downloaded â€” it lives in the user's cloud locker (EplayLicense).
 */
@Entity('digital_assets')
@Index(['creatorProfileId'])
@Index(['type'])
@Index(['status'])
@Index(['title'])
export class DigitalAsset extends BaseEntity {
  @ApiProperty({ description: 'Content title', example: 'Afrobeats Vol. 1' })
  @Column({ type: 'varchar', length: 300 })
  title: string;

  @ApiProperty({ description: 'Content description', required: false })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ enum: DigitalAssetType })
  @Column({ type: 'enum', enum: DigitalAssetType })
  type: DigitalAssetType;

  @ApiProperty({ enum: DigitalAssetStatus })
  @Column({ type: 'enum', enum: DigitalAssetStatus, default: DigitalAssetStatus.DRAFT })
  status: DigitalAssetStatus;

  @ApiProperty({ enum: AccessModel })
  @Column({ type: 'enum', enum: AccessModel, default: AccessModel.PERPETUAL })
  accessModel: AccessModel;

  @ApiProperty({ description: 'Creator profile ID (references creator_profiles)' })
  @Column({ type: 'uuid' })
  creatorProfileId: string;

  @ApiProperty({ description: 'Price in Q Points', example: 5.00 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceQPoints: number;

  @ApiProperty({ description: 'Rental duration in days (for RENTAL access model)', required: false })
  @Column({ type: 'int', nullable: true })
  rentalDurationDays: number | null;

  @ApiProperty({ description: 'Cover art / thumbnail URL' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  coverUrl: string | null;

  @ApiProperty({ description: 'Encrypted storage reference (S3 key or CDN token â€” never raw URL)' })
  @Column({ type: 'varchar', length: 500 })
  encryptedStorageRef: string;

  @ApiProperty({ description: 'Duration in seconds (audio/video)', required: false })
  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ description: 'File size in bytes', required: false })
  @Column({ type: 'bigint', nullable: true })
  fileSizeBytes: number | null;

  @ApiProperty({ description: 'Comma-separated genre tags', required: false })
  @Column({ type: 'varchar', length: 500, nullable: true })
  tags: string | null;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 geo-restriction codes (empty = no restriction)', required: false })
  @Column({ type: 'jsonb', nullable: true })
  allowedRegions: string[] | null;

  @ApiProperty({ description: 'Platform royalty percentage (0-100)', example: 15 })
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 15 })
  platformRoyaltyPct: number;

  @ApiProperty({ description: 'Total purchase count', example: 0 })
  @Column({ type: 'int', default: 0 })
  purchaseCount: number;

  @ApiProperty({ description: 'Total play / open count', example: 0 })
  @Column({ type: 'int', default: 0 })
  playCount: number;
}
