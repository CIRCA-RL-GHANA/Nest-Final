import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MultiChannelConfig,
  ChannelSyncStatus,
} from './entities/multi-channel-config.entity';
import { RegisterChannelDto, SyncChannelDto } from './dto/multi-channel.dto';

@Injectable()
export class MultiChannelService {
  private readonly logger = new Logger(MultiChannelService.name);

  constructor(
    @InjectRepository(MultiChannelConfig)
    private readonly channelRepo: Repository<MultiChannelConfig>,
  ) {}

  async registerChannel(dto: RegisterChannelDto): Promise<MultiChannelConfig> {
    const channel = await this.channelRepo.save(
      this.channelRepo.create({
        entityId: dto.entityId,
        channelType: dto.channelType,
        channelName: dto.channelName,
        credentials: dto.credentials ?? null,
        webhookUrl: dto.webhookUrl ?? null,
        syncStatus: ChannelSyncStatus.IDLE,
        isActive: true,
      }),
    );
    this.logger.log(`Channel registered: ${channel.id} (${dto.channelType}) for entity ${dto.entityId}`);
    return channel;
  }

  async listChannels(entityId: string): Promise<MultiChannelConfig[]> {
    return this.channelRepo.find({ where: { entityId, isActive: true }, order: { createdAt: 'DESC' } });
  }

  async getChannel(channelId: string): Promise<MultiChannelConfig> {
    const c = await this.channelRepo.findOne({ where: { id: channelId } });
    if (!c) throw new NotFoundException(`Channel ${channelId} not found`);
    return c;
  }

  /**
   * Trigger a sync for a channel. In production this would call the channel's
   * external API (Shopify, Walmart, etc.) via their respective adapters.
   * Here we model the sync lifecycle and record state.
   */
  async syncChannel(channelId: string, dto: SyncChannelDto): Promise<MultiChannelConfig> {
    const channel = await this.getChannel(channelId);
    if (channel.syncStatus === ChannelSyncStatus.SYNCING) {
      throw new BadRequestException(`Channel ${channelId} is already syncing`);
    }

    // Mark as syncing
    channel.syncStatus = ChannelSyncStatus.SYNCING;
    await this.channelRepo.save(channel);

    this.logger.log(`Starting ${dto.fullResync ? 'full' : 'incremental'} sync for channel ${channelId}`);

    try {
      // ── External adapter call would go here ──────────────────────────────
      // e.g.: await this.shopifyAdapter.sync(channel.credentials, dto.fullResync)
      // For now, we simulate success by recording the timestamp.
      // ─────────────────────────────────────────────────────────────────────

      channel.syncStatus = ChannelSyncStatus.IDLE;
      channel.lastSyncedAt = new Date();
      channel.lastSyncError = null;
    } catch (err) {
      channel.syncStatus = ChannelSyncStatus.ERROR;
      channel.lastSyncError = (err as Error).message;
      this.logger.error(`Sync failed for channel ${channelId}: ${channel.lastSyncError}`);
    }

    return this.channelRepo.save(channel);
  }

  async deactivateChannel(channelId: string): Promise<void> {
    const channel = await this.getChannel(channelId);
    await this.channelRepo.update(channel.id, { isActive: false });
    this.logger.log(`Channel ${channelId} deactivated`);
  }

  /**
   * Receive an inbound event (order.created, inventory.updated) from an
   * external channel. Records the event and returns an acknowledgment.
   */
  async receiveWebhookEvent(
    channelId: string,
    eventType: string,
    _payload: Record<string, any>,
  ): Promise<{ received: true; channelId: string; eventType: string }> {
    const channel = await this.getChannel(channelId);
    this.logger.log(`Webhook [${eventType}] received from channel ${channelId} (${channel.channelType})`);
    // In production: enqueue for processing (BullMQ job per event type)
    return { received: true, channelId, eventType };
  }
}
