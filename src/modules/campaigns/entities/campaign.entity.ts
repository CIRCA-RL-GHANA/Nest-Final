import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum CampaignStatus { DRAFT = 'draft', ACTIVE = 'active', PAUSED = 'paused', ENDED = 'ended', CANCELLED = 'cancelled' }
export enum CampaignType { DISCOUNT = 'discount', BUNDLE = 'bundle', FLASH_SALE = 'flash_sale', LOYALTY = 'loyalty', REFERRAL = 'referral' }

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid') @ApiProperty() id: string;

  @Column({ name: 'entity_id' }) @ApiProperty() entityId: string;
  @Column({ nullable: true, name: 'branch_id' }) @ApiProperty({ required: false }) branchId?: string;

  @Column() @ApiProperty() name: string;
  @Column({ nullable: true }) @ApiProperty({ required: false }) description?: string;

  @Column({ type: 'enum', enum: CampaignType }) @ApiProperty({ enum: CampaignType }) type: CampaignType;
  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  @ApiProperty({ enum: CampaignStatus }) status: CampaignStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'start_date' }) @ApiProperty({ required: false }) startDate?: Date;
  @Column({ type: 'timestamptz', nullable: true, name: 'end_date' }) @ApiProperty({ required: false }) endDate?: Date;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true }) @ApiProperty({ required: false }) budget?: number;
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 }) @ApiProperty() spent: number;

  @Column({ type: 'jsonb', nullable: true }) @ApiProperty({ required: false }) targeting?: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true }) @ApiProperty({ required: false }) rules?: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true }) @ApiProperty({ required: false }) metrics?: Record<string, any>;

  @Column({ name: 'created_by' }) @ApiProperty() createdBy: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at' }) deletedAt?: Date;
}
