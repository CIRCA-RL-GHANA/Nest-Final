import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EventEmitterClass = require('events').EventEmitter;
import { AIEvent, EventType } from '../entities/ai-event.entity';

export type EventHandler = (payload: Record<string, any>) => void | Promise<void>;

export interface EmitOptions {
  /** If true, event is persisted to DB */
  persist?: boolean;
  /** Async: process via Bull queue instead of inline */
  async?: boolean;
  entityType?: string;
  entityId?: string;
  userId?: string;
}

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly emitter: any = new EventEmitterClass();

  constructor(
    @InjectRepository(AIEvent)
    private readonly eventRepo: Repository<AIEvent>,
    @InjectQueue('event-bus')
    private readonly eventQueue: Queue,
  ) {
    // Increase max listeners to avoid Node.js default warning (10)
    this.emitter.setMaxListeners(100);
  }

  onModuleInit(): void {
    this.logger.log('EventBusService initialized');
  }

  onModuleDestroy(): void {
    this.emitter.removeAllListeners();
  }

  // ─────────────────────────────────────────────────────
  // SUBSCRIBE
  // ─────────────────────────────────────────────────────

  on(eventName: string, handler: EventHandler): void {
    this.emitter.on(eventName, handler);
    this.logger.debug(`Subscriber added for event: "${eventName}"`);
  }

  once(eventName: string, handler: EventHandler): void {
    this.emitter.once(eventName, handler);
  }

  off(eventName: string, handler: EventHandler): void {
    this.emitter.off(eventName, handler);
  }

  // ─────────────────────────────────────────────────────
  // EMIT
  // ─────────────────────────────────────────────────────

  async emit(
    eventName: string,
    payload: Record<string, any>,
    options: EmitOptions = {},
  ): Promise<void> {
    const { persist = true, async: isAsync = false, entityType = 'system', entityId, userId } = options;

    this.logger.debug(`Event emitted: "${eventName}"`);

    // Always fire synchronous in-process handlers
    this.emitter.emit(eventName, payload);
    // Also fire wildcard handlers
    this.emitter.emit('*', { eventName, payload });

    if (persist) {
      if (isAsync) {
        await this.eventQueue.add(
          'persist-event',
          { eventName, payload, entityType, entityId, userId },
          { removeOnComplete: 100, removeOnFail: 50 },
        );
      } else {
        await this.persistEvent(eventName, payload, entityType, entityId ?? null, userId ?? null);
      }
    }
  }

  /** Batch emit — fires multiple events, useful for bulk operations */
  async emitBatch(
    events: Array<{ eventName: string; payload: Record<string, any>; options?: EmitOptions }>,
  ): Promise<void> {
    for (const { eventName, payload, options } of events) {
      await this.emit(eventName, payload, options);
    }
  }

  // ─────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────

  async persistEvent(
    eventName: string,
    payload: Record<string, any>,
    entityType: string,
    entityId: string | null,
    userId: string | null,
  ): Promise<AIEvent> {
    try {
      const dbEvent = this.eventRepo.create({
        eventType: this.resolveEventType(eventName),
        eventName,
        entityType,
        entityId: entityId ?? '00000000-0000-0000-0000-000000000000',
        userId,
        payload,
        metadata: null,
        processed: false,
        processedAt: null,
      });
      return await this.eventRepo.save(dbEvent);
    } catch (err) {
      this.logger.error(`Failed to persist event "${eventName}": ${err}`);
      throw err;
    }
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.eventRepo.update(eventId, { processed: true, processedAt: new Date() });
  }

  async getUnprocessedEvents(limit = 100): Promise<AIEvent[]> {
    return this.eventRepo.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async getEventsByName(eventName: string, limit = 50): Promise<AIEvent[]> {
    return this.eventRepo.find({
      where: { eventName },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ─────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────

  private resolveEventType(eventName: string): EventType {
    if (eventName.startsWith('workflow.')) return EventType.WORKFLOW_EVENT;
    if (eventName.startsWith('model.') || eventName.startsWith('prediction.')) return EventType.MODEL_PREDICTION;
    if (eventName.startsWith('user.') || eventName.startsWith('auth.')) return EventType.USER_ACTION;
    return EventType.SYSTEM_EVENT;
  }

  listEvents(): string[] {
    return this.emitter.eventNames() as string[];
  }
}
