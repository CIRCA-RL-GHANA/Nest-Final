import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('campaigns')
export class Campaign {
  @ApiProperty({ description: 'UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Entity that owns this campaign' })
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ description: 'Campaign name' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ description: 'Type: discount|referral|loyalty|awareness', default: 'awareness' })
  @Column({ type: 'varchar', length: 50, default: 'awareness' })
  type: string;

  @ApiProperty({ description: 'Status: draft|active|paused|ended', default: 'draft' })
  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status: string;

  @ApiProperty({ description: 'Campaign start date' })
  @Column({ type: 'timestamp' })
  startDate: Date;

  @ApiProperty({ description: 'Campaign end date' })
  @Column({ type: 'timestamp' })
  endDate: Date;

  @ApiProperty({ description: 'Budget', required: false })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  budget: number | null;

  @ApiProperty({ description: 'Target audience filters', required: false })
  @Column({ type: 'simple-json', nullable: true })
  targetAudience: Record<string, any> | null;

  @ApiProperty({ description: 'Campaign content definition' })
  @Column({ type: 'simple-json' })
  content: Record<string, any>;

  @ApiProperty({ description: 'Impression count', default: 0 })
  @Column({ type: 'int', default: 0 })
  impressions: number;

  @ApiProperty({ description: 'Click count', default: 0 })
  @Column({ type: 'int', default: 0 })
  clicks: number;

  @ApiProperty({ description: 'Conversion count', default: 0 })
  @Column({ type: 'int', default: 0 })
  conversions: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
