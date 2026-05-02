import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, FindOptionsWhere } from 'typeorm';
import { DepositQPointsDto } from './dto/deposit-qpoints.dto';
import { TransferQPointsDto } from './dto/transfer-qpoints.dto';
import { WithdrawQPointsDto } from './dto/withdraw-qpoints.dto';
import { GetTransactionsDto } from './dto/get-transactions.dto';
import { ReviewFraudDto } from './dto/review-fraud.dto';
import {
  QPointTransaction,
  TransactionType,
  TransactionStatus,
  RiskLevel,
} from './entities/qpoint-transaction.entity';
import { QPointAccount } from './entities/qpoint-account.entity';
import { FraudLog, FraudDetectionReason, FraudActionTaken } from './entities/fraud-log.entity';
import { BehaviorLog, BehaviorType } from './entities/behavior-log.entity';
import { GeneralLedger } from './entities/general-ledger.entity';
import { JournalEntry, EntryType } from './entities/journal-entry.entity';
import { AIFraudService } from '../ai/services/ai-fraud.service';

interface FraudCheckContext {
  accountId: string;
  userId?: string;
  amount: number;
  transactionType: TransactionType;
  ipAddress?: string;
  deviceFingerprint?: string;
  geolocation?: Record<string, any>;
}

interface RiskAssessmentResult {
  riskScore: number;
  riskLevel: RiskLevel;
  isFlagged: boolean;
  flagReason?: string;
  requiresApproval: boolean;
}

@Injectable()
export class QPointsTransactionService {
  private readonly logger = new Logger(QPointsTransactionService.name);

  // AML thresholds
  private readonly HIGH_VALUE_THRESHOLD = 5000;
  private readonly DAILY_VELOCITY_THRESHOLD = 10000;
  private readonly MAX_DAILY_TRANSACTIONS = 20;
  private readonly RAPID_TRANSACTION_WINDOW_MINUTES = 5;
  private readonly MAX_TRANSACTIONS_IN_WINDOW = 5;

  constructor(
    @InjectRepository(QPointTransaction)
    private readonly transactionRepository: Repository<QPointTransaction>,
    @InjectRepository(QPointAccount)
    private readonly accountRepository: Repository<QPointAccount>,
    @InjectRepository(FraudLog)
    private readonly fraudLogRepository: Repository<FraudLog>,
    @InjectRepository(BehaviorLog)
    private readonly behaviorLogRepository: Repository<BehaviorLog>,
    @InjectRepository(GeneralLedger)
    private readonly generalLedgerRepository: Repository<GeneralLedger>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepository: Repository<JournalEntry>,
    private readonly dataSource: DataSource,
    private readonly aiFraud: AIFraudService,
  ) {}

  /**
   * Resolve a QPointAccount by userId (entity owner lookup).
   * Used when the client does not supply an explicit accountId.
   */
  async getAccountByUserId(userId: string): Promise<QPointAccount> {
    // QPointAccount → entityId → EntityProfile (table: 'entities') → ownerId
    const account = await this.accountRepository
      .createQueryBuilder('account')
      .innerJoin('entities', 'entity', 'entity.id = account."entityId"')
      .where('entity."ownerId" = :userId', { userId })
      .getOne();

    if (!account) {
      throw new NotFoundException(`No QPoint account found for user ${userId}`);
    }
    return account;
  }

  /**
   * Resolve a QPointAccount directly by entityId.
   * Used by the QP charge pathway (merchant account lookup).
   */
  async getAccountByEntityId(entityId: string): Promise<QPointAccount> {
    const account = await this.accountRepository.findOne({ where: { entityId } });
    if (!account) {
      throw new NotFoundException(`No QPoint account found for entity ${entityId}`);
    }
    return account;
  }

