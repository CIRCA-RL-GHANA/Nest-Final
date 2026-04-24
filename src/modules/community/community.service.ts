import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Community, CommunityStatus, CommunityType, CommunityVisibility } from './entities/community.entity';
import { CommunityMembership, MemberRole, MemberStatus } from './entities/community-membership.entity';
import { CommunityPost, PostType } from './entities/community-post.entity';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityMembership)
    private readonly membershipRepo: Repository<CommunityMembership>,
    @InjectRepository(CommunityPost)
    private readonly postRepo: Repository<CommunityPost>,
  ) {}

  // ── Community CRUD ───────────────────────────────────────────────────────

  async createCommunity(userId: string, dto: CreateCommunityDto): Promise<Community> {
    const community = this.communityRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type,
      visibility: dto.visibility ?? CommunityVisibility.PUBLIC,
      ownerId: userId,
      coverUrl: dto.coverUrl ?? null,
      tags: dto.tags ?? null,
      metadata: dto.metadata ?? null,
      memberCount: 1,
    });
    const saved = await this.communityRepo.save(community);

    // Auto-enroll the creator as OWNER
    const ownerMembership = this.membershipRepo.create({
      communityId: saved.id,
      userId,
      role: MemberRole.OWNER,
      status: MemberStatus.ACTIVE,
    });
    await this.membershipRepo.save(ownerMembership);

    this.logger.log(`Community ${saved.id} (${dto.type}) created by user ${userId}`);
    return saved;
  }

  async getCommunityById(communityId: string, requesterId?: string): Promise<Community> {
    const community = await this.communityRepo.findOne({ where: { id: communityId, status: CommunityStatus.ACTIVE } });
    if (!community) throw new NotFoundException('Community not found.');

    if (community.visibility === CommunityVisibility.PRIVATE && requesterId) {
      const membership = await this.membershipRepo.findOne({
        where: { communityId, userId: requesterId, status: MemberStatus.ACTIVE },
      });
      if (!membership) throw new ForbiddenException('This community is private.');
    }
    return community;
  }

  async discoverCommunities(type?: CommunityType, page = 1, limit = 20): Promise<{ items: Community[]; total: number }> {
    const query = this.communityRepo.createQueryBuilder('c')
      .where('c.status = :status', { status: CommunityStatus.ACTIVE })
      .andWhere('c.visibility != :priv', { priv: CommunityVisibility.PRIVATE })
      .orderBy('c.member_count', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (type) query.andWhere('c.type = :type', { type });
    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async getMyMemberships(userId: string): Promise<Community[]> {
    const memberships = await this.membershipRepo.find({
      where: { userId, status: MemberStatus.ACTIVE },
    });
    if (!memberships.length) return [];
    const communityIds = memberships.map(m => m.communityId);
    return this.communityRepo.findByIds(communityIds);
  }

  // ── Membership ───────────────────────────────────────────────────────────

  async join(userId: string, communityId: string): Promise<CommunityMembership> {
    const community = await this.getCommunityById(communityId, userId);
    if (community.visibility === CommunityVisibility.INVITE_ONLY) {
      throw new ForbiddenException('This community requires an invitation.');
    }

    const existing = await this.membershipRepo.findOne({ where: { communityId, userId } });
    if (existing) {
      if (existing.status === MemberStatus.BANNED) {
        throw new ForbiddenException('You are banned from this community.');
      }
      if (existing.status === MemberStatus.ACTIVE) {
        throw new ConflictException('You are already a member.');
      }
    }

    const membership = this.membershipRepo.create({
      communityId,
      userId,
      role: MemberRole.MEMBER,
      status: MemberStatus.ACTIVE,
    });
    const saved = await this.membershipRepo.save(membership);
    await this.communityRepo.increment({ id: communityId }, 'memberCount', 1);
    return saved;
  }

  async leave(userId: string, communityId: string): Promise<void> {
    const membership = await this.membershipRepo.findOne({ where: { communityId, userId } });
    if (!membership) throw new NotFoundException('Membership not found.');
    if (membership.role === MemberRole.OWNER) {
      throw new BadRequestException('Owner cannot leave. Transfer ownership or archive the community first.');
    }
    await this.membershipRepo.softDelete(membership.id);
    await this.communityRepo.decrement({ id: communityId }, 'memberCount', 1);
  }

  async banMember(adminId: string, communityId: string, targetUserId: string, reason: string): Promise<CommunityMembership> {
    await this.requireRole(adminId, communityId, [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MODERATOR]);
    const membership = await this.membershipRepo.findOne({ where: { communityId, userId: targetUserId } });
    if (!membership) throw new NotFoundException('Member not found.');
    if (membership.role === MemberRole.OWNER) throw new ForbiddenException('Cannot ban the community owner.');
    await this.membershipRepo.update(membership.id, { status: MemberStatus.BANNED, banReason: reason });
    await this.communityRepo.decrement({ id: communityId }, 'memberCount', 1);
    return { ...membership, status: MemberStatus.BANNED, banReason: reason };
  }

  async getMembers(communityId: string, page = 1, limit = 50): Promise<{ items: CommunityMembership[]; total: number }> {
    return this.membershipRepo.findAndCount({
      where: { communityId, status: MemberStatus.ACTIVE },
      order: { role: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    }).then(([items, total]) => ({ items, total }));
  }

  // ── Posts / Feed ─────────────────────────────────────────────────────────

  async createPost(userId: string, communityId: string, dto: CreatePostDto): Promise<CommunityPost> {
    await this.requireRole(userId, communityId, [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MODERATOR, MemberRole.MEMBER]);
    const post = this.postRepo.create({
      communityId,
      authorId: userId,
      type: dto.type ?? PostType.TEXT,
      title: dto.title ?? null,
      body: dto.body ?? null,
      linkedContentId: dto.linkedContentId ?? null,
      metadata: dto.metadata ?? null,
    });
    const saved = await this.postRepo.save(post);
    await this.communityRepo.increment({ id: communityId }, 'postCount', 1);
    return saved;
  }

  async getFeed(communityId: string, page = 1, limit = 30): Promise<{ items: CommunityPost[]; total: number }> {
    const [items, total] = await this.postRepo.findAndCount({
      where: { communityId, isRemoved: false },
      order: { isPinned: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async removePost(moderatorId: string, communityId: string, postId: string): Promise<void> {
    await this.requireRole(moderatorId, communityId, [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MODERATOR]);
    const post = await this.postRepo.findOne({ where: { id: postId, communityId } });
    if (!post) throw new NotFoundException('Post not found.');
    await this.postRepo.update(postId, { isRemoved: true });
    await this.communityRepo.decrement({ id: communityId }, 'postCount', 1);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async requireRole(userId: string, communityId: string, allowedRoles: MemberRole[]): Promise<void> {
    const membership = await this.membershipRepo.findOne({
      where: { communityId, userId, status: MemberStatus.ACTIVE },
    });
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions in this community.');
    }
  }
}
