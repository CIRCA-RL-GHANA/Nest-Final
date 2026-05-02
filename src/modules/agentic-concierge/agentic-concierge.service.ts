import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConciergeSession,
  ConciergeMessage,
  ConciergeSessionStatus,
  MessageRole,
} from './entities/concierge.entity';
import { CreateSessionDto, SendMessageDto, UpdateSessionContextDto } from './dto/concierge.dto';
import { AINlpService } from '../ai/services/ai-nlp.service';

export interface ConciergeReply {
  sessionId: string;
  messageId: string;
  reply: string;
  detectedIntent: string | null;
  intentConfidence: number | null;
}

@Injectable()
export class AgenticConciergeService {
  private readonly logger = new Logger(AgenticConciergeService.name);

  constructor(
    @InjectRepository(ConciergeSession)
    private readonly sessionRepo: Repository<ConciergeSession>,
    @InjectRepository(ConciergeMessage)
    private readonly messageRepo: Repository<ConciergeMessage>,
    private readonly nlpService: AINlpService,
  ) {}

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(dto: CreateSessionDto): Promise<ConciergeSession> {
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        entityId: dto.entityId,
        endUserId: dto.endUserId,
        topic: dto.topic ?? null,
        context: dto.context ?? null,
        status: ConciergeSessionStatus.ACTIVE,
      }),
    );
    this.logger.log(`Concierge session ${session.id} created for entity ${dto.entityId}`);
    return session;
  }

  async getSession(sessionId: string): Promise<ConciergeSession> {
    const s = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!s) throw new NotFoundException(`Concierge session ${sessionId} not found`);
    return s;
  }

  async listSessions(entityId: string): Promise<ConciergeSession[]> {
    return this.sessionRepo.find({
      where: { entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async closeSession(sessionId: string): Promise<ConciergeSession> {
    const session = await this.getSession(sessionId);
    session.status = ConciergeSessionStatus.CLOSED;
    return this.sessionRepo.save(session);
  }

  async updateContext(sessionId: string, dto: UpdateSessionContextDto): Promise<ConciergeSession> {
    const session = await this.getSession(sessionId);
    session.context = { ...(session.context ?? {}), ...dto.context };
    return this.sessionRepo.save(session);
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  async sendMessage(sessionId: string, dto: SendMessageDto): Promise<ConciergeReply> {
    const session = await this.getSession(sessionId);
    if (session.status !== ConciergeSessionStatus.ACTIVE) {
      throw new BadRequestException(`Session ${sessionId} is not active`);
    }

    // Persist the user message
    await this.messageRepo.save(
      this.messageRepo.create({
        sessionId,
        role: MessageRole.USER,
        content: dto.message,
        detectedIntent: null,
        intentConfidence: null,
        metadata: dto.context ?? null,
      }),
    );

    // ── Intent detection ─────────────────────────────────────────────────────
    let detectedIntent: string | null = null;
    let intentConfidence: number | null = null;
    try {
      const intentResult = await this.nlpService.detectIntent(dto.message);
      detectedIntent = intentResult.intent;
      intentConfidence = intentResult.confidence;
    } catch (err) {
      this.logger.warn(`Intent detection failed for session ${sessionId}: ${(err as Error).message}`);
    }

    // ── Build merged context for this turn ───────────────────────────────────
    const turnContext = {
      ...(session.context ?? {}),
      ...(dto.context ?? {}),
      sessionId,
      endUserId: session.endUserId,
      topic: session.topic,
      detectedIntent,
    };

    // ── Generate reply ────────────────────────────────────────────────────────
    // In production this calls the configured LLM (OpenAI / local model) with
    // the full conversation history + turnContext as system context.
    // Here we produce a structured placeholder that reflects intent resolution.
    const reply = this.buildReply(dto.message, detectedIntent, turnContext);

    // Persist assistant message
    const assistantMsg = await this.messageRepo.save(
      this.messageRepo.create({
        sessionId,
        role: MessageRole.ASSISTANT,
        content: reply,
        detectedIntent,
        intentConfidence,
        metadata: { context: turnContext },
      }),
    );

    return {
      sessionId,
      messageId: assistantMsg.id,
      reply,
      detectedIntent,
      intentConfidence,
    };
  }

  async getHistory(sessionId: string): Promise<ConciergeMessage[]> {
    await this.getSession(sessionId); // ensure it exists
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildReply(
    userMessage: string,
    intent: string | null,
    context: Record<string, any>,
  ): string {
    // Placeholder response strategy — replace with LLM call in production.
    if (!intent || intent === 'unknown') {
      return `I'm your Genie concierge. I received your message and will assist you shortly. Context ID: ${context.sessionId}`;
    }
    return `Understood — I detected your intent as "${intent}". I'm processing your request: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '…' : ''}". How can I assist you further?`;
  }
}
