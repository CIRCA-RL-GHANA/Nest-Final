import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum AlertPriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum AlertStatus {
  NEW = 'new',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  VERIFIED = 'verified',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

export enum AlertCategory {
  PAYMENT = 'payment',
  SHIPMENT = 'shipment',
  SYSTEM = 'system',
  DRIVER_RIDE = 'driver_ride',
  RETURN_REFUND = 'return_refund',
  ACCOUNT = 'account',
  SECURITY = 'security',
  OTHER = 'other',
}

@Entity('alerts')
@Index(['entityId', 'status'])
@Index(['entityId', 'priority'])
@Index(['assigneeId'])
export class Alert extends BaseEntity {
  @ApiProperty() @Column({ type: 'varchar', length: 500 }) title: string;
  @ApiProperty() @Column({ type: 'text' }) description: string;

  @ApiProperty({ enum: AlertPriority })
  @Column({ type: 'enum', enum: AlertPriority, default: AlertPriority.MEDIUM })
  priority: AlertPriority;

  @ApiProperty({ enum: AlertStatus })
  @Column({ type: 'enum', enum: AlertStatus, default: AlertStatus.NEW })
  status: AlertStatus;

  @ApiProperty({ enum: AlertCategory })
  @Column({ type: 'enum', enum: AlertCategory, default: AlertCategory.OTHER })
  category: AlertCategory;

  @Column({ type: 'varchar', length: 100, nullable: true }) subCategory: string | null;
  @Column({ type: 'varchar', length: 200, default: 'System' }) createdBy: string;

  // The entity (business) this alert belongs to
  @Index() @Column({ type: 'uuid', nullable: true }) entityId: string | null;

  // Assignee info
  @Column({ type: 'uuid', nullable: true }) assigneeId: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) assigneeName: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) assigneeRole: string | null;

  @Column({ type: 'simple-array', nullable: true }) tags: string[];

  @Column({ type: 'jsonb', nullable: true }) slaInfo: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) technicalDetails: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) resolution: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: '[]' }) timeline: Record<string, unknown>[];

  @Column({ type: 'boolean', default: false }) isBookmarked: boolean;
}
