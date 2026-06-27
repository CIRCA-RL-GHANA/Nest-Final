import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { CreateWebhookSubscriptionDto, SUPPORTED_EVENTS } from './dto/webhook.dto';

const RETRY_DELAYS_MS = [5_000, 30_000, 300_000]; // 5 s, 30 s, 5 min

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly encKey: Buffer;

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subRepo: Repository<WebhookSubscription>,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('PIN_ENCRYPTION_KEY') ?? '';
    // Derive a 32-byte AES key from whatever is configured
    this.encKey = crypto.createHash('sha256').update(raw).digest();
  }

  // ─── AES-256-GCM helpers ─────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException('Malformed encrypted secret — expected iv:tag:enc');
    }
    const [ivHex, tagHex, encHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

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

    // Generate a signing secret — returned once; stored encrypted + hashed
    const rawSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
    const secretEncrypted = this.encrypt(rawSecret);
    const secretPrefix = rawSecret.slice(0, 8);

    const sub = this.subRepo.create({
      entityId: dto.entityId,
      url: dto.url,
      secretHash,
      secretEncrypted,
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

    await Promise.allSettled(
      matchingSubs.map((sub) => this.deliverToSubscription(sub, payloadStr)),
    );
  }

  // ─── Private: single delivery with HMAC-SHA256 signature + retry ─────────

  private async deliverToSubscription(
    sub: WebhookSubscription,
    payloadStr: string,
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payloadStr}`;

    // Use the decrypted raw secret for standard HMAC-SHA256 (Stripe-style).
    // Fall back to secretHash for legacy subscriptions created before encryption was added.
    let signingKey: string;
    if (sub.secretEncrypted) {
      try {
        signingKey = this.decrypt(sub.secretEncrypted);
      } catch {
        this.logger.warn(`Could not decrypt secret for subscription ${sub.id}, using hash fallback`);
        signingKey = sub.secretHash;
      }
    } else {
      signingKey = sub.secretHash;
    }

    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(signedPayload)
      .digest('hex');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Genie-Signature': `t=${timestamp},v1=${signature}`,
      'X-Genie-Event': (JSON.parse(payloadStr) as any).type,
    };

    // Retry up to RETRY_DELAYS_MS.length times on transient failure
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
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
          return;
        }

        this.logger.warn(
          `Webhook ${sub.id} returned HTTP ${res.status} (attempt ${attempt + 1})`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook ${sub.id} network error (attempt ${attempt + 1}): ${err.message}`,
        );
      }

      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }

    // All attempts exhausted
    await this.subRepo.update(sub.id, { failureCount: sub.failureCount + 1 });
    this.logger.error(
      `Webhook ${sub.id} failed all ${RETRY_DELAYS_MS.length + 1} delivery attempts for ${sub.url}`,
    );
  }
}
