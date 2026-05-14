import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum CreatedByType {
  ENTITY = 'Entity',
  BRANCH = 'Branch',
}

export enum ProfileVisibility {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

@Entity('market_profiles')
@Index(['uniqueMarketIdentifier'], { unique: true })
@Index(['createdByType', 'createdById'])
@Index(['visibility'])
@Index(['businessCategory'])
export class MarketProfile extends BaseEntity {
  @ApiProperty({
    description: 'Unique market identifier',
    example: 'MKT-TECH-2024-001',
  })
  @Column({ type: 'varchar', unique: true })
  uniqueMarketIdentifier: string;

  @ApiProperty({
    description: 'Type of creator (Entity or Branch)',
    enum: CreatedByType,
    example: CreatedByType.ENTITY,
  })
  @Column({ type: 'enum', enum: CreatedByType })
  createdByType: CreatedByType;

  @ApiProperty({
    description: 'Creator ID (Entity or Branch)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  createdById: string;

  @ApiProperty({
    description: 'Demographic metrics (age, gender, location, etc.)',
    type: 'object',
    example: {
      ageRange: '18-35',
      gender: ['Male', 'Female'],
      region: 'North America',
      interests: ['Technology', 'Innovation'],
    },
  })
  @Column({ type: 'jsonb' })
  demographicMetrics: Record<string, any>;

  @ApiProperty({
    description: 'Business category',
    example: 'Technology',
  })
  @Column()
  businessCategory: string;

  @ApiProperty({
    description: 'Advertisement exposure rules',
    type: 'object',
    required: false,
    example: {
      priority: 'High',
      maxDailyExposure: 1000,
      targetingCriteria: {
        interests: ['Tech', 'Innovation'],
        locations: ['Urban'],
      },
    },
  })
  @Column({ type: 'jsonb', nullable: true })
  advertisementExposureRules: Record<string, any> | null;

  @ApiProperty({
    description: 'Profile visibility',
    enum: ProfileVisibility,
    example: ProfileVisibility.PUBLIC,
  })
  @Column({ type: 'enum', enum: ProfileVisibility, default: ProfileVisibility.PRIVATE })
  visibility: ProfileVisibility;

  @ApiProperty({
    description: 'AI-refined segments',
    type: 'array',
    required: false,
    example: ['Tech Enthusiasts', 'Early Adopters'],
  })
  @Column({ type: 'jsonb', nullable: true })
  refinedSegments: string[] | null;

  @ApiProperty({
    description: 'Engagement analytics',
    type: 'object',
    required: false,
    example: {
      clickRate: 0.65,
      impressions: 5000,
      conversions: 150,
      regionEngagement: {
        'North America': 0.7,
        Europe: 0.3,
      },
    },
  })
  @Column({ type: 'jsonb', nullable: true })
  engagementAnalytics: Record<string, any> | null;

  @ApiProperty({
    description: 'Whether profile is flagged for fraud',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  fraudFlag: boolean;

  @ApiProperty({
    description: 'Last AI segmentation update',
    required: false,
  })
  @Column({ type: 'timestamp', nullable: true })
  lastAiRefinement: Date | null;
}
