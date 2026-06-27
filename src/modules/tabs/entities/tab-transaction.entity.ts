import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum TabTransactionType { CHARGE = 'charge', SETTLEMENT = 'settlement', ADJUSTMENT = 'adjustment' }

@Entity('tab_transactions')
export class TabTransaction {
  @PrimaryGeneratedColumn('uuid') @ApiProperty() id: string;

  @Column({ name: 'tab_id' }) @ApiProperty() tabId: string;
  @Column({ type: 'enum', enum: TabTransactionType }) @ApiProperty({ enum: TabTransactionType }) type: TabTransactionType;
  @Column({ type: 'decimal', precision: 18, scale: 4 }) @ApiProperty() amount: number;
  @Column({ nullable: true }) @ApiProperty({ required: false }) description?: string;
  @Column({ nullable: true }) @ApiProperty({ required: false }) reference?: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
