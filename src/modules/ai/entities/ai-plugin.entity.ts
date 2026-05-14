import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum PluginStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

export enum PluginType {
  TRANSFORM = 'transform',
  ENRICHMENT = 'enrichment',
  NOTIFICATION = 'notification',
  VALIDATOR = 'validator',
  CONNECTOR = 'connector',
}

@Entity('ai_plugins')
@Index(['pluginType'])
@Index(['status'])
export class AIPlugin extends BaseEntity {
  @ApiProperty({ description: 'Plugin name (unique)' })
  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @ApiProperty({ description: 'Human-readable description' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Plugin type', enum: PluginType })
  @Column({ type: 'enum', enum: PluginType })
  pluginType!: PluginType;

  @ApiProperty({ description: 'Plugin version', example: '1.0.0' })
  @Column({ type: 'varchar', length: 20, default: '1.0.0' })
  version!: string;

  @ApiProperty({ description: 'Plugin status', enum: PluginStatus })
  @Column({ type: 'enum', enum: PluginStatus, default: PluginStatus.INACTIVE })
  status!: PluginStatus;

  @ApiProperty({ description: 'Serialized plugin function body (safe eval string)' })
  @Column({ type: 'text' })
  handlerCode!: string;

  @ApiProperty({ description: 'Plugin configuration schema / defaults', type: 'object' })
  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, any> | null;

  @ApiProperty({ description: 'Allowed permission scopes', type: 'array', isArray: true })
  @Column({ type: 'simple-array', nullable: true })
  permissions!: string[] | null;

  @ApiProperty({ description: 'Max execution time in milliseconds' })
  @Column({ type: 'int', default: 5000 })
  timeoutMs!: number;

  @ApiProperty({ description: 'Total successful executions' })
  @Column({ type: 'int', default: 0 })
  executionCount!: number;

  @ApiProperty({ description: 'Total failed executions' })
  @Column({ type: 'int', default: 0 })
  errorCount!: number;

  @ApiProperty({ description: 'Last error message', required: false })
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @ApiProperty({ description: 'When plugin was last executed', required: false })
  @Column({ type: 'timestamp', nullable: true })
  lastExecutedAt!: Date | null;
}
