import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DigitalAsset, DigitalAssetStatus, DigitalAssetType, AccessModel } from './entities/digital-asset.entity';
import { EplayLicense, LicenseStatus } from './entities/eplay-license.entity';
import { CreatorProfile } from './entities/creator-profile.entity';
import { CreateDigitalAssetDto } from './dto/create-digital-asset.dto';
import { PurchaseAssetDto } from './dto/purchase-asset.dto';
import { CreateCreatorProfileDto } from './dto/create-creator-profile.dto';
import { WalletsService } from '../wallets/wallets.service';
import { RevenueRecord, RevenueType } from '../revenue/entities/revenue-record.entity';

@Injectable()
export class EplayService {
  private readonly logger = new Logger(EplayService.name);
  private readonly PLATFORM_ROYALTY_PCT = 15; // 15% platform cut

  constructor(
    @InjectRepository(DigitalAsset)
    private readonly assetRepo: Repository<DigitalAsset>,
    @InjectRepository(EplayLicense)
    private readonly licenseRepo: Repository<EplayLicense>,
    @InjectRepository(CreatorProfile)
    private readonly creatorRepo: Repository<CreatorProfile>,
    @InjectRepository(RevenueRecord)
    private readonly revenueRepo: Repository<RevenueRecord>,
    private readonly walletsService: WalletsService,
  ) {}

  // ── Creator Profile ──────────────────────────────────────────────────────

