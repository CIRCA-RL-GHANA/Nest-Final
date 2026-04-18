import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AIFeature, FeatureType } from '../entities/ai-feature.entity';

export interface FeatureRecord {
  entityType: string;
  entityId: string;
  featureName: string;
  featureType: FeatureType;
  featureValue: any;
  version?: string;
  metadata?: Record<string, any> | null;
}

@Injectable()
export class FeatureStoreService {
  private readonly logger = new Logger(FeatureStoreService.name);

  // In-memory cache: key = `entityType:entityId:featureName`
  private readonly cache = new Map<string, { value: any; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(AIFeature)
    private readonly featureRepo: Repository<AIFeature>,
  ) {}

  // ─────────────────────────────────────────────────────
  // GET
  // ─────────────────────────────────────────────────────

  async getFeature(entityType: string, entityId: string, featureName: string): Promise<any> {
    const cacheKey = this.buildKey(entityType, entityId, featureName);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const record = await this.featureRepo.findOne({
      where: { entityType, entityId, featureName },
      order: { createdAt: 'DESC' },
    });

    if (!record) throw new NotFoundException(`Feature "${featureName}" not found for ${entityType}:${entityId}`);

    this.setCache(cacheKey, record.featureValue);
    return record.featureValue;
  }

  async getEntityFeatures(entityType: string, entityId: string): Promise<Record<string, any>> {
    const records = await this.featureRepo.find({
      where: { entityType, entityId },
      order: { featureName: 'ASC', createdAt: 'DESC' },
    });

    const featureMap: Record<string, any> = {};
    for (const r of records) {
      if (!(r.featureName in featureMap)) {
        featureMap[r.featureName] = r.featureValue;
      }
    }
    return featureMap;
  }

  // ─────────────────────────────────────────────────────
  // SET
  // ─────────────────────────────────────────────────────

  async setFeature(record: FeatureRecord): Promise<AIFeature> {
    const existing = await this.featureRepo.findOne({
      where: {
        entityType: record.entityType,
        entityId: record.entityId,
        featureName: record.featureName,
      },
    });

    const entity = existing ?? this.featureRepo.create();
    entity.entityType = record.entityType;
    entity.entityId = record.entityId;
    entity.featureName = record.featureName;
    entity.featureType = record.featureType;
    entity.featureValue = record.featureValue;
    entity.version = record.version ?? '1.0.0';
    entity.metadata = record.metadata ?? null;
    entity.computedAt = new Date();

    const saved = await this.featureRepo.save(entity);

    // Invalidate cache
    this.cache.delete(this.buildKey(record.entityType, record.entityId, record.featureName));

    return saved;
  }

  // ─────────────────────────────────────────────────────
  // BATCH
  // ─────────────────────────────────────────────────────

  async batchSetFeatures(records: FeatureRecord[]): Promise<AIFeature[]> {
    const saved: AIFeature[] = [];
    for (const record of records) {
      saved.push(await this.setFeature(record));
    }
    this.logger.log(`Batch set ${saved.length} features`);
    return saved;
  }

  async batchGetFeatures(
    entityType: string,
    entityIds: string[],
    featureName: string,
  ): Promise<Record<string, any>> {
    const records = await this.featureRepo.find({
      where: { entityType, entityId: In(entityIds), featureName },
      order: { createdAt: 'DESC' },
    });

    const result: Record<string, any> = {};
    for (const r of records) {
      if (!(r.entityId in result)) result[r.entityId] = r.featureValue;
    }
    return result;
  }

  // ─────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────

  async deleteFeature(entityType: string, entityId: string, featureName: string): Promise<void> {
    await this.featureRepo.delete({ entityType, entityId, featureName });
    this.cache.delete(this.buildKey(entityType, entityId, featureName));
  }

  async deleteEntityFeatures(entityType: string, entityId: string): Promise<void> {
    await this.featureRepo.delete({ entityType, entityId });
    // Clear cache entries for this entity
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${entityType}:${entityId}:`)) this.cache.delete(key);
    }
  }

  // ─────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────

  private buildKey(entityType: string, entityId: string, featureName: string): string {
    return `${entityType}:${entityId}:${featureName}`;
  }

  private setCache(key: string, value: any): void {
    this.cache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }
}
