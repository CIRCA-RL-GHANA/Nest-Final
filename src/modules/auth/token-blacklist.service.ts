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
}
