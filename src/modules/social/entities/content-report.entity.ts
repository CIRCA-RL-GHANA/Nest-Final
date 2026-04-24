import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
  ACTIONED = 'actioned',
}

@Entity('content_reports')
@Index(['reporterId'])
@Index(['contentId', 'contentType'])
@Index(['status'])
export class ContentReport extends BaseEntity {
  @ApiProperty({
    description: 'Reporter user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  reporterId: string;

  @ApiProperty({
    description: 'Content ID being reported',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  contentId: string;

  @ApiProperty({
    description: 'Content type (update, comment, user)',
    example: 'update',
  })
  @Column({ type: 'varchar', length: 50 })
  contentType: string;

  @ApiProperty({
    description: 'Reason for reporting',
    example: 'spam',
  })
  @Column({ type: 'varchar', length: 100 })
  reason: string;

  @ApiProperty({
    description: 'Additional details provided by reporter',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  details: string | null;

  @ApiProperty({
    description: 'Moderation status',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;
}
