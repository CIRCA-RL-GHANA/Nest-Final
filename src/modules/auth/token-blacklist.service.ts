import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class TokenBlacklistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private client: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    const options = redisUrl
      ? { url: redisUrl }
      : {
          socket: {
            host: this.configService.get<string>('redis.host') ?? 'localhost',
            port: this.configService.get<number>('redis.port') ?? 6379,
            tls: this.configService.get<boolean>('redis.tls') ?? false,
          },
          password: this.configService.get<string>('redis.password') || undefined,
          database: this.configService.get<number>('redis.db') ?? 0,
        };

    this.client = createClient(options) as RedisClientType;
    this.client.on('error', (err) =>
      this.logger.error('Token blacklist Redis client error', err),
    );
    await this.client.connect();
    this.logger.log('Token blacklist Redis client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async blacklist(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(`bl:${jti}`, '1', { EX: ttlSeconds });
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const result = await this.client.get(`bl:${jti}`);
    return result !== null;
  }

  async blacklistRefreshToken(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(`rbl:${jti}`, '1', { EX: ttlSeconds });
  }

  async isRefreshTokenBlacklisted(jti: string): Promise<boolean> {
    const result = await this.client.get(`rbl:${jti}`);
    return result !== null;
  }

  async recordLoginFailure(identifier: string): Promise<number> {
    const key = `ll:fail:${identifier}`;
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, 900); // 15-minute sliding window
    }
    return count;
  }

  async isLoginLocked(identifier: string): Promise<boolean> {
    const raw = await this.client.get(`ll:fail:${identifier}`);
    return raw !== null && parseInt(raw, 10) >= 5;
  }

  async clearLoginFailures(identifier: string): Promise<void> {
    await this.client.del(`ll:fail:${identifier}`);
  }

  // ISSUE-23: global QP trading suspension flag — persists across replicas via Redis
  async setTradingSuspended(suspended: boolean): Promise<void> {
    if (suspended) {
      await this.client.set('qp:trading:suspended', '1');
    } else {
      await this.client.del('qp:trading:suspended');
    }
  }

  async getTradingSuspended(): Promise<boolean> {
    const val = await this.client.get('qp:trading:suspended');
    return val !== null;
  }

  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(`lock:${key}`, '1', { NX: true, EX: ttlSeconds });
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(`lock:${key}`);
  }
}
