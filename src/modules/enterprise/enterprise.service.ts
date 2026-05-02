import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  EnterpriseProfile,
  EnterpriseStatus,
} from './entities/enterprise-profile.entity';
import { EnterpriseApiKey, ApiKeyPermission } from './entities/enterprise-api-key.entity';
import {
  RegisterEnterpriseDto,
  UpdateEnterpriseSettingsDto,
  VerifyEnterpriseDto,
  CreateApiKeyDto,
} from './dto/enterprise.dto';

@Injectable()
export class EnterpriseService {
  private readonly logger = new Logger(EnterpriseService.name);

  constructor(
    @InjectRepository(EnterpriseProfile)
    private readonly profileRepo: Repository<EnterpriseProfile>,
    @InjectRepository(EnterpriseApiKey)
    private readonly apiKeyRepo: Repository<EnterpriseApiKey>,
  ) {}

  // ─── Registration ─────────────────────────────────────────────────────────

  async register(dto: RegisterEnterpriseDto): Promise<EnterpriseProfile> {
    const existing = await this.profileRepo.findOne({ where: { entityId: dto.entityId } });
    if (existing) throw new ConflictException(`Enterprise profile already exists for entity ${dto.entityId}`);

    const profile = await this.profileRepo.save(
      this.profileRepo.create({
        entityId: dto.entityId,
        enterpriseType: dto.enterpriseType,
        legalName: dto.legalName ?? null,
        taxId: dto.taxId ?? null,
        licenceDocumentUrl: dto.licenceDocumentUrl ?? null,
        webhookUrl: dto.webhookUrl ?? null,
        enabledPathways: dto.enabledPathways ?? null,
        settings: dto.settings ?? null,
        status: EnterpriseStatus.PENDING,
      }),
    );
    this.logger.log(`Enterprise registered: ${profile.id} (entity: ${dto.entityId})`);
    return profile;
  }

  async getProfile(entityId: string): Promise<EnterpriseProfile> {
    const p = await this.profileRepo.findOne({ where: { entityId } });
    if (!p) throw new NotFoundException(`Enterprise profile not found for entity ${entityId}`);
    return p;
  }

  async listProfiles(onlyVerified?: boolean): Promise<EnterpriseProfile[]> {
    const where = onlyVerified ? { verified: true } : {};
    return this.profileRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async updateSettings(entityId: string, dto: UpdateEnterpriseSettingsDto): Promise<EnterpriseProfile> {
    const profile = await this.getProfile(entityId);
    if (dto.webhookUrl !== undefined) profile.webhookUrl = dto.webhookUrl;
    if (dto.settings !== undefined) profile.settings = { ...(profile.settings ?? {}), ...dto.settings };
    if (dto.enabledPathways !== undefined) profile.enabledPathways = dto.enabledPathways;
    return this.profileRepo.save(profile);
  }

  /** Platform admin: verify or suspend an enterprise. */
  async setVerification(entityId: string, dto: VerifyEnterpriseDto): Promise<EnterpriseProfile> {
    const profile = await this.getProfile(entityId);
    profile.verified = dto.verified;
    profile.status = dto.verified ? EnterpriseStatus.ACTIVE : EnterpriseStatus.PENDING;
    if (dto.isFacilitator !== undefined) profile.isFacilitator = dto.isFacilitator;
    if (dto.qpIssuanceCap !== undefined) profile.qpIssuanceCap = dto.qpIssuanceCap;
    return this.profileRepo.save(profile);
  }

  /** Register a branch (sub-entity) under a parent enterprise. */
  async registerBranch(
    parentEntityId: string,
    dto: RegisterEnterpriseDto,
  ): Promise<EnterpriseProfile> {
    const parent = await this.getProfile(parentEntityId);
    if (!parent.verified) throw new ForbiddenException('Parent enterprise must be verified before adding branches');
    const branch = await this.register({ ...dto });
    // Link to parent
    await this.profileRepo.update(branch.id, { parentEnterpriseId: parent.id });
    branch.parentEnterpriseId = parent.id;
    return branch;
  }

  // ─── API Key Management ───────────────────────────────────────────────────

  /** Generate a new API key. Returns the raw key ONCE — hash is stored. */
  async createApiKey(
    entityId: string,
    dto: CreateApiKeyDto,
  ): Promise<{ apiKey: EnterpriseApiKey; rawKey: string }> {
    const rawKey = `pk_live_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);
    const keyPrefix = rawKey.substring(0, 16);

    const apiKey = await this.apiKeyRepo.save(
      this.apiKeyRepo.create({
        entityId,
        keyHash,
        keyPrefix,
        label: dto.label ?? 'Default Key',
        permissions: dto.permissions ?? [ApiKeyPermission.ALL],
        expiresAt: dto.expiresAt ?? null,
        ipWhitelist: dto.ipWhitelist ?? null,
        isActive: true,
      }),
    );

    this.logger.log(`API key created: ${keyPrefix}... for entity ${entityId}`);
    return { apiKey, rawKey };
  }

  async listApiKeys(entityId: string): Promise<EnterpriseApiKey[]> {
    return this.apiKeyRepo.find({ where: { entityId, isActive: true }, order: { createdAt: 'DESC' } });
  }

  async revokeApiKey(entityId: string, keyId: string): Promise<void> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, entityId } });
    if (!key) throw new NotFoundException(`API key ${keyId} not found`);
    await this.apiKeyRepo.update(keyId, { isActive: false });
    this.logger.log(`API key ${keyId} revoked for entity ${entityId}`);
  }

  /** Validate an incoming raw API key against stored hashes. */
  async validateApiKey(rawKey: string): Promise<EnterpriseApiKey | null> {
    const prefix = rawKey.substring(0, 16);
    const candidates = await this.apiKeyRepo.find({
      where: { keyPrefix: prefix, isActive: true },
    });
    for (const candidate of candidates) {
      const match = await bcrypt.compare(rawKey, candidate.keyHash);
      if (match) {
        await this.apiKeyRepo.update(candidate.id, { lastUsedAt: new Date() });
        return candidate;
      }
    }
    return null;
  }

  async getVerifiedProfile(entityId: string): Promise<EnterpriseProfile> {
    const p = await this.getProfile(entityId);
    if (!p.verified) throw new ForbiddenException(`Enterprise ${entityId} is not verified`);
    return p;
  }
}
