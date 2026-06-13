import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('tabs')
export class Tab {
  @ApiProperty({ description: 'UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Entity (merchant) this tab belongs to' })
  @Column({ type: 'uuid' })
  entityId: string;

  @ApiProperty({ description: 'Customer who holds the tab' })
  @Column({ type: 'uuid' })
  customerId: string;

  @ApiProperty({ description: 'Display label for the tab' })
  @Column({ type: 'varchar', length: 255 })
  label: string;

  @ApiProperty({ description: 'Current balance owed', default: 0 })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  @ApiProperty({ description: 'Maximum credit allowed', default: 0 })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  creditLimit: number;

  @ApiProperty({ description: 'Status: open|frozen|closed', default: 'open' })
  @Column({ type: 'varchar', length: 50, default: 'open' })
  status: string;

  @ApiProperty({ description: 'Extra metadata', required: false })
  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
