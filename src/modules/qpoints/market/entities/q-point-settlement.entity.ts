import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../../users/entities/user.entity';
import { QPointTrade } from './q-point-trade.entity';

export enum SettlementType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum SettlementStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

@Entity('q_point_settlements')
@Index('idx_qps_user', ['userId'])
@Index('idx_qps_trade', ['tradeId'])
@Index('idx_qps_status', ['status'])
export class QPointSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nullable for non-trade transfers */
  @Column({ name: 'trade_id', type: 'uuid', nullable: true })
  tradeId: string | null;

  @ManyToOne(() => QPointTrade, { nullable: true })
  @JoinColumn({ name: 'trade_id' })
  trade: QPointTrade | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ description: 'Cash amount in fiat', example: 99.5 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @ApiProperty({ enum: SettlementType })
  @Column({ type: 'text' })
  type: SettlementType;

  @ApiProperty({ enum: SettlementStatus })
  @Column({ type: 'text', default: SettlementStatus.PENDING })
  status: SettlementStatus;

  @ApiProperty({ description: 'ID returned by the payment facilitator', nullable: true })
  @Column({ name: 'facilitator_reference', type: 'varchar', length: 255, nullable: true })
  facilitatorReference: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;
}
