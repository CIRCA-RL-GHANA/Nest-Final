import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tab } from './tab.entity';
import { CreateTabDto } from './dto/create-tab.dto';
import { UpdateTabDto } from './dto/update-tab.dto';

@Injectable()
export class TabsService {
  private readonly logger = new Logger(TabsService.name);

  constructor(
    @InjectRepository(Tab)
    private readonly repo: Repository<Tab>,
  ) {}

  async listByEntity(entityId: string): Promise<Tab[]> {
    return this.repo.find({ where: { entityId }, order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateTabDto): Promise<Tab> {
    const tab = this.repo.create({
      entityId: dto.entityId,
      customerId: dto.customerId,
      label: dto.label,
      balance: 0,
      creditLimit: dto.creditLimit ?? 0,
      status: 'open',
      metadata: dto.metadata ?? null,
    });
    return this.repo.save(tab);
  }

  async findOne(id: string): Promise<Tab> {
    const tab = await this.repo.findOne({ where: { id } });
    if (!tab) throw new NotFoundException('Tab not found');
    return tab;
  }

  async update(id: string, dto: UpdateTabDto): Promise<Tab> {
    const tab = await this.findOne(id);
    if (dto.label !== undefined) tab.label = dto.label;
    if (dto.creditLimit !== undefined) tab.creditLimit = dto.creditLimit;
    if (dto.status !== undefined) tab.status = dto.status;
    return this.repo.save(tab);
  }

  async remove(id: string): Promise<void> {
    const tab = await this.findOne(id);
    await this.repo.remove(tab);
  }

  async chargeTab(id: string, amount: number, description?: string): Promise<Tab> {
    const tab = await this.findOne(id);
    if (tab.status !== 'open') {
      throw new BadRequestException('Tab is not open');
    }
    const newBalance = Number(tab.balance) + amount;
    if (newBalance > Number(tab.creditLimit) && Number(tab.creditLimit) > 0) {
      throw new BadRequestException(
        `Charge of ${amount} would exceed credit limit of ${tab.creditLimit} (current balance: ${tab.balance})`,
      );
    }
    tab.balance = newBalance;
    this.logger.log(`Tab ${id} charged ${amount}${description ? ` (${description})` : ''}`);
    return this.repo.save(tab);
  }

  async settleTab(id: string, amount: number): Promise<Tab> {
    const tab = await this.findOne(id);
    const newBalance = Math.max(0, Number(tab.balance) - amount);
    tab.balance = newBalance;
    this.logger.log(`Tab ${id} settled by ${amount}, new balance: ${newBalance}`);
    return this.repo.save(tab);
  }
}
