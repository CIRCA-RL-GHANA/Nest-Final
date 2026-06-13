import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('alerts')
export class Alert {
  @ApiProperty({ description: 'UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'User who owns this alert' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'Optional entity scope', required: false })
  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @ApiProperty({ description: 'Alert title' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty({ description: 'Alert body text' })
  @Column({ type: 'text' })
  body: string;

  @ApiProperty({ description: 'Alert type: info|warning|critical|success', default: 'info' })
  @Column({ type: 'varchar', length: 50, default: 'info' })
  type: string;

  @ApiProperty({ description: 'Status: open|resolved|dismissed', default: 'open' })
  @Column({ type: 'varchar', length: 50, default: 'open' })
  status: string;

  @ApiProperty({ description: 'Priority: low|medium|high|urgent', default: 'medium' })
  @Column({ type: 'varchar', length: 50, default: 'medium' })
  priority: string;

  @ApiProperty({ description: 'Category label', required: false })
  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @ApiProperty({ description: 'Tags array', required: false })
  @Column({ type: 'simple-json', nullable: true })
  tags: string[] | null;

  @ApiProperty({ description: 'Extra metadata', required: false })
  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({ description: 'When alert was resolved', required: false })
  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ description: 'User ID who resolved', required: false })
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
