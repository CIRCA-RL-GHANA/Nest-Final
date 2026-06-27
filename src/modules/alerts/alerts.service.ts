import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Alert, AlertStatus, AlertCategory, AlertPriority } from './entities/alert.entity';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto, ResolveAlertDto, AddTimelineEventDto } from './dto/update-alert.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
  ) {}

  async create(dto: CreateAlertDto, creatorUserId: string): Promise<Alert> {
    const alert = this.alertRepo.create({
      ...dto,
      createdBy: dto.createdBy ?? 'System',
      timeline: [this.makeEvent('created', dto.createdBy ?? 'System', 'Alert created')],
    });
    const saved = await this.alertRepo.save(alert);
    this.logger.log(`Alert created: ${saved.id} by ${creatorUserId}`);
    return saved;
  }

  async findAll(filters: {
    entityId?: string;
    status?: AlertStatus;
    category?: AlertCategory;
    priority?: AlertPriority;
    assigneeId?: string;
    searchQuery?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Alert[]; total: number }> {
    const qb = this.alertRepo.createQueryBuilder('a').where('a.deleted_at IS NULL');

    if (filters.entityId) qb.andWhere('a.entityId = :entityId', { entityId: filters.entityId });
    if (filters.status) qb.andWhere('a.status = :status', { status: filters.status });
    if (filters.category) qb.andWhere('a.category = :category', { category: filters.category });
    if (filters.priority) qb.andWhere('a.priority = :priority', { priority: filters.priority });
    if (filters.assigneeId) qb.andWhere('a.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    if (filters.searchQuery) {
      qb.andWhere(
        '(LOWER(a.title) LIKE :q OR LOWER(a.description) LIKE :q)',
        { q: `%${filters.searchQuery.toLowerCase()}%` },
      );
    }

    qb.orderBy('a.created_at', 'DESC')
      .take(filters.limit ?? 50)
      .skip(filters.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<Alert> {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    return alert;
  }

  async update(id: string, dto: UpdateAlertDto, actorName: string): Promise<Alert> {
    const alert = await this.findOne(id);
    const prevStatus = alert.status;

    Object.assign(alert, dto);

    if (dto.status && dto.status !== prevStatus) {
      alert.timeline = [
        ...alert.timeline,
        this.makeEvent('statusChanged', actorName, `Status changed to ${dto.status}`),
      ];
    }

    if (dto.assigneeName && dto.assigneeName !== alert.assigneeName) {
      alert.timeline = [
        ...alert.timeline,
        this.makeEvent('assigned', actorName, `Assigned to ${dto.assigneeName}`),
      ];
    }

    return this.alertRepo.save(alert);
  }

  async resolve(id: string, dto: ResolveAlertDto, actorName: string): Promise<Alert> {
    const alert = await this.findOne(id);
    alert.status = AlertStatus.RESOLVED;
    alert.resolution = {
      ...dto,
      resolvedAt: new Date().toISOString(),
      verificationStatus: 'pending_review',
    };
    alert.timeline = [
      ...alert.timeline,
      this.makeEvent('resolved', actorName, `Resolved: ${dto.summary ?? 'Issue resolved'}`),
    ];
    return this.alertRepo.save(alert);
  }

  async escalate(id: string, actorName: string): Promise<Alert> {
    const alert = await this.findOne(id);
    alert.status = AlertStatus.ESCALATED;
    alert.timeline = [
      ...alert.timeline,
      this.makeEvent('escalated', actorName, 'Alert escalated to next level'),
    ];
    return this.alertRepo.save(alert);
  }

  async addTimelineEvent(id: string, dto: AddTimelineEventDto, actorName: string): Promise<Alert> {
    const alert = await this.findOne(id);
    alert.timeline = [
      ...alert.timeline,
      this.makeEvent(dto.type ?? 'commented', dto.actorName ?? actorName, dto.description ?? '', dto.details),
    ];
    return this.alertRepo.save(alert);
  }

  async toggleBookmark(id: string): Promise<Alert> {
    const alert = await this.findOne(id);
    alert.isBookmarked = !alert.isBookmarked;
    return this.alertRepo.save(alert);
  }

  async getStats(entityId?: string): Promise<Record<string, unknown>> {
    const qb = this.alertRepo.createQueryBuilder('a').where('a.deleted_at IS NULL');
    if (entityId) qb.andWhere('a.entityId = :entityId', { entityId });

    const all = await qb.getMany();
    const pending = all.filter(a =>
      [AlertStatus.NEW, AlertStatus.ASSIGNED, AlertStatus.IN_PROGRESS, AlertStatus.ESCALATED].includes(a.status),
    );
    const resolved = all.filter(a =>
      [AlertStatus.RESOLVED, AlertStatus.VERIFIED, AlertStatus.CLOSED].includes(a.status),
    );

    const byCategory: Record<string, number> = {};
    for (const a of all) {
      byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    }

    return {
      total: all.length,
      pending: pending.length,
      resolved: resolved.length,
      highPriorityPending: pending.filter(
        a => a.priority === AlertPriority.HIGH || a.priority === AlertPriority.CRITICAL,
      ).length,
      byCategory,
    };
  }

  async remove(id: string): Promise<void> {
    await this.alertRepo.softDelete(id);
  }

  private makeEvent(
    type: string,
    actorName: string,
    description: string,
    details?: string,
  ): Record<string, unknown> {
    return {
      id: uuidv4(),
      type,
      actorName,
      description,
      details: details ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
