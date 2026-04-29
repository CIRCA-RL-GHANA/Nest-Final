import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../../users/entities/user.entity';
import { FacilitatorProvider } from '../services/payment-facilitator.service';

export enum QPointOrderType {
  BUY = 'buy',
  SELL = 'sell',
}

export enum QPointOrderStatus {
  OPEN = 'open',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

@Entity('q_point_orders')
@Index('idx_qpo_user_status', ['userId', 'status'])
export class QPointOrder {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Owner of the order (AI participant uses 00000000-0000-0000-0000-000000000001)',
  })
  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ enum: QPointOrderType })
  @Column({ type: 'text' })
  type: QPointOrderType;

  @ApiProperty({ description: 'Price per Q Point in fiat (USD)', example: 0.95 })
  @Column({ type: 'decimal', precision: 10, scale: 4 })
  price: number;

  @ApiProperty({ description: 'Total Q Points in the order', example: 100 })
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @ApiProperty({ description: 'Amount already matched', example: 0 })
  @Column({ name: 'filled_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  filledQuantity: number;

  @ApiProperty({ enum: QPointOrderStatus })
  @Column({ type: 'text', default: QPointOrderStatus.OPEN })
  status: QPointOrderStatus;

  /**
   * The payment facilitator linked to this order.
   * Used to route cross-facilitator trades through the AI bridge.
   * Null = facilitator-agnostic (AI Participant's non-bridge orders).
   */
  @ApiPropertyOptional({ description: 'Payment facilitator for this order (for cross-facilitator routing)' })
  @Column({ name: 'facilitator_id', type: 'varchar', length: 32, nullable: true })
  @Index('idx_qpo_facilitator')
  facilitatorId?: FacilitatorProvider;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  /** Remaining quantity available for matching */
  get remainingQuantity(): number {
    return Number(this.quantity) - Number(this.filledQuantity);
  }
}