  async openCreatorProfile(userId: string, dto: CreateCreatorProfileDto): Promise<CreatorProfile> {
    const existing = await this.creatorRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('Creator profile already exists for this user.');
    }
    const profile = this.creatorRepo.create({
      userId,
      displayName: dto.displayName,
      bio: dto.bio ?? null,
      avatarUrl: dto.avatarUrl ?? null,
      bannerUrl: dto.bannerUrl ?? null,
      creatorRoyaltyPct: 100 - this.PLATFORM_ROYALTY_PCT,
    });
    return this.creatorRepo.save(profile);
  }

  async getMyCreatorProfile(userId: string): Promise<CreatorProfile> {
    const profile = await this.creatorRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Creator profile not found.');
    return profile;
  }

  // ── Digital Assets ───────────────────────────────────────────────────────

  async uploadAsset(userId: string, dto: CreateDigitalAssetDto): Promise<DigitalAsset> {
    const creatorProfile = await this.creatorRepo.findOne({ where: { userId } });
    if (!creatorProfile) {
      throw new ForbiddenException('You must open a creator profile before uploading content.');
    }
    if (dto.accessModel === AccessModel.RENTAL && !dto.rentalDurationDays) {
      throw new BadRequestException('rentalDurationDays is required for RENTAL access model.');
    }

    const asset = this.assetRepo.create({
      ...dto,
      creatorProfileId: creatorProfile.id,
      platformRoyaltyPct: this.PLATFORM_ROYALTY_PCT,
      status: DigitalAssetStatus.DRAFT,
    });
    const saved = await this.assetRepo.save(asset);
    await this.creatorRepo.increment({ id: creatorProfile.id }, 'assetCount', 1);
    this.logger.log(`Asset ${saved.id} uploaded by creator ${creatorProfile.id}`);
    return saved;
  }

  async publishAsset(userId: string, assetId: string): Promise<DigitalAsset> {
    const asset = await this.getOwnedAsset(userId, assetId);
    if (asset.status === DigitalAssetStatus.PUBLISHED) return asset;
    await this.assetRepo.update(assetId, { status: DigitalAssetStatus.PUBLISHED });
    return { ...asset, status: DigitalAssetStatus.PUBLISHED };
  }

  async browseAssets(type?: DigitalAssetType, page = 1, limit = 20): Promise<{ items: DigitalAsset[]; total: number }> {
    const query = this.assetRepo.createQueryBuilder('a')
      .where('a.status = :status', { status: DigitalAssetStatus.PUBLISHED })
      .andWhere('a.deleted_at IS NULL')
      .orderBy('a.purchase_count', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (type) query.andWhere('a.type = :type', { type });

    const [items, total] = await query.getManyAndCount();
    return { items, total };
  }

  async getAssetById(assetId: string): Promise<DigitalAsset> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset || asset.status === DigitalAssetStatus.REMOVED) {
      throw new NotFoundException('Content not found.');
    }
    return asset;
  }

  // ── Purchase / Cloud Locker ──────────────────────────────────────────────

  async purchaseAsset(userId: string, dto: PurchaseAssetDto): Promise<EplayLicense> {
    const asset = await this.getAssetById(dto.digitalAssetId);

    // Idempotency: check if active license already exists
    const existing = await this.licenseRepo.findOne({
      where: { userId, digitalAssetId: asset.id, status: LicenseStatus.ACTIVE },
    });
    if (existing) {
      throw new ConflictException('You already have an active license for this content.');
    }

    // Deduct from user's fiat wallet (priceQPoints expressed as currency units)
    await this.walletsService.deductBalance(userId, Number(asset.priceQPoints));

    // Calculate royalties
    const platformCut = Number(asset.priceQPoints) * (this.PLATFORM_ROYALTY_PCT / 100);
    const creatorCut = Number(asset.priceQPoints) - platformCut;

    // Credit creator earnings counter
    const creatorProfile = await this.creatorRepo.findOne({ where: { id: asset.creatorProfileId } });
    if (creatorProfile) {
      await this.creatorRepo.increment({ id: creatorProfile.id }, 'totalEarningsQPoints', creatorCut);
    }

    // Record platform revenue
    const revenueRecord = this.revenueRepo.create({
      type: RevenueType.TRANSACTION_FEE,
      amountQPoints: platformCut,
      entityId: null,
      userId,
      refId: asset.id,
      metadata: { type: 'eplay_royalty', assetId: asset.id, creatorId: asset.creatorProfileId },
    });
    await this.revenueRepo.save(revenueRecord);

    // Track purchase count
    await this.assetRepo.increment({ id: asset.id }, 'purchaseCount', 1);

    // Compute expiry
    let expiresAt: Date | null = null;
    if (asset.accessModel === AccessModel.RENTAL && asset.rentalDurationDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + asset.rentalDurationDays);
    }

    const license = this.licenseRepo.create({
      userId,
      digitalAssetId: asset.id,
      amountPaidQPoints: asset.priceQPoints,
      transactionId: dto.transactionId ?? null,
      expiresAt,
      status: LicenseStatus.ACTIVE,
    });
    this.logger.log(`License created for user ${userId} on asset ${asset.id}`);
    return this.licenseRepo.save(license);
  }

  async getMyLocker(userId: string, page = 1, limit = 20): Promise<{ items: (EplayLicense & { asset?: DigitalAsset })[]; total: number }> {
    const [licenses, total] = await this.licenseRepo.findAndCount({
      where: { userId, status: LicenseStatus.ACTIVE },
      order: { lastAccessedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Attach asset metadata
    const assetIds = licenses.map(l => l.digitalAssetId);
    const assets = assetIds.length
      ? await this.assetRepo.findByIds(assetIds)
      : [];
    const assetMap = new Map(assets.map(a => [a.id, a]));

    const items = licenses.map(l => ({ ...l, asset: assetMap.get(l.digitalAssetId) }));
    return { items, total };
  }

  async streamAsset(userId: string, assetId: string): Promise<{ streamToken: string; expiresAt: Date }> {
    const license = await this.licenseRepo.findOne({
      where: { userId, digitalAssetId: assetId, status: LicenseStatus.ACTIVE },
    });
    if (!license) throw new ForbiddenException('No active license found for this content.');

    // Check rental expiry
    if (license.expiresAt && license.expiresAt < new Date()) {
      await this.licenseRepo.update(license.id, { status: LicenseStatus.EXPIRED });
      throw new ForbiddenException('Your access to this content has expired.');
    }

    // Update access timestamp
    await this.licenseRepo.update(license.id, { lastAccessedAt: new Date() });
    await this.assetRepo.increment({ id: assetId }, 'playCount', 1);

    // Issue a short-lived signed streaming token (the real CDN signing happens at infra level)
    const tokenExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
    const streamToken = Buffer.from(
      JSON.stringify({ userId, assetId, exp: tokenExpiry.toISOString() }),
    ).toString('base64url');

    return { streamToken, expiresAt: tokenExpiry };
  }

  async togglePin(userId: string, licenseId: string): Promise<EplayLicense> {
    const license = await this.licenseRepo.findOne({ where: { id: licenseId, userId } });
    if (!license) throw new NotFoundException('License not found.');
    await this.licenseRepo.update(licenseId, { isPinned: !license.isPinned });
    return { ...license, isPinned: !license.isPinned };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getOwnedAsset(userId: string, assetId: string): Promise<DigitalAsset> {
    const creatorProfile = await this.creatorRepo.findOne({ where: { userId } });
    if (!creatorProfile) throw new ForbiddenException('Creator profile not found.');
    const asset = await this.assetRepo.findOne({ where: { id: assetId, creatorProfileId: creatorProfile.id } });
    if (!asset) throw new NotFoundException('Asset not found or you do not own it.');
    return asset;
  }
}
