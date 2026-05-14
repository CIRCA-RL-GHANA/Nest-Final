import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum RecommendationType {
  PRODUCT = 'product',
  SHOP = 'shop',
  DRIVER = 'driver',
  CONTENT = 'content',
}

@Entity('ai_recommendations')
@Index(['userId'])
@Index(['recommendationType'])
@Index(['createdAt'])
export class AIRecommendation extends BaseEntity {
  @ApiProperty({ description: 'User ID' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'Recommendation type', enum: RecommendationType })
  @Column({ type: 'enum', enum: RecommendationType })
  recommendationType: RecommendationType;

  @ApiProperty({ description: 'Recommended item ID' })
  @Column({ type: 'uuid' })
  itemId: string;

  @ApiProperty({ description: 'Recommendation score (0-1)' })
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  score: number;

  @ApiProperty({ description: 'Recommendation reason' })
  @Column({ type: 'text' })
  reason: string;

  @ApiProperty({ description: 'Algorithm used' })
  @Column({ type: 'varchar', length: 100 })
  algorithm: string;

  @ApiProperty({ description: 'Whether user viewed the recommendation' })
  @Column({ type: 'boolean', default: false })
  viewed: boolean;

  @ApiProperty({ description: 'Whether user clicked the recommendation' })
  @Column({ type: 'boolean', default: false })
  clicked: boolean;

  @ApiProperty({ description: 'Whether user converted (purchased, etc.)' })
  @Column({ type: 'boolean', default: false })
  converted: boolean;

  @ApiProperty({ description: 'When user viewed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  viewedAt: Date | null;

  @ApiProperty({ description: 'When user clicked', required: false })
  @Column({ type: 'timestamp', nullable: true })
  clickedAt: Date | null;

  @ApiProperty({ description: 'When user converted', required: false })
  @Column({ type: 'timestamp', nullable: true })
  convertedAt: Date | null;

  @ApiProperty({ description: 'Recommendation metadata', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
