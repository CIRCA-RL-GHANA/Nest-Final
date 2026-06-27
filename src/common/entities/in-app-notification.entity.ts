import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('in_app_notifications')
export class InAppNotificationEntity extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any> | null;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;
}
