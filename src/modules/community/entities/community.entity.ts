import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * The 7 community archetypes defined in the spec.
 */
export enum CommunityType {
  LIBRARY = 'library',    // Curation & discussion for e-books / media
  PLAYLIST = 'playlist',  // Social curation of audio/video content sequences
  THEATER = 'theater',    // Synchronous media viewing groups
  FAIR = 'fair',          // Ephemeral pop-up marketplace
  HUB = 'hub',            // Topical asynchronous forum
  HANGOUT = 'hangout',    // Geospatial/temporal event manager
  JOURNAL = 'journal',    // Personal & shared documentation / blog
}

export enum CommunityStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  SUSPENDED = 'suspended',
}

export enum CommunityVisibility {
  PUBLIC = 'public',
  INVITE_ONLY = 'invite_only',
  PRIVATE = 'private',
}

@Entity('communities')
@Index(['type'])
@Index(['ownerId'])
@Index(['status'])
@Index(['visibility'])
@Index(['name'])
export class Community extends BaseEntity {
  @ApiProperty({ description: 'Community name', example: 'Afrobeats Book Club' })
  @Column({ length: 200 })
  name: string;

  @ApiProperty({ description: 'Short description of the community', required: false })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ enum: CommunityType })
  @Column({ type: 'enum', enum: CommunityType })
  type: CommunityType;

  @ApiProperty({ enum: CommunityStatus })
  @Column({ type: 'enum', enum: CommunityStatus, default: CommunityStatus.ACTIVE })
  status: CommunityStatus;

  @ApiProperty({ enum: CommunityVisibility })
  @Column({ type: 'enum', enum: CommunityVisibility, default: CommunityVisibility.PUBLIC })
  visibility: CommunityVisibility;

  @ApiProperty({ description: 'User ID of community creator / owner' })
  @Column({ type: 'uuid' })
  ownerId: string;

  @ApiProperty({ description: 'Cover / banner image URL', required: false })
  @Column({ length: 500, nullable: true })
  coverUrl: string | null;

  @ApiProperty({ description: 'Member count (denormalised for fast reads)', example: 0 })
  @Column({ type: 'int', default: 0 })
  memberCount: number;

  @ApiProperty({ description: 'Post count (denormalised)', example: 0 })
  @Column({ type: 'int', default: 0 })
  postCount: number;

  @ApiProperty({
    description: 'Type-specific metadata (e.g. scheduled event time for HANGOUT, linked e-Play asset IDs for THEATER)',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ description: 'Tags for discovery', required: false })
  @Column({ length: 500, nullable: true })
  tags: string | null;
}
