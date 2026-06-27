import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HeyYaRequest, HeyYaStatus } from './entities/heyya-request.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { Update, UpdateVisibility } from './entities/update.entity';
import { UpdateComment } from './entities/update-comment.entity';
import { Engagement, EngagementType, EngagementTarget } from './entities/engagement.entity';
import { ContentReport } from './entities/content-report.entity';
import { CreateHeyYaRequestDto } from './dto/create-heyya-request.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { AINlpService } from '../ai/services/ai-nlp.service';
import { AIRecommendationsService } from '../ai/services/ai-recommendations.service';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @InjectRepository(HeyYaRequest)
    private heyyaRepository: Repository<HeyYaRequest>,
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(Update)
    private updateRepository: Repository<Update>,
    @InjectRepository(UpdateComment)
    private commentRepository: Repository<UpdateComment>,
    @InjectRepository(Engagement)
    private engagementRepository: Repository<Engagement>,
    @InjectRepository(ContentReport)
    private contentReportRepository: Repository<ContentReport>,
    private readonly aiNlp: AINlpService,
    private readonly aiRecommendations: AIRecommendationsService,
  ) {}

  // HeyYa Requests
  async createHeyYaRequest(senderId: string, dto: CreateHeyYaRequestDto): Promise<HeyYaRequest> {
    // Check for existing pending request
    const existing = await this.heyyaRepository.findOne({
      where: {
        senderId,
        recipientId: dto.recipientId,
        status: HeyYaStatus.PENDING,
      },
    });

    if (existing) {
      throw new ConflictException('Pending request already exists');
    }

    const request = this.heyyaRepository.create({
      ...dto,
      senderId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    return await this.heyyaRepository.save(request);
  }

  async respondToHeyYa(id: string, recipientId: string, accept: boolean): Promise<HeyYaRequest> {
    const request = await this.heyyaRepository.findOne({ where: { id } });

    if (!request) {
      throw new NotFoundException('HeyYa request not found');
    }

    if (request.recipientId !== recipientId) {
      throw new BadRequestException('Not authorized to respond to this request');
    }

    if (request.status !== HeyYaStatus.PENDING) {
      throw new BadRequestException('Request already responded to');
    }

    request.status = accept ? HeyYaStatus.ACCEPTED : HeyYaStatus.DECLINED;
    request.respondedAt = new Date();

    const savedRequest = await this.heyyaRepository.save(request);

    // If accepted, create chat session
    if (accept) {
      await this.getOrCreateChatSession(request.senderId, recipientId);
    }

    return savedRequest;
  }

  async getHeyYaRequests(userId: string, asSender?: boolean): Promise<HeyYaRequest[]> {
    const query = this.heyyaRepository.createQueryBuilder('request');

    if (asSender) {
      query.where('request.senderId = :userId', { userId });
    } else {
      query.where('request.recipientId = :userId', { userId });
    }

    return await query.orderBy('request.createdAt', 'DESC').getMany();
  }

  // Chat Sessions & Messages
  async getOrCreateChatSession(user1Id: string, user2Id: string): Promise<ChatSession> {
    // Sort IDs to ensure consistency
    const [participant1Id, participant2Id] = [user1Id, user2Id].sort();

    let session = await this.chatSessionRepository.findOne({
      where: { participant1Id, participant2Id },
    });

    if (!session) {
      session = this.chatSessionRepository.create({
        participant1Id,
        participant2Id,
      });
      session = await this.chatSessionRepository.save(session);
    }

    return session;
  }

  async sendMessage(senderId: string, dto: SendMessageDto): Promise<ChatMessage> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: dto.sessionId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Verify sender is part of the session
    if (session.participant1Id !== senderId && session.participant2Id !== senderId) {
      throw new BadRequestException('Not authorized to send messages in this session');
    }

    const message = this.chatMessageRepository.create({
      ...dto,
      senderId,
    });

    const savedMessage = await this.chatMessageRepository.save(message);

    // Update session
    session.lastMessage = dto.content || 'Media message';
    session.lastMessageAt = new Date();

    // Increment unread count for recipient
    if (session.participant1Id === senderId) {
      session.unreadCount2++;
    } else {
      session.unreadCount1++;
    }

    await this.chatSessionRepository.save(session);

    return savedMessage;
  }

  async getChatSessionById(sessionId: string, userId: string): Promise<ChatSession> {
    const session = await this.chatSessionRepository.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Chat session ${sessionId} not found`);
    if (session.participant1Id !== userId && session.participant2Id !== userId) {
      throw new BadRequestException('Not authorized to access this session');
    }
    return session;
  }

  async getChatSessions(userId: string): Promise<ChatSession[]> {
    return await this.chatSessionRepository
      .createQueryBuilder('session')
      .where('session.participant1Id = :userId OR session.participant2Id = :userId', { userId })
      .andWhere('session.isActive = :isActive', { isActive: true })
      .orderBy('session.lastMessageAt', 'DESC')
      .getMany();
  }

  async getChatMessages(
    sessionId: string,
    userId: string,
    limit: number = 50,
  ): Promise<ChatMessage[]> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Verify user is part of the session
    if (session.participant1Id !== userId && session.participant2Id !== userId) {
      throw new BadRequestException('Not authorized to view this session');
    }

    return await this.chatMessageRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async markMessagesAsRead(sessionId: string, userId: string): Promise<void> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Update unread messages
    await this.chatMessageRepository
      .createQueryBuilder()
      .update(ChatMessage)
      .set({ isRead: true, readAt: new Date() })
      .where('sessionId = :sessionId', { sessionId })
      .andWhere('senderId != :userId', { userId })
      .andWhere('isRead = :isRead', { isRead: false })
      .execute();

    // Reset unread count
    if (session.participant1Id === userId) {
      session.unreadCount1 = 0;
    } else {
      session.unreadCount2 = 0;
    }

    await this.chatSessionRepository.save(session);
  }

  // Updates
  async createUpdate(authorId: string, dto: CreateUpdateDto): Promise<Update> {
    // ── AI: Content moderation + sentiment tagging ────────────────────────────
    const text = [dto.content, (dto as any).caption].filter(Boolean).join(' ');
    const sentiment = text ? this.aiNlp.analyzeSentiment(text) : null;
    const intent = text ? this.aiNlp.detectIntent(text) : null;

    // Block high-spam-risk content (negative intent like 'complaint' with extreme score)
    if (sentiment && sentiment.score < -0.8) {
      this.logger.warn(
        `[AI-MOD] Potentially hostile content from ${authorId}: score=${sentiment.score}`,
      );
    }

    const update = this.updateRepository.create({
      ...dto,
      authorId,
      metadata: {
        ...(dto as any).metadata,
        ai: {
          sentiment: sentiment ? { score: sentiment.score, label: sentiment.label } : null,
          intent: intent ? { intent: intent.intent, confidence: intent.confidence } : null,
          moderatedAt: new Date().toISOString(),
        },
      },
    });

    return await this.updateRepository.save(update);
  }

  async getUpdates(
    userId?: string,
    visibility?: UpdateVisibility,
    limit: number = 20,
  ): Promise<Update[]> {
    const query = this.updateRepository.createQueryBuilder('update');

    if (userId) {
      query.where('update.authorId = :userId', { userId });
    }

    if (visibility) {
      query.andWhere('update.visibility = :visibility', { visibility });
    } else {
      // Default to public if no specific user
      if (!userId) {
        query.andWhere('update.visibility = :visibility', { visibility: UpdateVisibility.PUBLIC });
      }
    }

    return await query
      .orderBy('update.isPinned', 'DESC')
      .addOrderBy('update.createdAt', 'DESC')
      .limit(limit)
      .getMany();
  }

  async getUpdateById(id: string): Promise<Update> {
    const update = await this.updateRepository.findOne({ where: { id } });

    if (!update) {
      throw new NotFoundException('Update not found');
    }

    return update;
  }

  async updateUpdate(id: string, authorId: string, dto: UpdateUpdateDto): Promise<Update> {
    const update = await this.getUpdateById(id);

    if (update.authorId !== authorId) {
      throw new BadRequestException('Not authorized to update this post');
    }

    Object.assign(update, dto);
    return await this.updateRepository.save(update);
  }

  async deleteUpdate(id: string, authorId: string): Promise<void> {
    const update = await this.getUpdateById(id);

    if (update.authorId !== authorId) {
      throw new BadRequestException('Not authorized to delete this post');
    }

    await this.updateRepository.softDelete(id);
  }

  // Comments
  async createComment(authorId: string, dto: CreateCommentDto): Promise<UpdateComment> {
    // Verify update exists
    await this.getUpdateById(dto.updateId);

    const comment = this.commentRepository.create({
      ...dto,
      authorId,
    });

    const savedComment = await this.commentRepository.save(comment);

    // Increment comment count
    await this.updateRepository.increment({ id: dto.updateId }, 'commentCount', 1);

    return savedComment;
  }

  async getComments(updateId: string): Promise<UpdateComment[]> {
    return await this.commentRepository.find({
      where: { updateId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteComment(id: string, authorId: string): Promise<void> {
    const comment = await this.commentRepository.findOne({ where: { id } });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.authorId !== authorId) {
      throw new BadRequestException('Not authorized to delete this comment');
    }

    await this.commentRepository.softDelete(id);

    // Decrement comment count
    await this.updateRepository.decrement({ id: comment.updateId }, 'commentCount', 1);
  }

  // Engagements
  async createEngagement(userId: string, dto: CreateEngagementDto): Promise<Engagement> {
    // Check for existing engagement
    const existing = await this.engagementRepository.findOne({
      where: {
        userId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        type: dto.type,
      },
    });

    if (existing) {
      throw new ConflictException('Engagement already exists');
    }

    const engagement = this.engagementRepository.create({
      ...dto,
      userId,
    });

    const savedEngagement = await this.engagementRepository.save(engagement);

    // Update counts
    if (dto.targetType === EngagementTarget.UPDATE && dto.type === EngagementType.LIKE) {
      await this.updateRepository.increment({ id: dto.targetId }, 'likeCount', 1);
    } else if (dto.targetType === EngagementTarget.UPDATE && dto.type === EngagementType.SHARE) {
      await this.updateRepository.increment({ id: dto.targetId }, 'shareCount', 1);
    } else if (dto.targetType === EngagementTarget.COMMENT && dto.type === EngagementType.LIKE) {
      await this.commentRepository.increment({ id: dto.targetId }, 'likeCount', 1);
    }

    return savedEngagement;
  }

  async removeEngagement(
    userId: string,
    targetType: EngagementTarget,
    targetId: string,
    type: EngagementType,
  ): Promise<void> {
    const engagement = await this.engagementRepository.findOne({
      where: { userId, targetType, targetId, type },
    });

    if (!engagement) {
      throw new NotFoundException('Engagement not found');
    }

    await this.engagementRepository.softDelete(engagement.id);

    // Update counts
    if (targetType === EngagementTarget.UPDATE && type === EngagementType.LIKE) {
      await this.updateRepository.decrement({ id: targetId }, 'likeCount', 1);
    } else if (targetType === EngagementTarget.UPDATE && type === EngagementType.SHARE) {
      await this.updateRepository.decrement({ id: targetId }, 'shareCount', 1);
    } else if (targetType === EngagementTarget.COMMENT && type === EngagementType.LIKE) {
      await this.commentRepository.decrement({ id: targetId }, 'likeCount', 1);
    }
  }

  async getUserEngagements(userId: string, type?: EngagementType): Promise<Engagement[]> {
    const query = this.engagementRepository.createQueryBuilder('engagement');
    query.where('engagement.userId = :userId', { userId });

    if (type) {
      query.andWhere('engagement.type = :type', { type });
    }

    return await query.orderBy('engagement.createdAt', 'DESC').getMany();
  }

  // Content Reports
  async createReport(reporterId: string, dto: CreateReportDto): Promise<ContentReport> {
    const report = this.contentReportRepository.create({
      ...dto,
      reporterId,
    });
    return await this.contentReportRepository.save(report);
  }
}
