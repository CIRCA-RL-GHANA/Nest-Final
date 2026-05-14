import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('ai_workflows')
@Index(['workflowType'])
@Index(['status'])
@Index(['createdAt'])
export class AIWorkflow extends BaseEntity {
  @ApiProperty({ description: 'Workflow name' })
  @Column({ type: 'varchar', length: 100 })
  workflowName: string;

  @ApiProperty({ description: 'Workflow type' })
  @Column({ type: 'varchar', length: 50 })
  workflowType: string;

  @ApiProperty({ description: 'Workflow status', enum: WorkflowStatus })
  @Column({ type: 'enum', enum: WorkflowStatus, default: WorkflowStatus.PENDING })
  status: WorkflowStatus;

  @ApiProperty({ description: 'Workflow configuration', type: 'object' })
  @Column({ type: 'jsonb' })
  config: Record<string, any>;

  @ApiProperty({ description: 'Current step', required: false })
  @Column({ type: 'varchar', length: 100, nullable: true })
  currentStep: string | null;

  @ApiProperty({ description: 'Total steps' })
  @Column({ type: 'int', default: 0 })
  totalSteps: number;

  @ApiProperty({ description: 'Completed steps' })
  @Column({ type: 'int', default: 0 })
  completedSteps: number;

  @ApiProperty({ description: 'Workflow results', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  results: Record<string, any> | null;

  @ApiProperty({ description: 'Error message', required: false })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ApiProperty({ description: 'When workflow started', required: false })
  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ description: 'When workflow completed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @ApiProperty({ description: 'Triggered by user ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  triggeredBy: string | null;
}
