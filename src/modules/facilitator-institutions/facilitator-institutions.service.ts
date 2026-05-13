import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InstitutionConfig } from './entities/institution-config.entity';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { QPointTransaction, TransactionType, TransactionStatus } from '../qpoints/entities/qpoint-transaction.entity';
import { OnboardInstitutionDto, IssueQpDto, InitiateSettlementDto } from './dto/institution.dto';

// ─── Global QP hard cap: 500 trillion ────────────────────────────────────────
const _GLOBAL_QP_CAP = 500_000_000_000_000;

@Injectable()
export class FacilitatorInstitutionsService {
  private readonly logger = new Logger(FacilitatorInstitutionsService.name);

  constructor(
    @InjectRepository(InstitutionConfig)
    private readonly institutionRepo: Repository<InstitutionConfig>,
    @InjectRepository(QPointAccount)
    private readonly qpAccountRepo: Repository<QPointAccount>,
    @InjectRepository(QPointTransaction)
    private readonly qpTxRepo: Repository<QPointTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Onboard ─────────────────────────────────────────────────────────────

  async onboard(dto: OnboardInstitutionDto): Promise<InstitutionConfig> {
    const existing = await this.institutionRepo.findOne({ where: { entityId: dto.entityId } });
    if (existing) throw new ConflictException(`Institution already registered for entity ${dto.entityId}`);

    const institution = this.institutionRepo.create({
      entityId: dto.entityId,
      tier: dto.tier,
      issueCap: dto.issueCap,
      facilityFeeRate: dto.facilityFeeRate ?? 0.001,
      isActive: false,
      dueDiligenceCleared: false,
    });
    return this.institutionRepo.save(institution);
  }

  // ─── Approve (admin) ─────────────────────────────────────────────────────

  async approve(entityId: string): Promise<InstitutionConfig> {
    const inst = await this.getConfig(entityId);
    await this.institutionRepo.update(inst.id, { isActive: true, dueDiligenceCleared: true });
    return this.institutionRepo.findOneOrFail({ where: { entityId } });
  }

  // ─── Get balance / stats ─────────────────────────────────────────────────

  async getBalance(entityId: string): Promise<{
    issueCap: number;
    mintedSupply: number;
    remaining: number;
    tier: string;
    facilityFeeRate: number;
    qpBalance: number;
  }> {
    const inst = await this.getConfig(entityId);
    const account = await this.qpAccountRepo.findOne({ where: { entityId } });

    return {
      issueCap: Number(inst.issueCap),
      mintedSupply: Number(inst.mintedSupply),
      remaining: Number(inst.issueCap) - Number(inst.mintedSupply),
      tier: inst.tier,
      facilityFeeRate: Number(inst.facilityFeeRate),
      qpBalance: account ? Number(account.balance) : 0,
    };
  }

  // ─── Issue (mint) QP ─────────────────────────────────────────────────────

  async issue(dto: IssueQpDto): Promise<{ transactionId: string; minted: number; totalMinted: number }> {
    const inst = await this.getConfig(dto.entityId);

    if (!inst.isActive || !inst.dueDiligenceCleared) {
      throw new ForbiddenException('Institution is not active or has not completed due diligence');
    }

    const newTotal = Number(inst.mintedSupply) + dto.amount;
    if (newTotal > Number(inst.issueCap)) {
      throw new BadRequestException(
        `Issuance of ${dto.amount} QP would exceed approved cap of ${inst.issueCap}. Remaining: ${Number(inst.issueCap) - Number(inst.mintedSupply)}`,
      );
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // Credit the institution's QP account
      const account = await qr.manager.findOne(QPointAccount, { where: { entityId: dto.entityId } });
      if (!account) throw new NotFoundException(`No QP account found for entity ${dto.entityId}`);

      await qr.manager.update(QPointAccount, account.id, {
        balance: () => `balance + ${dto.amount}`,
      });

      // Record the issuance transaction
      const tx = qr.manager.create(QPointTransaction, {
        accountId: account.id,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
        amount: dto.amount,
        balanceBefore: Number(account.balance),
        balanceAfter: Number(account.balance) + dto.amount,
        description: `Institutional issuance: ${dto.reason ?? 'minted by institution'}`,
        metadata: { source: 'facilitator_institution', entityId: dto.entityId },
      } as any);
      const saved = await qr.manager.save(tx);

      // Update minted supply on institution record
      await qr.manager.update(InstitutionConfig, inst.id, {
        mintedSupply: newTotal,
      });

      await qr.commitTransaction();
      this.logger.log(`Institution ${dto.entityId} minted ${dto.amount} QP (total: ${newTotal})`);

      return { transactionId: saved.id, minted: dto.amount, totalMinted: newTotal };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── Net-settle between two enterprise entities ───────────────────────────

  async initiateSettlement(dto: InitiateSettlementDto): Promise<{
    transactionId: string;
    settled: number;
    fee: number;
    reference: string;
  }> {
    if (dto.fromEntityId === dto.toEntityId) {
      throw new BadRequestException('Cannot settle between the same entity');
    }

    const fromAccount = await this.qpAccountRepo.findOne({ where: { entityId: dto.fromEntityId } });
    const toAccount = await this.qpAccountRepo.findOne({ where: { entityId: dto.toEntityId } });

    if (!fromAccount) throw new NotFoundException(`No QP account for source entity ${dto.fromEntityId}`);
    if (!toAccount) throw new NotFoundException(`No QP account for dest entity ${dto.toEntityId}`);

    // Determine fee from the from-entity's institution config (if one exists)
    const inst = await this.institutionRepo.findOne({ where: { entityId: dto.fromEntityId } });
    const feeRate = inst ? Number(inst.facilityFeeRate) : 0.001;
    const fee = Math.floor(dto.amount * feeRate);
    const netAmount = dto.amount - fee;

    if (Number(fromAccount.balance) < dto.amount) {
      throw new BadRequestException('Insufficient QP balance for settlement');
    }

    const reference = dto.reference ?? `settle_${Date.now()}`;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      await qr.manager.update(QPointAccount, fromAccount.id, {
        balance: () => `balance - ${dto.amount}`,
      });
      await qr.manager.update(QPointAccount, toAccount.id, {
        balance: () => `balance + ${netAmount}`,
      });

      const debitTx = qr.manager.create(QPointTransaction, {
        accountId: fromAccount.id,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.COMPLETED,
        amount: -dto.amount,
        balanceBefore: Number(fromAccount.balance),
        balanceAfter: Number(fromAccount.balance) - dto.amount,
        description: `Settlement debit → ${dto.toEntityId} | ref: ${reference}`,
        metadata: { settlement: true, reference },
      } as any);
      const saved = await qr.manager.save(debitTx);

      const creditTx = qr.manager.create(QPointTransaction, {
        accountId: toAccount.id,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.COMPLETED,
        amount: netAmount,
        balanceBefore: Number(toAccount.balance),
        balanceAfter: Number(toAccount.balance) + netAmount,
        description: `Settlement credit ← ${dto.fromEntityId} | ref: ${reference}`,
        metadata: { settlement: true, reference },
      } as any);
      await qr.manager.save(creditTx);

      if (inst) {
        await qr.manager.update(InstitutionConfig, inst.id, { lastSettlementAt: new Date() });
      }

      await qr.commitTransaction();
      this.logger.log(`Settlement ${reference}: ${dto.amount} QP from ${dto.fromEntityId} → ${dto.toEntityId}, fee ${fee}`);

      return { transactionId: saved.id, settled: netAmount, fee, reference };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async getConfig(entityId: string): Promise<InstitutionConfig> {
    const inst = await this.institutionRepo.findOne({ where: { entityId } });
    if (!inst) throw new NotFoundException(`No institutional config for entity ${entityId}`);
    return inst;
  }
}
