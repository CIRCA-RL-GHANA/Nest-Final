import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EventBusService } from '../services/event-bus.service';

@Processor('event-bus')
export class EventBusProcessor {
  private readonly logger = new Logger(EventBusProcessor.name);

  constructor(private readonly eventBus: EventBusService) {}

  @Process('persist-event')
  async handlePersistEvent(
    job: Job<{
      eventName: string;
      payload: Record<string, any>;
      entityType: string;
      entityId?: string;
      userId?: string;
    }>,
  ): Promise<void> {
    const { eventName, payload, entityType, entityId, userId } = job.data;
    this.logger.debug(`Persisting async event: "${eventName}" (jobId=${job.id})`);
    await this.eventBus.persistEvent(eventName, payload, entityType, entityId ?? null, userId ?? null);
  }
}
