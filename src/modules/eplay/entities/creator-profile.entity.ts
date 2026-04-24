import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum CreatorTier {
  INDIE = 'indie',
  VERIFIED = 'verified',
  LABEL = 'label',
}

/**
 * A creator's "digital branch" on e-Play.
 * Every creator that wants to sell digital content must open a
 * CreatorProfile — the equivalent of a merchant profile for IP.
 */
@Entity('creator_profiles')
@Index(['userId'], { unique: true })
@Index(['tier'])
@Index(['isActive'])
export class CreatorProfile extends BaseEntity {
  @ApiProperty({ description: 'User who owns this creator profile' })
  @Column({ type: 'uuid', unique: true })
  userId: string;

  @ApiProperty({ description: 'Public display name / artist name', example: 'KobiBeat' })
  @Column({ length: 200 })
  displayName: string;

  @ApiProperty({ description: 'Short bio', required: false })
  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @ApiProperty({ description: 'Profile avatar URL', required: false })
  @Column({ length: 500, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Banner image URL', required: false })
  @Column({ length: 500, nullable: true })
  bannerUrl: string | null;

  @ApiProperty({ enum: CreatorTier, default: CreatorTier.INDIE })
  @Column({ type: 'enum', enum: CreatorTier, default: CreatorTier.INDIE })
  tier: CreatorTier;

  @ApiProperty({ description: 'Payout wallet address / QPoints account ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  payoutAccountId: string | null;

  @ApiProperty({ description: 'Creator-set royalty split (platform enforces minimum)', example: 85 })
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 85 })
  creatorRoyaltyPct: number;

  @ApiProperty({ description: 'Geo licence: allowed regions (empty = worldwide)' })
  @Column({ type: 'jsonb', nullable: true })
  allowedRegions: string[] | null;

  @ApiProperty({ description: 'Whether the creator profile is accepting new uploads', default: true })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Total lifetime earnings in Q Points', example: 0 })
  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  totalEarningsQPoints: number;

  @ApiProperty({ description: 'Total assets published', example: 0 })
  @Column({ type: 'int', default: 0 })
  assetCount: number;

  @ApiProperty({ description: 'Total followers', example: 0 })
  @Column({ type: 'int', default: 0 })
  followerCount: number;
}
