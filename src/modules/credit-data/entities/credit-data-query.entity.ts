import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

// Intentionally lightweight – no soft delete, this is an immutable audit log.
import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('credit_data_queries')
export class CreditDataQuery {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  requestingFiEntityId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  subjectUserId: string;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  consentId: string | null;

  @ApiProperty({ required: false, description: 'Computed credit score 0–1000' })
  @Column({ type: 'int', nullable: true })
  score: number | null;

  @ApiProperty({ required: false })
  @Column({ type: 'jsonb', nullable: true })
  dataJson: Record<string, any> | null;

  @ApiProperty({ description: 'Per-query fee charged to FI in Q-Points' })
  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  feeQp: number;

  @ApiProperty({ required: false })
  @Column({ type: 'uuid', nullable: true })
  feeTxId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
