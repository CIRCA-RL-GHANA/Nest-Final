import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum FeatureType {
  NUMERICAL = 'numerical',
  CATEGORICAL = 'categorical',
  TEXT = 'text',
  EMBEDDING = 'embedding',
}

@Entity('ai_features')
@Index(['entityType'])
@Index(['featureName'])
export class AIFeature extends BaseEntity {
  @ApiProperty({ description: 'Entity type (user, product, order, etc.)' })
  @Column({ type: 'varchar', length: 50 })
  entityType: string;

  @ApiProperty({ description: 'Entity ID' })
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ description: 'Feature name' })
  @Column({ type: 'varchar', length: 100 })
  featureName: string;

  @ApiProperty({ description: 'Feature type', enum: FeatureType })
  @Column({ type: 'enum', enum: FeatureType })
  featureType: FeatureType;

  @ApiProperty({ description: 'Feature value', type: 'object' })
  @Column({ type: 'jsonb' })
  featureValue: any;

  @ApiProperty({ description: 'Feature version' })
  @Column({ type: 'varchar', length: 20, default: '1.0.0' })
  version: string;

  @ApiProperty({ description: 'Feature metadata', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({ description: 'When feature was computed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  computedAt: Date | null;
}
