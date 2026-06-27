import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tab, TabStatus } from './entities/tab.entity';
import { TabTransaction, TabTransactionType } from './entities/tab-transaction.entity';
import { CreateTabDto, UpdateTabDto, ChargeTabDto, SettleTabDto } from './dto/tab.dto';

@Injectable()
export class TabsService {
  constructor(
    @InjectRepository(Tab) private readonly tabRepo: Repository<Tab>,
    @InjectRepository(TabTransaction) private readonly txRepo: Repository<TabTransaction>,
  ) {}

  create(dto: CreateTabDto, createdBy: string): Promise<Tab> {
    return this.tabRepo.save(
      this.tabRepo.create({ ...dto, creditLimit: dto.creditLimit ?? 0, balance: 0, createdBy }),
    );
  }

  findAll(entityId: string): Promise<Tab[]> {
    return this.tabRepo.find({
      where: { entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Tab> {
    const tab = await this.tabRepo.findOne({ where: { id } });
    if (!tab) throw new NotFoundException(`Tab ${id} not found`);
    return tab;
  }

  async update(id: string, dto: UpdateTabDto): Promise<Tab> {
    const tab = await this.findOne(id);
    Object.assign(tab, dto);
    return this.tabRepo.save(tab);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.tabRepo.softDelete(id);
  }

  async charge(id: string, dto: ChargeTabDto): Promise<Tab> {
    const tab = await this.findOne(id);
    if (tab.status !== TabStatus.OPEN) throw new BadRequestException('Tab is not open');
    const newBalance = Number(tab.balance) + dto.amount;
    if (tab.creditLimit > 0 && newBalance > Number(tab.creditLimit)) {
      throw new BadRequestException('Charge exceeds credit limit');
    }
    tab.balance = newBalance;
    await this.tabRepo.save(tab);
    await this.txRepo.save(this.txRepo.create({
      tabId: id,
      type: TabTransactionType.CHARGE,
      amount: dto.amount,
      description: dto.description,
      reference: dto.reference,
    }));
    return tab;
  }

  async settle(id: string, dto: SettleTabDto): Promise<Tab> {
    const tab = await this.findOne(id);
    if (tab.status !== TabStatus.OPEN) throw new BadRequestException('Tab is not open');
    const newBalance = Number(tab.balance) - dto.amount;
    if (newBalance < 0) throw new BadRequestException('Settlement exceeds outstanding balance');
    tab.balance = newBalance;
    await this.tabRepo.save(tab);
    await this.txRepo.save(this.txRepo.create({
      tabId: id,
      type: TabTransactionType.SETTLEMENT,
      amount: dto.amount,
      reference: dto.reference,
    }));
    return tab;
  }

  getTransactions(id: string): Promise<TabTransaction[]> {
    return this.txRepo.find({
      where: { tabId: id },
      order: { createdAt: 'DESC' },
    });
  }
}
