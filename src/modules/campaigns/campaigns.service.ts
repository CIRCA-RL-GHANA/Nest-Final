import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from './campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
  ) {}

  async list(entityId: string, status?: string): Promise<Campaign[]> {
    const where: Record<string, any> = { entityId };
    if (status) where.status = status;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateCampaignDto): Promise<Campaign> {
    const campaign = this.repo.create({
      entityId: dto.entityId,
      name: dto.name,
      type: dto.type ?? 'awareness',
      status: 'draft',
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      budget: dto.budget ?? null,
      targetAudience: dto.targetAudience ?? null,
      content: dto.content,
      impressions: 0,
      clicks: 0,
      conversions: 0,
    });
    return this.repo.save(campaign);
  }

  async findOne(id: string): Promise<Campaign> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findOne(id);
    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.type !== undefined) campaign.type = dto.type;
    if (dto.startDate !== undefined) campaign.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) campaign.endDate = new Date(dto.endDate);
    if (dto.budget !== undefined) campaign.budget = dto.budget;
    if (dto.targetAudience !== undefined) campaign.targetAudience = dto.targetAudience;
    if (dto.content !== undefined) campaign.content = dto.content;
    return this.repo.save(campaign);
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    await this.repo.remove(campaign);
  }

  async setStatus(id: string, status: string): Promise<Campaign> {
    const campaign = await this.findOne(id);
    campaign.status = status;
    return this.repo.save(campaign);
  }

  async getAnalytics(id: string): Promise<Record<string, any>> {
    const c = await this.findOne(id);
    const ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
    const conversionRate = c.clicks > 0 ? c.conversions / c.clicks : 0;
    return {
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      ctr: parseFloat(ctr.toFixed(4)),
      conversionRate: parseFloat(conversionRate.toFixed(4)),
    };
  }
}
