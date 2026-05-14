import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';
import { User } from '@/modules/users/entities/user.entity';

export enum RecurrenceFrequency {
  NONE = 'none',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

@Entity('calendar_events')
@Index(['userId'])
export class CalendarEvent extends BaseEntity {
  @ApiProperty({
    description: 'User ID who owns this event',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({
    description: 'Event title',
    example: 'Team Meeting',
  })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty({
    description: 'Event date and time',
    example: '2024-01-15T10:00:00Z',
  })
  @Column({ type: 'timestamp with time zone' })
  date: Date;

  @ApiProperty({
    description: 'Event description',
    example: 'Quarterly planning meeting',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'Whether the event is recurring',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  recurring: boolean;

  @ApiProperty({
    description: 'Recurrence frequency',
    enum: RecurrenceFrequency,
    example: RecurrenceFrequency.NONE,
  })
  @Column({ type: 'enum', enum: RecurrenceFrequency, default: RecurrenceFrequency.NONE })
  frequency: RecurrenceFrequency;

  @ApiProperty({
    description: 'Event location',
    example: 'Conference Room A',
    required: false,
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  @ApiProperty({
    description: 'Event duration in minutes',
    example: 60,
    required: false,
  })
  @Column({ type: 'integer', nullable: true })
  durationMinutes: number | null;

  @ApiProperty({
    description: 'Whether user should be reminded',
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  reminderEnabled: boolean;

  @ApiProperty({
    description: 'Reminder time in minutes before event',
    example: 30,
    required: false,
  })
  @Column({ type: 'integer', nullable: true })
  reminderMinutes: number | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;
}
