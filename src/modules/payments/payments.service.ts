import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { WalletsService } from '../wallets/wallets.service';
import { CreatePaymentDto, QpChargeDto } from './dto/create-payment.dto';
import { AIFraudService } from '../ai/services/ai-fraud.service';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly walletsService: WalletsService,
    private readonly aiFraud: AIFraudService,
    private readonly qpTx: QPointsTransactionService,
    private readonly dataSource: DataSource,
  ) {}

  async processPayment(userId: string, dto: CreatePaymentDto): Promise<Payment> {
    // AI fraud pre-check — use async version so TF-blended score is included
    const fraudResult = await this.aiFraud.scoreTransactionAsync({
      userId,
      amount: dto.amount,
      currency: dto.currency ?? 'NGN',
      paymentMethod: dto.paymentMethod,
    });
    if (fraudResult.blocked) {
      this.logger.warn(
        `Payment blocked by AI fraud check for user ${userId}: ${fraudResult.reason}`,
      );
      throw new BadRequestException(`Transaction blocked: ${fraudResult.reason}`);
    }
    if (fraudResult.reviewFlag) {
      this.logger.warn(`Payment flagged for review (user ${userId}): ${fraudResult.reason}`);
    }

    // ISSUE-06: use a QueryRunner so the payment record creation and final
    // status update are atomic — prevents a COMPLETED status without a saved record
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let savedId: string;
    try {
      const payment = qr.manager.create(Payment, {
        userId,
        orderId: dto.orderId ?? null,
        rideId: dto.rideId ?? null,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        paymentMethod: dto.paymentMethod,
        status: PaymentStatus.PENDING,
      });
      const saved = await qr.manager.save(payment);
      savedId = saved.id;

      await this.walletsService.deductBalance(userId, dto.amount);

      await qr.manager.update(Payment, savedId, { status: PaymentStatus.COMPLETED });
      await qr.commitTransaction();

      this.logger.log(`Payment ${savedId} completed for user ${userId}`);
      return { ...saved, status: PaymentStatus.COMPLETED };
    } catch (error) {
      await qr.rollbackTransaction();
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Payment failed for user ${userId}: ${msg}`);
      throw new BadRequestException(`Payment failed: ${msg}`);
    } finally {
      await qr.release();
    }
  }

  async refundPayment(paymentId: string): Promise<Payment> {
    // ISSUE-B: use QueryRunner so wallet credit and status update are atomic
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const payment = await qr.manager.findOne(Payment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) {
        throw new NotFoundException(`Payment ${paymentId} not found`);
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new BadRequestException(`Only completed payments can be refunded`);
      }

      await this.walletsService.addBalance(payment.userId, Number(payment.amount));
      await qr.manager.update(Payment, paymentId, { status: PaymentStatus.REFUNDED });
      await qr.commitTransaction();

      this.logger.log(
        `Payment ${paymentId} refunded — ${payment.amount} returned to user ${payment.userId}`,
      );

      return { ...payment, status: PaymentStatus.REFUNDED };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async getPaymentHistory(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: options?.limit ?? 20,
      skip: options?.offset ?? 0,
    });
  }

  async getPayment(paymentId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });

    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    return payment;
  }

  // ─── Pathway 1: QP Charge ────────────────────────────────────────────────
  // Deduct Q-Points from a customer and credit the merchant entity.
  // Zero-commission; optional 0.02 QP trade fee if perTxFeeQp > 0.

  async chargeQp(dto: QpChargeDto): Promise<{
    transactionId: string;
    status: string;
    settledAt: string;
    qpAmount: number;
    feeQp: number;
    merchantQpReceived: number;
  }> {
    // Resolve customer's QP account via userId
    const customerAccount = await this.qpTx.getAccountByUserId(dto.customerId);
    if (!customerAccount) {
      throw new NotFoundException(`No QP account found for customer ${dto.customerId}`);
    }

    // Resolve merchant's QP account via entityId
    const merchantAccount = await this.qpTx.getAccountByEntityId(dto.merchantEntityId);
    if (!merchantAccount) {
      throw new NotFoundException(`No QP account found for merchant entity ${dto.merchantEntityId}`);
    }

    const feeQp = 0; // zero-commission by default; enterprise settings may apply 0.02
    const merchantReceives = dto.amount - feeQp;

    // Use the existing transfer service: source = customer, dest = merchant
    const tx = await this.qpTx.transfer(
      {
        sourceAccountId: customerAccount.id,
        destinationAccountId: merchantAccount.id,
        amount: dto.amount,
        description: `QP charge for order ${dto.orderReference ?? 'external'}`,
        metadata: {
          source: 'qp_charge',
          orderReference: dto.orderReference,
          merchantEntityId: dto.merchantEntityId,
          ...(dto.metadata ?? {}),
        },
      },
      dto.customerId,
    );

    this.logger.log(
      `QP charge: ${dto.amount} QP from customer ${dto.customerId} to merchant ${dto.merchantEntityId}, tx ${tx.id}`,
    );

    return {
      transactionId: tx.id,
      status: 'completed',
      settledAt: new Date().toISOString(),
      qpAmount: dto.amount,
      feeQp,
      merchantQpReceived: merchantReceives,
    };
  }
}

