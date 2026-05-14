import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum MemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

export enum MemberStatus {
  ACTIVE = 'active',
  BANNED = 'banned',
  PENDING = 'pending', // For invite-only communities
}

@Entity('community_memberships')
@Index(['communityId', 'userId'], { unique: true })
@Index(['communityId'])
@Index(['userId'])
@Index(['role'])
@Index(['status'])
export class CommunityMembership extends BaseEntity {
  @ApiProperty({ description: 'Community ID' })
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty({ description: 'Member user ID' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ enum: MemberRole })
  @Column({ type: 'enum', enum: MemberRole, default: MemberRole.MEMBER })
  role: MemberRole;

  @ApiProperty({ enum: MemberStatus })
  @Column({ type: 'enum', enum: MemberStatus, default: MemberStatus.ACTIVE })
  status: MemberStatus;

  @ApiProperty({ description: 'Reason for ban (if banned)', required: false })
  @Column({ type: 'text', nullable: true })
  banReason: string | null;

  @ApiProperty({ description: 'Invite token for pending invitations', required: false })
  @Column({ type: 'varchar', length: 100, nullable: true })
  inviteToken: string | null;
}
