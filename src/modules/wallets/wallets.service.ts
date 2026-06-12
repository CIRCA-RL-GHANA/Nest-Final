import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { AIFraudService } from '../ai/services/ai-fraud.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly dataSource: DataSource,
    private readonly aiFraud: AIFraudService,
  ) {}

  async getOrCreateWallet(userId: string): Promise<Wallet> {
    let wallet = await this.walletRepository.findOne({ where: { userId } });

    if (!wallet) {
      wallet = this.walletRepository.create({
        userId,
        balance: 0,
        currency: 'NGN',
        isActive: true,
      });
      wallet = await this.walletRepository.save(wallet);
      this.logger.log(`Wallet created for user ${userId}`);
    }

    return wallet;
  }

  async getBalance(userId: string): Promise<{ balance: number; currency: string }> {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: Number(wallet.balance), currency: wallet.currency };
  }

  async addBalance(userId: string, amount: number): Promise<Wallet> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // ISSUE-24: INSERT ... ON CONFLICT DO NOTHING guarantees the wallet row exists
      // before we acquire the pessimistic lock — prevents duplicate wallet race.
      await manager
        .createQueryBuilder()
        .insert()
        .into(Wallet)
        .values({ userId, balance: 0, currency: 'NGN', isActive: true })
        .orIgnore()
        .execute();

      const wallet = await manager
        .getRepository(Wallet)
        .createQueryBuilder('wallet')
        .where('wallet.userId = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet!.isActive) {
        throw new BadRequestException('Wallet is inactive');
      }
      wallet!.balance = Number(wallet!.balance) + amount;
      return manager.getRepository(Wallet).save(wallet!);
    });
  }

  async deductBalance(userId: string, amount: number): Promise<Wallet> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    // AI fraud check on high-value wallet deductions (> 5000 NGN equivalent)
    if (amount >= 5000) {
      try {
        const fraudCheck = this.aiFraud.scoreTransaction({
          userId,
          amount,
          currency: 'NGN',
          paymentMethod: 'wallet',
        });
        if (fraudCheck.blocked) {
          this.logger.warn(
            `Wallet deduction BLOCKED by AI fraud check for user ${userId}: score=${fraudCheck.riskScore}`,
          );
          throw new BadRequestException(
            'Transaction blocked by fraud detection. Please contact support.',
          );
        }
        if (fraudCheck.reviewFlag) {
          this.logger.warn(
            `Wallet deduction flagged for review: user=${userId}, amount=${amount}, score=${fraudCheck.riskScore}`,
          );
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        // AI check is best-effort — log and proceed on unexpected errors
        this.logger.error(`AI fraud check error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const wallet = await manager
        .getRepository(Wallet)
        .createQueryBuilder('wallet')
        .where('wallet.userId = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet) {
        throw new NotFoundException(`Wallet not found for user ${userId}`);
      }

      if (!wallet.isActive) {
        throw new BadRequestException('Wallet is inactive');
      }

      if (Number(wallet.balance) < amount) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      wallet.balance = Number(wallet.balance) - amount;
      return manager.getRepository(Wallet).save(wallet);
    });
  }

  async getWallet(userId: string): Promise<Wallet> {
    return this.getOrCreateWallet(userId);
  }
}
