import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum HeyYaStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

/** The type of date the sender has in mind — primary dating intent. */
export enum HeyYaIntent {
  COFFEE = 'coffee',
  DINNER = 'dinner',
  WALK = 'walk',
  MOVIE = 'movie',
  VIDEO_CALL = 'video_call',
  ANY = 'any',
}

@Entity('heyya_requests')
@Index(['senderId'])
@Index(['recipientId'])
@Index(['status'])
export class HeyYaRequest extends BaseEntity {
  @ApiProperty({
    description: 'Sender (initiator) ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  senderId: string;

  @ApiProperty({
    description: 'Recipient ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  recipientId: string;

  @ApiProperty({
    description: 'Opening message from the sender',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  message: string | null;

  @ApiProperty({
    description: 'Request status',
    enum: HeyYaStatus,
    example: HeyYaStatus.PENDING,
  })
  @Column({ type: 'enum', enum: HeyYaStatus, default: HeyYaStatus.PENDING })
  status: HeyYaStatus;

  @ApiProperty({
    description: 'Primary date intent expressed by the sender',
    enum: HeyYaIntent,
    example: HeyYaIntent.COFFEE,
    default: HeyYaIntent.ANY,
  })
  @Column({ type: 'enum', enum: HeyYaIntent, default: HeyYaIntent.ANY })
  intent: HeyYaIntent;

  @ApiProperty({
    description: 'Genie AI compatibility score (0–100)',
    required: false,
  })
  @Column({ type: 'int', nullable: true })
  compatibilityScore: number | null;

  @ApiProperty({
    description: 'Breakdown of compatibility scores per dimension',
    required: false,
    type: 'object',
    example: { interests: 92, vibe: 88, lifestyle: 85, values: 90 },
  })
  @Column({ type: 'jsonb', nullable: true })
  compatibilityBreakdown: {
    interests: number;
    vibe: number;
    lifestyle: number;
    values: number;
  } | null;

  @ApiProperty({
    description: 'When request expires',
    required: false,
  })
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @ApiProperty({
    description: 'When request was responded to',
    required: false,
  })
  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;
}
