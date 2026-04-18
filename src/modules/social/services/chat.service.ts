import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage as ChatMessageEntity, MessageType } from '../entities/chat-message.entity';
import { ChatSession } from '../entities/chat-session.entity';
import { HeyYaRequest, HeyYaStatus } from '../entities/heyya-request.entity';
import { AINlpService } from '../../ai/services/ai-nlp.service';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  attachmentUrls?: string[];
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  name?: string;
  type: 'direct' | 'group';
  participants: Array<{ id: string; name: string }>;
  lastMessage?: ChatMessage;
  isArchived: boolean;
  isMuted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly chatMessageRepository: Repository<ChatMessageEntity>,
    @InjectRepository(ChatSession)
    private readonly chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(HeyYaRequest)
    private readonly heyYaRequestRepository: Repository<HeyYaRequest>,
    private readonly aiNlp: AINlpService,
  ) {}

  private mapEntityToMessage(entity: ChatMessageEntity): ChatMessage {
    return {
      id: entity.id,
      conversationId: entity.sessionId,
      senderId: entity.senderId,
      content: entity.content ?? '',
      type: entity.type,
      attachmentUrls: (entity.metadata?.attachmentUrls as string[]) ?? [],
      isRead: entity.isRead,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private mapSessionToConversation(session: ChatSession): Conversation {
    return {
      id: session.id,
      type: 'direct',
      participants: [
        { id: session.participant1Id, name: '' },
        { id: session.participant2Id, name: '' },
      ],
      isArchived: !session.isActive,
      isMuted: false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async createMessage(payload: {
    senderId: string;
    conversationId: string;
    content: string;
    type: string;
    attachmentUrls?: string[];
  }): Promise<ChatMessage> {
    if (!payload.content?.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const trimmedContent = payload.content.trim();

    // AI enrichment: sentiment + intent stored as metadata
    const sentiment = this.aiNlp.analyzeSentiment(trimmedContent);
    const intent = this.aiNlp.detectIntent(trimmedContent);

    const entity = this.chatMessageRepository.create({
      sessionId: payload.conversationId,
      senderId: payload.senderId,
      content: trimmedContent,
      type: (payload.type as MessageType) || MessageType.TEXT,
      isRead: false,
      metadata: {
        ...(payload.attachmentUrls?.length ? { attachmentUrls: payload.attachmentUrls } : {}),
        ai: {
          sentiment: { score: sentiment.score, label: sentiment.label },
          intent: { intent: intent.intent, confidence: intent.confidence },
        },
      },
    });

    const saved = await this.chatMessageRepository.save(entity);

    await this.chatSessionRepository.update(payload.conversationId, {
      lastMessage: trimmedContent.substring(0, 255),
      lastMessageAt: saved.createdAt,
    });

    this.logger.debug(`Message created: ${saved.id}`);
    return this.mapEntityToMessage(saved);
  }

  async getMessage(messageId: string): Promise<ChatMessage> {
    const message = await this.chatMessageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    return this.mapEntityToMessage(message);
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ChatMessage[]> {
    const messages = await this.chatMessageRepository.find({
      where: { sessionId: conversationId },
      order: { createdAt: 'ASC' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return messages.map((m: ChatMessageEntity) => this.mapEntityToMessage(m));
  }

  async deleteMessage(messageId: string, userId: string): Promise<ChatMessage> {
    const message = await this.chatMessageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    if (message.senderId !== userId) {
      throw new BadRequestException('Cannot delete message from another user');
    }

    const mapped = this.mapEntityToMessage(message);
    await this.chatMessageRepository.softDelete(messageId);

    return mapped;
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    const exists = await this.chatMessageRepository.findOne({
      where: { id: messageId },
    });

    if (!exists) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    await this.chatMessageRepository.update(messageId, {
      isRead: true,
      readAt: new Date(),
    });

    this.logger.debug(`Message ${messageId} marked as read by ${userId}`);
  }

  async getOrCreateChatSession(user1Id: string, user2Id: string): Promise<Conversation> {
    const [p1, p2] = [user1Id, user2Id].sort();

    let session = await this.chatSessionRepository.findOne({
      where: [
        { participant1Id: p1, participant2Id: p2 },
        { participant1Id: p2, participant2Id: p1 },
      ],
    });

    if (!session) {
      session = this.chatSessionRepository.create({
        participant1Id: p1,
        participant2Id: p2,
        isActive: true,
      });
      session = await this.chatSessionRepository.save(session);
      this.logger.debug(`Chat session created between ${user1Id} and ${user2Id}`);
    }

    return this.mapSessionToConversation(session);
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const session = await this.chatSessionRepository.findOne({
      where: { id: conversationId },
    });

    if (!session) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    return this.mapSessionToConversation(session);
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    const sessions = await this.chatSessionRepository.find({
      where: [{ participant1Id: userId }, { participant2Id: userId }],
      order: { lastMessageAt: 'DESC' },
    });

    return sessions.map((s: ChatSession) => this.mapSessionToConversation(s));
  }

  async getChatSessions(userId: string): Promise<Conversation[]> {
    return this.getUserConversations(userId);
  }

  async getHeyYaRequests(userId: string, asSender?: boolean): Promise<HeyYaRequest[]> {
    try {
      const where = asSender
        ? { senderId: userId, status: HeyYaStatus.PENDING }
        : { recipientId: userId, status: HeyYaStatus.PENDING };

      const requests = await this.heyYaRequestRepository.find({
        where,
        order: { createdAt: 'DESC' },
      });

      this.logger.log(`Retrieved ${requests.length} HeyYa requests for user ${userId}`);
      return requests;
    } catch (error) {
      this.logger.error(`Failed to get HeyYa requests: ${(error as Error).message}`);
      throw error;
    }
  }

  async getUserContacts(userId: string): Promise<any[]> {
    try {
      const sessions = await this.chatSessionRepository.find({
        where: [{ participant1Id: userId }, { participant2Id: userId }],
        order: { lastMessageAt: 'DESC' },
      });

      return sessions.map((s: ChatSession) => {
        const contactId = s.participant1Id === userId ? s.participant2Id : s.participant1Id;
        return {
          userId: contactId,
          lastMessageAt: s.lastMessageAt,
          sessionId: s.id,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to get user contacts: ${(error as Error).message}`);
      throw error;
    }
  }

  async sendMessage(payload: any): Promise<ChatMessage> {
    return this.createMessage(payload);
  }
}
