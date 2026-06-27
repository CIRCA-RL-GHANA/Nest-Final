import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
  ) {}

  create(dto: CreateCampaignDto, createdBy: string): Promise<Campaign> {
    return this.repo.save(this.repo.create({ ...dto, createdBy, spent: 0 }));
  }

  findAll(entityId: string, status?: CampaignStatus): Promise<Campaign[]> {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.entity_id = :entityId', { entityId })
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.created_at', 'DESC');
    if (status) qb.andWhere('c.status = :status', { status });
    return qb.getMany();
  }

  async findOne(id: string): Promise<Campaign> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Campaign ${id} not found`);
    return c;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const c = await this.findOne(id);
    Object.assign(c, dto);
    return this.repo.save(c);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.softDelete(id);
  }

  async activate(id: string): Promise<Campaign> {
    const c = await this.findOne(id);
    c.status = CampaignStatus.ACTIVE;
    return this.repo.save(c);
  }

  async pause(id: string): Promise<Campaign> {
    const c = await this.findOne(id);
    c.status = CampaignStatus.PAUSED;
    return this.repo.save(c);
  }

  async getAnalytics(id: string): Promise<Record<string, any>> {
    const c = await this.findOne(id);
    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      budget: c.budget,
      spent: c.spent,
      utilisation: c.budget ? ((Number(c.spent) / Number(c.budget)) * 100).toFixed(1) + '%' : null,
      metrics: c.metrics ?? {},
    };
  }
}
