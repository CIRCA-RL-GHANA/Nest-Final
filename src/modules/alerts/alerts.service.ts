import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Alert } from './alert.entity';
import { CreateAlertDto } from './dto/create-alert.dto';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly repo: Repository<Alert>,
  ) {}

  async list(userId: string, filters: { status?: string; priority?: string; category?: string }): Promise<Alert[]> {
    const where: Record<string, any> = { userId };
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.category) where.category = filters.category;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async create(userId: string, dto: CreateAlertDto): Promise<Alert> {
    const alert = this.repo.create({
      userId,
      entityId: dto.entityId ?? null,
      title: dto.title,
      body: dto.body,
      type: dto.type ?? 'info',
      priority: dto.priority ?? 'medium',
      category: dto.category ?? null,
      tags: dto.tags ?? null,
      metadata: dto.metadata ?? null,
      status: 'open',
      resolvedAt: null,
      resolvedBy: null,
    });
    return this.repo.save(alert);
  }

  async bulkCreate(userId: string, dtos: CreateAlertDto[]): Promise<Alert[]> {
    const alerts = dtos.map(dto =>
      this.repo.create({
        userId,
        entityId: dto.entityId ?? null,
        title: dto.title,
        body: dto.body,
        type: dto.type ?? 'info',
        priority: dto.priority ?? 'medium',
        category: dto.category ?? null,
        tags: dto.tags ?? null,
        metadata: dto.metadata ?? null,
        status: 'open',
        resolvedAt: null,
        resolvedBy: null,
      }),
    );
    return this.repo.save(alerts);
  }

  async getAnalytics(userId: string): Promise<Record<string, number>> {
    const all = await this.repo.find({ where: { userId } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      total: all.length,
      open: all.filter(a => a.status === 'open').length,
      resolved: all.filter(a => a.status === 'resolved').length,
      dismissed: all.filter(a => a.status === 'dismissed').length,
      critical: all.filter(a => a.type === 'critical').length,
      highPriority: all.filter(a => a.priority === 'high' || a.priority === 'urgent').length,
      resolvedToday: all.filter(
        a => a.resolvedAt && new Date(a.resolvedAt) >= today,
      ).length,
    };
  }

  getTemplates() {
    return [
      { id: 'low-stock', title: 'Low Stock Warning', body: 'Product stock is running low.', type: 'warning', priority: 'high', category: 'inventory' },
      { id: 'payment-failed', title: 'Payment Failed', body: 'A payment attempt has failed.', type: 'critical', priority: 'urgent', category: 'payments' },
      { id: 'order-delivered', title: 'Order Delivered', body: 'Your order has been delivered.', type: 'success', priority: 'low', category: 'orders' },
      { id: 'system-info', title: 'System Notice', body: 'A system update is scheduled.', type: 'info', priority: 'medium', category: 'system' },
    ];
  }

  async search(userId: string, q: string): Promise<Alert[]> {
    return this.repo.find({
      where: [
        { userId, title: Like(`%${q}%`) },
        { userId, body: Like(`%${q}%`) },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Alert> {
    const alert = await this.repo.findOne({ where: { id, userId } });
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  async resolve(id: string, userId: string): Promise<Alert> {
    const alert = await this.findOne(id, userId);
    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = userId;
    return this.repo.save(alert);
  }

  async dismiss(id: string, userId: string): Promise<Alert> {
    const alert = await this.findOne(id, userId);
    alert.status = 'dismissed';
    return this.repo.save(alert);
  }

  async remove(id: string, userId: string): Promise<void> {
    const alert = await this.findOne(id, userId);
    await this.repo.remove(alert);
  }
}
