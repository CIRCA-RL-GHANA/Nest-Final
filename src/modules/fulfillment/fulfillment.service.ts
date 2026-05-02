import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FulfillmentRoutingRule,
  FulfillmentTask,
  FulfillmentProvider,
  FulfillmentStatus,
} from './entities/fulfillment.entity';
import {
  CreateRoutingRuleDto,
  DispatchFulfillmentDto,
  UpdateFulfillmentStatusDto,
} from './dto/fulfillment.dto';

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    @InjectRepository(FulfillmentRoutingRule)
    private readonly ruleRepo: Repository<FulfillmentRoutingRule>,
    @InjectRepository(FulfillmentTask)
    private readonly taskRepo: Repository<FulfillmentTask>,
  ) {}

  // ─── Routing Rules ────────────────────────────────────────────────────────

  async createRule(dto: CreateRoutingRuleDto): Promise<FulfillmentRoutingRule> {
    const rule = await this.ruleRepo.save(
      this.ruleRepo.create({
        entityId: dto.entityId,
        regionCode: dto.regionCode ?? null,
        channelType: dto.channelType ?? null,
        primaryProvider: dto.primaryProvider,
        fallbackProviders: dto.fallbackProviders ?? [],
        priority: dto.priority ?? 100,
        isActive: true,
      }),
    );
    this.logger.log(`Routing rule created: ${rule.id} for entity ${dto.entityId}`);
    return rule;
  }

  async listRules(entityId: string): Promise<FulfillmentRoutingRule[]> {
    return this.ruleRepo.find({
      where: { entityId, isActive: true },
      order: { priority: 'ASC' },
    });
  }

  async deleteRule(ruleId: string): Promise<void> {
    await this.ruleRepo.update(ruleId, { isActive: false });
  }

  // ─── Route resolution ─────────────────────────────────────────────────────

  /**
   * Resolve the best fulfillment provider for a given entity + optional context.
   * Rules are evaluated in priority order; the first match wins.
   */
  async resolveProvider(
    entityId: string,
    regionCode?: string,
    channelType?: string,
  ): Promise<FulfillmentProvider> {
    const rules = await this.listRules(entityId);

    // Try to find a specific match first (region + channel > region only > channel only > wildcard)
    const matchScore = (r: FulfillmentRoutingRule): number => {
      let score = 0;
      if (r.regionCode && r.regionCode === regionCode) score += 2;
      if (r.channelType && r.channelType === channelType) score += 1;
      if (r.regionCode && r.regionCode !== regionCode) return -1; // disqualify mismatch
      if (r.channelType && r.channelType !== channelType) return -1;
      return score;
    };

    const eligible = rules
      .map(r => ({ rule: r, score: matchScore(r) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.rule.priority - b.rule.priority);

    if (eligible.length === 0) {
      this.logger.warn(`No routing rule found for entity ${entityId}; defaulting to GENIE_LIVE`);
      return FulfillmentProvider.GENIE_LIVE;
    }

    return eligible[0].rule.primaryProvider;
  }

  // ─── Fulfillment Tasks ────────────────────────────────────────────────────

  async dispatch(dto: DispatchFulfillmentDto): Promise<FulfillmentTask> {
    const provider = dto.overrideProvider ?? (await this.resolveProvider(dto.entityId));

    const task = await this.taskRepo.save(
      this.taskRepo.create({
        entityId: dto.entityId,
        orderId: dto.orderId ?? null,
        provider,
        status: FulfillmentStatus.DISPATCHED,
        providerPayload: dto.providerPayload ?? null,
        trackingId: null,
        failureReason: null,
      }),
    );

    this.logger.log(`Fulfillment dispatched: task ${task.id} via ${provider}`);
    // In production: enqueue job → call provider SDK → record tracking ID
    return task;
  }

  async listTasks(entityId: string): Promise<FulfillmentTask[]> {
    return this.taskRepo.find({
      where: { entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async getTask(taskId: string): Promise<FulfillmentTask> {
    const t = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!t) throw new NotFoundException(`Fulfillment task ${taskId} not found`);
    return t;
  }

  async updateStatus(taskId: string, dto: UpdateFulfillmentStatusDto): Promise<FulfillmentTask> {
    const task = await this.getTask(taskId);
    task.status = dto.status;
    if (dto.trackingId) task.trackingId = dto.trackingId;
    if (dto.failureReason) task.failureReason = dto.failureReason;
    return this.taskRepo.save(task);
  }
}
