import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum EventType {
  USER_ACTION = 'user_action',
  SYSTEM_EVENT = 'system_event',
  MODEL_PREDICTION = 'model_prediction',
  WORKFLOW_EVENT = 'workflow_event',
}

@Entity('ai_events')
@Index(['eventType'])
@Index(['entityType'])
@Index(['userId'])
@Index(['createdAt'])
export class AIEvent extends BaseEntity {
  @ApiProperty({ description: 'Event type', enum: EventType })
  @Column({ type: 'enum', enum: EventType })
  eventType: EventType;

  @ApiProperty({ description: 'Event name' })
  @Column({ type: 'varchar', length: 100 })
  eventName: string;

  @ApiProperty({ description: 'Entity type' })
  @Column({ type: 'varchar', length: 50 })
  entityType: string;

  @ApiProperty({ description: 'Entity ID' })
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ description: 'User ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty({ description: 'Event payload', type: 'object' })
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @ApiProperty({ description: 'Event metadata', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({ description: 'Whether event was processed' })
  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @ApiProperty({ description: 'When event was processed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;
}
