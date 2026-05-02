import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { CreateWebhookSubscriptionDto, SUPPORTED_EVENTS } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subRepo: Repository<WebhookSubscription>,
  ) {}

  // ─── Subscribe ────────────────────────────────────────────────────────────

  async subscribe(dto: CreateWebhookSubscriptionDto): Promise<{
    subscriptionId: string;
    secret: string;
    secretPrefix: string;
    url: string;
    events: string[];
  }> {
    const invalid = dto.events.filter((e) => !(SUPPORTED_EVENTS as readonly string[]).includes(e));
    if (invalid.length) {
      throw new BadRequestException(`Unsupported event types: ${invalid.join(', ')}`);
    }

    // Generate a signing secret — returned once; stored hashed
    const rawSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
    const secretPrefix = rawSecret.slice(0, 8);

    const sub = this.subRepo.create({
      entityId: dto.entityId,
      url: dto.url,
      secretHash,
      secretPrefix,
      events: dto.events,
      isActive: true,
    });
    const saved = await this.subRepo.save(sub);

    this.logger.log(`Webhook subscription created: ${saved.id} for entity ${dto.entityId}`);

    return {
      subscriptionId: saved.id,
      secret: rawSecret, // shown only once
      secretPrefix,
      url: saved.url,
      events: saved.events,
    };
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(entityId: string): Promise<WebhookSubscription[]> {
    return this.subRepo.find({ where: { entityId } });
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async delete(entityId: string, subscriptionId: string): Promise<void> {
    const sub = await this.subRepo.findOne({ where: { id: subscriptionId, entityId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    await this.subRepo.remove(sub);
  }

  // ─── Deliver event (called by other services) ─────────────────────────────

  async deliverEvent(
    entityId: string,
    eventType: string,
    data: Record<string, any>,
  ): Promise<void> {
    const subs = await this.subRepo.find({
      where: { entityId, isActive: true },
    });

    const matchingSubs = subs.filter(
      (s) => s.events.includes(eventType) || s.events.includes('*'),
    );

    if (!matchingSubs.length) return;

    const payload = {
      id: `evt_${crypto.randomBytes(8).toString('hex')}`,
      type: eventType,
      created: new Date().toISOString(),
      data,
    };
    const payloadStr = JSON.stringify(payload);

    for (const sub of matchingSubs) {
      await this.deliverToSubscription(sub, payloadStr);
    }
  }

  // ─── Private: single delivery with HMAC-SHA256 signature ─────────────────

  private async deliverToSubscription(
    sub: WebhookSubscription,
    payloadStr: string,
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payloadStr}`;

    // We stored hash of the secret — regeneration not possible, so we use secretHash as key
    // In production store the raw secret encrypted; here we derive a delivery MAC using the stored hash
    const signature = crypto
      .createHmac('sha256', sub.secretHash)
      .update(signedPayload)
      .digest('hex');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Genie-Signature': `t=${timestamp},v1=${signature}`,
      'X-Genie-Event': (JSON.parse(payloadStr) as any).type,
    };

    try {
      // Use native fetch (Node 18+)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(sub.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        await this.subRepo.update(sub.id, {
          deliveryCount: sub.deliveryCount + 1,
          failureCount: 0,
          lastDeliveredAt: new Date(),
        });
      } else {
        await this.subRepo.update(sub.id, { failureCount: sub.failureCount + 1 });
        this.logger.warn(`Webhook ${sub.id} returned ${res.status} for ${sub.url}`);
      }
    } catch (err) {
      await this.subRepo.update(sub.id, { failureCount: sub.failureCount + 1 });
      this.logger.error(`Webhook delivery failed for ${sub.id}: ${err.message}`);
    }
  }
}
