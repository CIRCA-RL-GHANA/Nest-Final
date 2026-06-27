import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum TabStatus { OPEN = 'open', SUSPENDED = 'suspended', CLOSED = 'closed' }

@Entity('tabs')
export class Tab {
  @PrimaryGeneratedColumn('uuid') @ApiProperty() id: string;

  @Column({ name: 'entity_id' }) @ApiProperty() entityId: string;
  @Column({ name: 'customer_id' }) @ApiProperty() customerId: string;
  @Column({ nullable: true, name: 'display_name' }) @ApiProperty({ required: false }) displayName?: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 }) @ApiProperty() balance: number;
  @Column({ type: 'decimal', precision: 18, scale: 4, name: 'credit_limit', default: 0 }) @ApiProperty() creditLimit: number;

  @Column({ type: 'enum', enum: TabStatus, default: TabStatus.OPEN }) @ApiProperty({ enum: TabStatus }) status: TabStatus;
  @Column({ default: 'QP' }) @ApiProperty() currency: string;

  @Column({ name: 'created_by' }) @ApiProperty() createdBy: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at' }) deletedAt?: Date;
}
