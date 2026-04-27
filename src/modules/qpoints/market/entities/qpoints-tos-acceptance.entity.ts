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

/**
 * Immutable audit record of a user accepting a specific version of the
 * Q Points Terms of Service.  Records IP address, user-agent, and the
 * full canonical ToS version string for legal evidentiary purposes under
 * Ghana law and any other applicable jurisdiction.
 *
 * NEVER update or delete rows from this table — append-only.
 */
@Entity('qpoints_tos_acceptances')
@Index('idx_qpts_tos_user_version', ['userId', 'tosVersion'], { unique: true })
export class QPointsTosAcceptance {
  @ApiProperty({ example: 'f1a2b3c4-0000-0000-0000-000000000000' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'User who accepted the Terms of Service' })
  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Semantic version of the Terms of Service that was accepted.
   * Current version: "1.0.0" (Effective April 27, 2026).
   * Increment MINOR for non-material changes, MAJOR for material changes
   * requiring re-acceptance.
   */
  @ApiProperty({ description: 'ToS version string, e.g. "1.0.0"', example: '1.0.0' })
  @Column({ name: 'tos_version', type: 'varchar', length: 20 })
  tosVersion: string;

  /**
   * IPv4 or IPv6 address of the client at time of acceptance.
   * Stored for legal evidentiary purposes.
   */
  @ApiProperty({ description: 'Client IP at time of acceptance', example: '41.75.80.1' })
  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress: string;

  /**
   * HTTP User-Agent of the client at time of acceptance.
   */
  @ApiProperty({ description: 'HTTP User-Agent string', example: 'Mozilla/5.0 (iPhone; ...)' })
  @Column({ name: 'user_agent', type: 'text' })
  userAgent: string;

  /**
   * Platform/channel via which acceptance occurred.
   * One of: 'web', 'ios', 'android'
   */
  @ApiProperty({ description: 'Acceptance platform', example: 'ios' })
  @Column({ name: 'platform', type: 'varchar', length: 20, default: 'web' })
  platform: string;

  /**
   * Whether the user explicitly checked the "I have read the full Terms"
   * checkbox (required for valid acceptance).
   */
  @ApiProperty({ description: 'User confirmed they read the full ToS', example: true })
  @Column({ name: 'read_confirmed', type: 'boolean', default: false })
  readConfirmed: boolean;

  /**
   * Whether the user explicitly checked the "I acknowledge the Risk Disclosures"
   * checkbox (Section 9 — required).
   */
  @ApiProperty({ description: 'User confirmed risk disclosure acknowledgement', example: true })
  @Column({ name: 'risk_confirmed', type: 'boolean', default: false })
  riskConfirmed: boolean;

  /**
   * Whether the user confirmed they are 18+ years of age (Section 3.1).
   */
  @ApiProperty({ description: 'User confirmed they are 18+ years of age', example: true })
  @Column({ name: 'age_confirmed', type: 'boolean', default: false })
  ageConfirmed: boolean;

  /**
   * The exact hash (SHA-256 hex) of the ToS text that was displayed to and
   * accepted by the user.  Provides tamper-evident proof of the content
   * the user saw at the time of acceptance.
   */
  @ApiProperty({ description: 'SHA-256 hash of ToS content shown to user' })
  @Column({ name: 'tos_content_hash', type: 'varchar', length: 64 })
  tosContentHash: string;

  /** UTC timestamp of acceptance (immutable). */
  @ApiProperty({ description: 'UTC timestamp when user accepted' })
  @CreateDateColumn({ name: 'accepted_at', type: 'timestamp with time zone' })
  acceptedAt: Date;
}