  /**
   * Deposit Q-Points into an account
   */
  async deposit(
    dto: DepositQPointsDto,
    userId?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<QPointTransaction> {
    // Resolve accountId from JWT userId when not explicitly provided
    if (!dto.accountId && userId) {
      const account = await this.getAccountByUserId(userId);
      dto.accountId = account.id;
    }
    // Normalise description/paymentReference
    if (!dto.paymentReference && dto.description) {
      dto.paymentReference = dto.description;
    }

    this.logger.log(`Processing deposit of ${dto.amount} Q-Points to account ${dto.accountId}`);

    const account = await this.accountRepository.findOne({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    // Perform risk assessment
    const riskAssessment = await this.assessRisk({
      accountId: dto.accountId!,
      userId,
      amount: dto.amount,
      transactionType: TransactionType.DEPOSIT,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
    });

    // Log behavior
    await this.logBehavior({
      accountId: dto.accountId!,
      userId: account.entityId,
      behaviorType: BehaviorType.TRANSACTION_ATTEMPT,
      transactionId: null,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
      behaviorDetails: {
        type: TransactionType.DEPOSIT,
        amount: dto.amount,
        paymentReference: dto.paymentReference,
      },
      suspicious: riskAssessment.isFlagged,
      riskScore: riskAssessment.riskScore,
    });

    // Create transaction using database transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const balanceBefore = parseFloat(account.balance.toString());
      const balanceAfter = balanceBefore + dto.amount;

      // Generate unique reference
      const reference = this.generateTransactionReference(TransactionType.DEPOSIT);

      // Create transaction record
      const transaction = this.transactionRepository.create({
        sourceAccountId: null,
        destinationAccountId: dto.accountId,
        amount: dto.amount,
        type: TransactionType.DEPOSIT,
        status: riskAssessment.requiresApproval
          ? TransactionStatus.FLAGGED
          : TransactionStatus.COMPLETED,
        fee: 0,
        feeWaived: true,
        reference,
        balanceBefore,
        balanceAfter,
        initiatedBy: userId,
        description: `Deposit of ${dto.amount} Q-Points`,
        metadata: {
          ...dto.metadata,
          paymentReference: dto.paymentReference,
        },
        riskScore: riskAssessment.riskScore,
        riskLevel: riskAssessment.riskLevel,
        fraudFlag: riskAssessment.isFlagged,
        fraudReason: riskAssessment.flagReason,
        verified: !riskAssessment.requiresApproval,
        approved: !riskAssessment.requiresApproval,
        approvedAt: !riskAssessment.requiresApproval ? new Date() : null,
        approvedBy: !riskAssessment.requiresApproval ? userId : null,
        ipAddress,
        deviceFingerprint,
        geolocation: dto.metadata?.geolocation,
      });

      const savedTransaction = await queryRunner.manager.save(transaction);

      // If not flagged, update account balance
      if (!riskAssessment.requiresApproval) {
        account.balance = balanceAfter;
        await queryRunner.manager.save(account);

        // Create double-entry journal entries
        await this.createJournalEntries(
          queryRunner,
          savedTransaction,
          dto.amount,
          TransactionType.DEPOSIT,
        );
      }

      // Log fraud if flagged
      if (riskAssessment.isFlagged) {
        await this.logFraud(
          {
            transactionId: savedTransaction.id,
            accountId: dto.accountId!,
            fraudDetectionReason: this.determineFraudReason(riskAssessment),
            actionTaken: riskAssessment.requiresApproval
              ? FraudActionTaken.MANUAL_REVIEW
              : FraudActionTaken.FLAGGED,
            riskScore: riskAssessment.riskScore,
            detectionDetails: {
              flagReason: riskAssessment.flagReason,
              riskLevel: riskAssessment.riskLevel,
            },
            ipAddress,
            deviceFingerprint,
            geolocation: dto.metadata?.geolocation,
          },
          queryRunner,
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Deposit completed: ${reference}`);
      return savedTransaction;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Deposit failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Transfer Q-Points between accounts
   */
  async transfer(
    dto: TransferQPointsDto,
    userId?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<QPointTransaction> {
    // Resolve source account from JWT userId when not explicitly provided
    if (!dto.sourceAccountId && userId) {
      const srcAccount = await this.getAccountByUserId(userId);
      dto.sourceAccountId = srcAccount.id;
    }
    // Resolve destination account from toUserId when destinationAccountId not provided
    if (!dto.destinationAccountId && dto.toUserId) {
      const destAccount = await this.getAccountByUserId(dto.toUserId);
      dto.destinationAccountId = destAccount.id;
    }

    this.logger.log(
      `Processing transfer of ${dto.amount} Q-Points from ${dto.sourceAccountId} to ${dto.destinationAccountId}`,
    );

    // Fetch both accounts
    const sourceAccount = await this.accountRepository.findOne({
      where: { id: dto.sourceAccountId },
    });

    const destinationAccount = await this.accountRepository.findOne({
      where: { id: dto.destinationAccountId },
    });

    if (!sourceAccount) {
      throw new NotFoundException('Source account not found');
    }

    if (!destinationAccount) {
      throw new NotFoundException('Destination account not found');
    }

    // Check sufficient balance
    const sourceBalance = parseFloat(sourceAccount.balance.toString());
    const transferFee = this.calculateTransferFee(dto.amount);
    const totalRequired = dto.amount + transferFee;

    if (sourceBalance < totalRequired) {
      throw new BadRequestException('Insufficient balance');
    }

    // Perform risk assessment
    const riskAssessment = await this.assessRisk({
      accountId: dto.sourceAccountId!,
      userId,
      amount: dto.amount,
      transactionType: TransactionType.TRANSFER,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
    });

    // Log behavior
    await this.logBehavior({
      accountId: dto.sourceAccountId!,
      userId: sourceAccount.entityId,
      behaviorType: BehaviorType.TRANSACTION_ATTEMPT,
      transactionId: null,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
      behaviorDetails: {
        type: TransactionType.TRANSFER,
        amount: dto.amount,
        destinationAccountId: dto.destinationAccountId,
      },
      suspicious: riskAssessment.isFlagged,
      riskScore: riskAssessment.riskScore,
    });

    // Create transaction using database transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const reference = this.generateTransactionReference(TransactionType.TRANSFER);

      // Create transaction record
      const transaction = this.transactionRepository.create({
        sourceAccountId: dto.sourceAccountId,
        destinationAccountId: dto.destinationAccountId,
        amount: dto.amount,
        type: TransactionType.TRANSFER,
        status: riskAssessment.requiresApproval
          ? TransactionStatus.FLAGGED
          : TransactionStatus.COMPLETED,
        fee: transferFee,
        feeWaived: false,
        reference,
        balanceBefore: sourceBalance,
        balanceAfter: riskAssessment.requiresApproval
          ? sourceBalance
          : sourceBalance - totalRequired,
        initiatedBy: userId,
        description: dto.description || `Transfer of ${dto.amount} Q-Points`,
        metadata: {
          ...dto.metadata,
        },
        riskScore: riskAssessment.riskScore,
        riskLevel: riskAssessment.riskLevel,
        fraudFlag: riskAssessment.isFlagged,
        fraudReason: riskAssessment.flagReason,
        verified: !riskAssessment.requiresApproval,
        approved: !riskAssessment.requiresApproval,
        approvedAt: !riskAssessment.requiresApproval ? new Date() : null,
        approvedBy: !riskAssessment.requiresApproval ? userId : null,
        ipAddress,
        deviceFingerprint,
        geolocation: dto.metadata?.geolocation,
      });

      const savedTransaction = await queryRunner.manager.save(transaction);

      // If not flagged, update both account balances
      if (!riskAssessment.requiresApproval) {
        sourceAccount.balance = sourceBalance - totalRequired;
        destinationAccount.balance = parseFloat(destinationAccount.balance.toString()) + dto.amount;

        await queryRunner.manager.save(sourceAccount);
        await queryRunner.manager.save(destinationAccount);

        // Create double-entry journal entries
        await this.createJournalEntries(
          queryRunner,
          savedTransaction,
          dto.amount,
          TransactionType.TRANSFER,
          transferFee,
        );
      }

      // Log fraud if flagged
      if (riskAssessment.isFlagged) {
        await this.logFraud(
          {
            transactionId: savedTransaction.id,
            accountId: dto.sourceAccountId!,
            fraudDetectionReason: this.determineFraudReason(riskAssessment),
            actionTaken: riskAssessment.requiresApproval
              ? FraudActionTaken.MANUAL_REVIEW
              : FraudActionTaken.FLAGGED,
            riskScore: riskAssessment.riskScore,
            detectionDetails: {
              flagReason: riskAssessment.flagReason,
              riskLevel: riskAssessment.riskLevel,
              destinationAccountId: dto.destinationAccountId,
            },
            ipAddress,
            deviceFingerprint,
            geolocation: dto.metadata?.geolocation,
          },
          queryRunner,
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Transfer completed: ${reference}`);
      return savedTransaction;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Transfer failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Withdraw Q-Points from an account
   */
  async withdraw(
    dto: WithdrawQPointsDto,
    userId?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<QPointTransaction> {
    // Resolve accountId from JWT userId when not explicitly provided
    if (!dto.accountId && userId) {
      const account = await this.getAccountByUserId(userId);
      dto.accountId = account.id;
    }
    // Normalise destination/description
    if (!dto.destination && dto.description) {
      dto.destination = dto.description;
    }
    if (!dto.withdrawalMethod) {
      dto.withdrawalMethod = 'default';
    }

    this.logger.log(
      `Processing withdrawal of ${dto.amount} Q-Points from account ${dto.accountId}`,
    );

    const account = await this.accountRepository.findOne({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    // Check sufficient balance
    const accountBalance = parseFloat(account.balance.toString());
    const withdrawalFee = this.calculateWithdrawalFee(dto.amount);
    const totalRequired = dto.amount + withdrawalFee;

    if (accountBalance < totalRequired) {
      throw new BadRequestException('Insufficient balance');
    }

    // Perform risk assessment
    const riskAssessment = await this.assessRisk({
      accountId: dto.accountId!,
      userId,
      amount: dto.amount,
      transactionType: TransactionType.WITHDRAWAL,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
    });

    // Log behavior
    await this.logBehavior({
      accountId: dto.accountId!,
      userId: account.entityId,
      behaviorType: BehaviorType.TRANSACTION_ATTEMPT,
      transactionId: null,
      ipAddress,
      deviceFingerprint,
      geolocation: dto.metadata?.geolocation,
      behaviorDetails: {
        type: TransactionType.WITHDRAWAL,
        amount: dto.amount,
        withdrawalMethod: dto.withdrawalMethod,
        destination: dto.destination,
      },
      suspicious: riskAssessment.isFlagged,
      riskScore: riskAssessment.riskScore,
    });

    // Create transaction using database transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const reference = this.generateTransactionReference(TransactionType.WITHDRAWAL);

      // Create transaction record
      const transaction = this.transactionRepository.create({
        sourceAccountId: dto.accountId,
        destinationAccountId: null,
        amount: dto.amount,
        type: TransactionType.WITHDRAWAL,
        status: riskAssessment.requiresApproval
          ? TransactionStatus.FLAGGED
          : TransactionStatus.COMPLETED,
        fee: withdrawalFee,
        feeWaived: false,
        reference,
        balanceBefore: accountBalance,
        balanceAfter: riskAssessment.requiresApproval
          ? accountBalance
          : accountBalance - totalRequired,
        initiatedBy: userId,
        description: `Withdrawal of ${dto.amount} Q-Points`,
        metadata: {
          ...dto.metadata,
          withdrawalMethod: dto.withdrawalMethod,
          destination: dto.destination,
        },
        riskScore: riskAssessment.riskScore,
        riskLevel: riskAssessment.riskLevel,
        fraudFlag: riskAssessment.isFlagged,
        fraudReason: riskAssessment.flagReason,
        verified: !riskAssessment.requiresApproval,
        approved: !riskAssessment.requiresApproval,
        approvedAt: !riskAssessment.requiresApproval ? new Date() : null,
        approvedBy: !riskAssessment.requiresApproval ? userId : null,
        ipAddress,
        deviceFingerprint,
        geolocation: dto.metadata?.geolocation,
      });

      const savedTransaction = await queryRunner.manager.save(transaction);

      // If not flagged, update account balance
      if (!riskAssessment.requiresApproval) {
        account.balance = accountBalance - totalRequired;
        await queryRunner.manager.save(account);

        // Create double-entry journal entries
        await this.createJournalEntries(
          queryRunner,
          savedTransaction,
          dto.amount,
          TransactionType.WITHDRAWAL,
          withdrawalFee,
        );
      }

      // Log fraud if flagged
      if (riskAssessment.isFlagged) {
        await this.logFraud(
          {
            transactionId: savedTransaction.id,
            accountId: dto.accountId!,
            fraudDetectionReason: this.determineFraudReason(riskAssessment),
            actionTaken: riskAssessment.requiresApproval
              ? FraudActionTaken.MANUAL_REVIEW
              : FraudActionTaken.FLAGGED,
            riskScore: riskAssessment.riskScore,
            detectionDetails: {
              flagReason: riskAssessment.flagReason,
              riskLevel: riskAssessment.riskLevel,
              withdrawalMethod: dto.withdrawalMethod,
            },
            ipAddress,
            deviceFingerprint,
            geolocation: dto.metadata?.geolocation,
          },
          queryRunner,
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Withdrawal completed: ${reference}`);
      return savedTransaction;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Withdrawal failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Assess risk for a transaction
   */
  private async assessRisk(context: FraudCheckContext): Promise<RiskAssessmentResult> {
    let riskScore = 0;
    const flags: string[] = [];

    // Check 1: High value transaction
    if (context.amount >= this.HIGH_VALUE_THRESHOLD) {
      riskScore += 30;
      flags.push('High value transaction');
    }

    // Check 2: Daily velocity
    const dailyVolume = await this.getDailyTransactionVolume(context.accountId);
    if (dailyVolume >= this.DAILY_VELOCITY_THRESHOLD) {
      riskScore += 25;
      flags.push('High daily transaction volume');
    }

    // Check 3: Transaction frequency
    const dailyCount = await this.getDailyTransactionCount(context.accountId);
    if (dailyCount >= this.MAX_DAILY_TRANSACTIONS) {
      riskScore += 20;
      flags.push('Excessive daily transactions');
    }

    // Check 4: Rapid transactions
    const recentCount = await this.getRecentTransactionCount(
      context.accountId,
      this.RAPID_TRANSACTION_WINDOW_MINUTES,
    );
    if (recentCount >= this.MAX_TRANSACTIONS_IN_WINDOW) {
      riskScore += 25;
      flags.push('Rapid transaction pattern');
    }

    // Check 5: Device/Location anomaly
    if (context.deviceFingerprint) {
      const isNewDevice = await this.isNewDevice(context.accountId, context.deviceFingerprint);
      if (isNewDevice) {
        riskScore += 15;
        flags.push('New device detected');
      }
    }

    // Check 6: Failed transaction history
    const recentFailures = await this.getRecentFailedTransactions(context.accountId);
    if (recentFailures >= 3) {
      riskScore += 20;
      flags.push('Multiple recent failed transactions');
    }

    // Determine risk level
    let riskLevel: RiskLevel;

    // AI: blend ML fraud score with rule-based score (60% AI, 40% rules)
    let finalRiskScore = riskScore;
    try {
      const aiResult = this.aiFraud.scoreTransaction({
        userId: context.userId || context.accountId,
        amount: context.amount,
        currency: 'NGN',
        paymentMethod: String(context.transactionType),
      });
      finalRiskScore = Math.round(0.4 * riskScore + 0.6 * (aiResult.riskScore * 100));
      if (aiResult.reviewFlag && !flags.includes('AI review flag')) flags.push('AI review flag');
    } catch (aiErr) {
      this.logger.warn(`AI fraud score failed, using rule-based score: ${aiErr.message}`);
      finalRiskScore = riskScore;
    }

    if (finalRiskScore >= 75) {
      riskLevel = RiskLevel.CRITICAL;
    } else if (finalRiskScore >= 50) {
      riskLevel = RiskLevel.HIGH;
    } else if (finalRiskScore >= 25) {
      riskLevel = RiskLevel.MEDIUM;
    } else {
      riskLevel = RiskLevel.LOW;
    }

    return {
      riskScore: finalRiskScore,
      riskLevel,
      isFlagged: finalRiskScore >= 50,
      flagReason: flags.join('; '),
      requiresApproval: finalRiskScore >= 75,
    };
  }

  /**
   * Log behavior for monitoring
   */
  private async logBehavior(data: {
    accountId: string;
    userId: string;
    behaviorType: BehaviorType;
    transactionId: string | null;
    ipAddress?: string;
    deviceFingerprint?: string;
    geolocation?: Record<string, any>;
    behaviorDetails: Record<string, any>;
    suspicious: boolean;
    riskScore: number;
  }): Promise<void> {
    try {
      const log = this.behaviorLogRepository.create(data);
      await this.behaviorLogRepository.save(log);
    } catch (error) {
      this.logger.error('Failed to log behavior:', error);
    }
  }

  /**
   * Log fraud detection
   */
  private async logFraud(
    data: {
      transactionId: string;
      accountId: string;
      fraudDetectionReason: FraudDetectionReason;
      actionTaken: FraudActionTaken;
      riskScore: number;
      detectionDetails: Record<string, any>;
      ipAddress?: string;
      deviceFingerprint?: string;
      geolocation?: Record<string, any>;
    },
    queryRunner?: any,
  ): Promise<void> {
    try {
      const log = this.fraudLogRepository.create(data);
      if (queryRunner) {
        await queryRunner.manager.save(log);
      } else {
        await this.fraudLogRepository.save(log);
      }
    } catch (error) {
      this.logger.error('Failed to log fraud:', error);
    }
  }

  /**
   * Create double-entry journal entries
   */
  private async createJournalEntries(
    queryRunner: any,
    transaction: QPointTransaction,
    amount: number,
    type: TransactionType,
    fee: number = 0,
  ): Promise<void> {
    // For deposits: Debit Q-Points Asset, Credit Revenue
    // For transfers: Debit destination, Credit source
    // For withdrawals: Debit Expense, Credit Q-Points Asset

    const entries: Partial<JournalEntry>[] = [];

    if (type === TransactionType.DEPOSIT) {
      // Debit: Q-Points Asset Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: 'asset-qpoints', // This should be a real ledger account ID
        entryType: EntryType.DEBIT,
        amount,
        description: `Deposit to account ${transaction.destinationAccountId}`,
        createdBy: transaction.initiatedBy,
      });

      // Credit: Revenue Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: 'revenue-deposits',
        entryType: EntryType.CREDIT,
        amount,
        description: `Deposit from payment reference ${transaction.metadata?.paymentReference}`,
        createdBy: transaction.initiatedBy,
      });
    } else if (type === TransactionType.TRANSFER) {
      // Debit: Destination Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: transaction.destinationAccountId || undefined,
        entryType: EntryType.DEBIT,
        amount,
        description: `Transfer from ${transaction.sourceAccountId}`,
        createdBy: transaction.initiatedBy,
      });

      // Credit: Source Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: transaction.sourceAccountId || undefined,
        entryType: EntryType.CREDIT,
        amount,
        description: `Transfer to ${transaction.destinationAccountId}`,
        createdBy: transaction.initiatedBy,
      });

      // Fee entries if applicable
      if (fee > 0) {
        entries.push({
          transactionId: transaction.id,
          ledgerAccountId: transaction.sourceAccountId || undefined,
          entryType: EntryType.CREDIT,
          amount: fee,
          description: `Transfer fee`,
          createdBy: transaction.initiatedBy,
        });

        entries.push({
          transactionId: transaction.id,
          ledgerAccountId: 'revenue-fees',
          entryType: EntryType.DEBIT,
          amount: fee,
          description: `Transfer fee revenue`,
          createdBy: transaction.initiatedBy,
        });
      }
    } else if (type === TransactionType.WITHDRAWAL) {
      // Debit: Expense Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: 'expense-withdrawals',
        entryType: EntryType.DEBIT,
        amount,
        description: `Withdrawal from account ${transaction.sourceAccountId}`,
        createdBy: transaction.initiatedBy,
      });

      // Credit: Q-Points Asset Account
      entries.push({
        transactionId: transaction.id,
        ledgerAccountId: 'asset-qpoints',
        entryType: EntryType.CREDIT,
        amount,
        description: `Withdrawal to ${transaction.metadata?.destination}`,
        createdBy: transaction.initiatedBy,
      });

      // Fee entries if applicable
      if (fee > 0) {
        entries.push({
          transactionId: transaction.id,
          ledgerAccountId: transaction.sourceAccountId || undefined,
          entryType: EntryType.CREDIT,
          amount: fee,
          description: `Withdrawal fee`,
          createdBy: transaction.initiatedBy,
        });

        entries.push({
          transactionId: transaction.id,
          ledgerAccountId: 'revenue-fees',
          entryType: EntryType.DEBIT,
          amount: fee,
          description: `Withdrawal fee revenue`,
          createdBy: transaction.initiatedBy,
        });
      }
    }

    // Save all journal entries
    for (const entry of entries) {
      await queryRunner.manager.save(JournalEntry, entry);
    }
  }

  /**
   * Helper methods
   */
  private generateTransactionReference(type: TransactionType): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${type.substring(0, 3).toUpperCase()}-${timestamp}-${random}`;
  }

  private calculateTransferFee(amount: number): number {
    // 0.2% fee with minimum 0.10 and maximum 10.00
    const feePercent = amount * 0.002;
    return Math.min(Math.max(feePercent, 0.1), 10.0);
  }

  private calculateWithdrawalFee(amount: number): number {
    // 0.5% fee with minimum 0.50 and maximum 25.00
    const feePercent = amount * 0.005;
    return Math.min(Math.max(feePercent, 0.5), 25.0);
  }

  private async getDailyTransactionVolume(accountId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await this.transactionRepository
      .createQueryBuilder('txn')
      .select('COALESCE(SUM(txn.amount), 0)', 'total')
      .where('(txn.sourceAccountId = :accountId OR txn.destinationAccountId = :accountId)', {
        accountId,
      })
      .andWhere('txn.createdAt >= :startOfDay', { startOfDay })
      .andWhere('txn.status = :status', { status: TransactionStatus.COMPLETED })
      .getRawOne();

    return parseFloat(result.total || '0');
  }

  private async getDailyTransactionCount(accountId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return await this.transactionRepository
      .createQueryBuilder('txn')
      .where('(txn.sourceAccountId = :accountId OR txn.destinationAccountId = :accountId)', {
        accountId,
      })
      .andWhere('txn.createdAt >= :startOfDay', { startOfDay })
      .getCount();
  }

  private async getRecentTransactionCount(accountId: string, minutes: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);

    return await this.transactionRepository
      .createQueryBuilder('txn')
      .where('(txn.sourceAccountId = :accountId OR txn.destinationAccountId = :accountId)', {
        accountId,
      })
      .andWhere('txn.createdAt >= :cutoffTime', { cutoffTime })
      .getCount();
  }

  private async isNewDevice(accountId: string, deviceFingerprint: string): Promise<boolean> {
    const count = await this.transactionRepository
      .createQueryBuilder('txn')
      .where('(txn.sourceAccountId = :accountId OR txn.destinationAccountId = :accountId)', {
        accountId,
      })
      .andWhere('txn.deviceFingerprint = :deviceFingerprint', { deviceFingerprint })
      .getCount();

    return count === 0;
  }

  private async getRecentFailedTransactions(accountId: string): Promise<number> {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return await this.transactionRepository
      .createQueryBuilder('txn')
      .where('(txn.sourceAccountId = :accountId OR txn.destinationAccountId = :accountId)', {
        accountId,
      })
      .andWhere('txn.status = :status', { status: TransactionStatus.FAILED })
      .andWhere('txn.createdAt >= :last24Hours', { last24Hours })
      .getCount();
  }

  private determineFraudReason(riskAssessment: RiskAssessmentResult): FraudDetectionReason {
    const reason = riskAssessment.flagReason || '';

    if (reason.includes('High value')) return FraudDetectionReason.UNUSUAL_AMOUNT;
    if (reason.includes('High daily')) return FraudDetectionReason.HIGH_VELOCITY;
    if (reason.includes('Excessive daily')) return FraudDetectionReason.UNUSUAL_FREQUENCY;
    if (reason.includes('Rapid transaction')) return FraudDetectionReason.HIGH_VELOCITY;
    if (reason.includes('New device')) return FraudDetectionReason.DEVICE_MISMATCH;
    if (reason.includes('failed')) return FraudDetectionReason.MULTIPLE_FAILURES;

    return FraudDetectionReason.SUSPICIOUS_BEHAVIOR;
  }

  /**
   * Get transactions with filters
   */
  async getTransactions(dto: GetTransactionsDto): Promise<QPointTransaction[]> {
    const baseConditions: FindOptionsWhere<QPointTransaction> = {};

    if (dto.status) baseConditions.status = dto.status;
    if (dto.type) baseConditions.type = dto.type;
    if (dto.riskLevel) baseConditions.riskLevel = dto.riskLevel;
    if (dto.flaggedOnly) baseConditions.fraudFlag = true;

    const where: FindOptionsWhere<QPointTransaction>[] | FindOptionsWhere<QPointTransaction> =
      dto.accountId
        ? [
            { ...baseConditions, sourceAccountId: dto.accountId },
            { ...baseConditions, destinationAccountId: dto.accountId },
          ]
        : baseConditions;

    return await this.transactionRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Review a flagged transaction
   */
  async reviewFlaggedTransaction(
    dto: ReviewFraudDto,
    reviewerId: string,
  ): Promise<QPointTransaction> {
    const transaction = await this.transactionRepository.findOne({
      where: { id: dto.transactionId },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (!transaction.fraudFlag) {
      throw new BadRequestException('Transaction is not flagged');
    }

    if (transaction.status !== TransactionStatus.FLAGGED) {
      throw new BadRequestException('Transaction is not in flagged status');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update transaction
      transaction.approved = dto.approved;
      transaction.approvedAt = new Date();
      transaction.approvedBy = reviewerId;

      if (dto.approved) {
        // Approve and process the transaction
        transaction.status = TransactionStatus.COMPLETED;
        transaction.verified = true;

        // Update account balances based on transaction type
        if (transaction.type === TransactionType.DEPOSIT && transaction.destinationAccountId) {
          const account = await queryRunner.manager.findOne(QPointAccount, {
            where: { id: transaction.destinationAccountId },
          });
          if (account) {
            account.balance = parseFloat(account.balance.toString()) + transaction.amount;
            await queryRunner.manager.save(account);
          }
        } else if (transaction.type === TransactionType.TRANSFER) {
          if (transaction.sourceAccountId && transaction.destinationAccountId) {
            const sourceAccount = await queryRunner.manager.findOne(QPointAccount, {
              where: { id: transaction.sourceAccountId },
            });
            const destAccount = await queryRunner.manager.findOne(QPointAccount, {
              where: { id: transaction.destinationAccountId },
            });

            if (sourceAccount && destAccount) {
              const totalDeduction = transaction.amount + transaction.fee;
              sourceAccount.balance = parseFloat(sourceAccount.balance.toString()) - totalDeduction;
              destAccount.balance = parseFloat(destAccount.balance.toString()) + transaction.amount;

              await queryRunner.manager.save(sourceAccount);
              await queryRunner.manager.save(destAccount);
            }
          }
        } else if (transaction.type === TransactionType.WITHDRAWAL && transaction.sourceAccountId) {
          const account = await queryRunner.manager.findOne(QPointAccount, {
            where: { id: transaction.sourceAccountId },
          });
          if (account) {
            const totalDeduction = transaction.amount + transaction.fee;
            account.balance = parseFloat(account.balance.toString()) - totalDeduction;
            await queryRunner.manager.save(account);
          }
        }

        // Create journal entries
        await this.createJournalEntries(
          queryRunner,
          transaction,
          transaction.amount,
          transaction.type,
          transaction.fee,
        );
      } else {
        // Reject the transaction
        transaction.status = TransactionStatus.FAILED;
        transaction.fraudFlag = false;
      }

      await queryRunner.manager.save(transaction);

      // Update fraud log
      const fraudLog = await queryRunner.manager.findOne(FraudLog, {
        where: { transactionId: transaction.id },
      });

      if (fraudLog) {
        fraudLog.actionTaken = dto.approved
          ? FraudActionTaken.VERIFIED
          : FraudActionTaken.FALSE_POSITIVE;
        fraudLog.reviewedBy = reviewerId;
        fraudLog.reviewedAt = new Date();
        fraudLog.reviewNotes = dto.reviewNotes || null;
        await queryRunner.manager.save(fraudLog);
      }

      await queryRunner.commitTransaction();
      this.logger.log(
        `Transaction ${transaction.id} reviewed: ${dto.approved ? 'Approved' : 'Rejected'}`,
      );
      return transaction;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to review transaction:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
