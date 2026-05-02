import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ConciergeSessionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  HANDOFF = 'handoff',
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

/**
 * A concierge session represents a named conversation thread opened by an
 * enterprise (via API key) on behalf of one of its end-users.
 */
@Entity('agentic_concierge_sessions')
export class ConciergeSession extends BaseEntity {
  @ApiProperty({ description: 'Enterprise entity ID that owns the session' })
  @Column({ type: 'uuid' })
  @Index()
  entityId: string;

  @ApiProperty({ description: 'End-user identifier supplied by the enterprise' })
  @Column({ type: 'varchar', length: 500 })
  @Index()
  endUserId: string;

  @ApiProperty({ enum: ConciergeSessionStatus })
  @Column({ type: 'enum', enum: ConciergeSessionStatus, default: ConciergeSessionStatus.ACTIVE })
  status: ConciergeSessionStatus;

  @ApiProperty({ required: false, description: 'Optional session topic / product context' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  topic: string | null;

  @ApiProperty({ required: false, description: 'Shared context payload injected into every turn' })
  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, any> | null;
}

/**
 * Individual message within a concierge session.
 */
@Entity('agentic_concierge_messages')
export class ConciergeMessage extends BaseEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  @Index()
  sessionId: string;

  @ApiProperty({ enum: MessageRole })
  @Column({ type: 'enum', enum: MessageRole })
  role: MessageRole;

  @ApiProperty()
  @Column({ type: 'text' })
  content: string;

  @ApiProperty({ required: false, description: 'Intent resolved by NLP service' })
  @Column({ type: 'varchar', length: 100, nullable: true })
  detectedIntent: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'float', nullable: true })
  intentConfidence: number | null;

  @ApiProperty({ required: false, description: 'Additional metadata (tool calls, context refs)' })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
