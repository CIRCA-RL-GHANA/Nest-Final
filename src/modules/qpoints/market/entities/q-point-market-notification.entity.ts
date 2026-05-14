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

@Entity('q_point_market_notifications')
@Index('idx_qpmn_user_read', ['userId', 'read'])
export class QPointMarketNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({
    description:
      'Notification type: order_filled | order_cancelled | market_alert | trade_executed',
    example: 'order_filled',
  })
  @Column({ type: 'varchar', length: 50 })
  type: string;

  @ApiProperty({
    description: 'Human-readable message',
    example: 'Your buy order for 100 QP was filled at $0.99',
  })
  @Column({ type: 'text' })
  message: string;

  @ApiProperty({
    description: 'Structured data payload',
    example: { orderId: 'uuid', tradeId: 'uuid' },
  })
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @ApiProperty({ description: 'Whether the user has read this notification', example: false })
  @Column({ type: 'boolean', default: false })
  read: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
