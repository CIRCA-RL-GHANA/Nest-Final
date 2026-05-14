import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum PostType {
  TEXT = 'text',
  LINK = 'link',         // Link to an e-Play asset or external content
  POLL = 'poll',
  EVENT = 'event',       // For HANGOUT communities
  LISTING = 'listing',   // For FAIR communities (market item reference)
}

@Entity('community_posts')
@Index(['communityId'])
@Index(['authorId'])
@Index(['type'])
@Index(['communityId', 'createdAt'])
export class CommunityPost extends BaseEntity {
  @ApiProperty({ description: 'Community this post belongs to' })
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty({ description: 'User who authored the post' })
  @Column({ type: 'uuid' })
  authorId: string;

  @ApiProperty({ enum: PostType })
  @Column({ type: 'enum', enum: PostType, default: PostType.TEXT })
  type: PostType;

  @ApiProperty({ description: 'Post title / headline', required: false })
  @Column({ type: 'varchar', length: 500, nullable: true })
  title: string | null;

  @ApiProperty({ description: 'Post body text', required: false })
  @Column({ type: 'text', nullable: true })
  body: string | null;

  @ApiProperty({ description: 'Linked content ID (e-Play asset, market product, etc.)', required: false })
  @Column({ type: 'uuid', nullable: true })
  linkedContentId: string | null;

  @ApiProperty({ description: 'Extra type-specific data (poll options, event details, etc.)', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ description: 'Like count', example: 0 })
  @Column({ type: 'int', default: 0 })
  likeCount: number;

  @ApiProperty({ description: 'Comment count', example: 0 })
  @Column({ type: 'int', default: 0 })
  commentCount: number;

  @ApiProperty({ description: 'Whether moderators have pinned this post', default: false })
  @Column({ type: 'boolean', default: false })
  isPinned: boolean;

  @ApiProperty({ description: 'Whether the post has been removed by moderation', default: false })
  @Column({ type: 'boolean', default: false })
  isRemoved: boolean;
}
