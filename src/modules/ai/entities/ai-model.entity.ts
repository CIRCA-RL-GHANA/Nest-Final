import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ModelType {
  NLP = 'nlp',
  RECOMMENDATION = 'recommendation',
  PREDICTION = 'prediction',
  CLASSIFICATION = 'classification',
  REGRESSION = 'regression',
}

export enum ModelStatus {
  TRAINING = 'training',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  FAILED = 'failed',
}

@Entity('ai_models')
@Index(['modelType'])
@Index(['status'])
export class AIModel extends BaseEntity {
  @ApiProperty({ description: 'Model name', example: 'product-recommendation-v1' })
  @Column({ type: 'varchar', unique: true, length: 100 })
  name: string;

  @ApiProperty({ description: 'Model type', enum: ModelType })
  @Column({ type: 'enum', enum: ModelType })
  modelType: ModelType;

  @ApiProperty({ description: 'Model version', example: '1.0.0' })
  @Column({ type: 'varchar', length: 20 })
  version: string;

  @ApiProperty({ description: 'Model status', enum: ModelStatus })
  @Column({ type: 'enum', enum: ModelStatus, default: ModelStatus.TRAINING })
  status: ModelStatus;

  @ApiProperty({ description: 'Model description' })
  @Column({ type: 'text' })
  description: string;

  @ApiProperty({ description: 'Model configuration', type: 'object' })
  @Column({ type: 'jsonb' })
  config: Record<string, any>;

  @ApiProperty({ description: 'Model metrics', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, any> | null;

  @ApiProperty({ description: 'Model artifacts path', required: false })
  @Column({ type: 'text', nullable: true })
  artifactsPath: string | null;

  @ApiProperty({ description: 'Training started at', required: false })
  @Column({ type: 'timestamp', nullable: true })
  trainingStartedAt: Date | null;

  @ApiProperty({ description: 'Training completed at', required: false })
  @Column({ type: 'timestamp', nullable: true })
  trainingCompletedAt: Date | null;

  @ApiProperty({ description: 'Last inference at', required: false })
  @Column({ type: 'timestamp', nullable: true })
  lastInferenceAt: Date | null;

  @ApiProperty({ description: 'Total inferences count' })
  @Column({ type: 'int', default: 0 })
  inferenceCount: number;
}
