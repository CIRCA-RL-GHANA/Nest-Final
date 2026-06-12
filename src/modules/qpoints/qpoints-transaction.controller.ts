import { Controller, Post, Body, Req, Get, Query, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { QPointsTransactionService } from './qpoints-transaction.service';
import { DepositQPointsDto } from './dto/deposit-qpoints.dto';
import { TransferQPointsDto } from './dto/transfer-qpoints.dto';
import { WithdrawQPointsDto } from './dto/withdraw-qpoints.dto';
import { GetTransactionsDto } from './dto/get-transactions.dto';
import { ReviewFraudDto } from './dto/review-fraud.dto';
import { QPointTransaction } from './entities/qpoint-transaction.entity';

@ApiTags('Q-Points Transactions')
@Controller('qpoints/transactions')
export class QPointsTransactionController {
  constructor(private readonly transactionService: QPointsTransactionService) {}

  @Post('deposit')
  @ApiOperation({ summary: 'Deposit Q-Points into an account' })
  @ApiResponse({ status: 201, description: 'Deposit successful', type: QPointTransaction })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async deposit(
    @Body() depositDto: DepositQPointsDto,
    @Req() req: Request,
  ): Promise<QPointTransaction> {
    const userId = (req as any).user?.id;
    const ipAddress = req.ip;
    const deviceFingerprint = req.headers['x-device-fingerprint'] as string;

    return await this.transactionService.deposit(depositDto, userId, ipAddress, deviceFingerprint);
  }

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer Q-Points between accounts' })
  @ApiResponse({ status: 201, description: 'Transfer successful', type: QPointTransaction })
  @ApiResponse({ status: 400, description: 'Invalid request or insufficient balance' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async transfer(
    @Body() transferDto: TransferQPointsDto,
    @Req() req: Request,
  ): Promise<QPointTransaction> {
    const userId = (req as any).user?.id;
    const ipAddress = req.ip;
    const deviceFingerprint = req.headers['x-device-fingerprint'] as string;

    return await this.transactionService.transfer(
      transferDto,
      userId,
      ipAddress,
      deviceFingerprint,
    );
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Withdraw Q-Points from an account' })
  @ApiResponse({ status: 201, description: 'Withdrawal successful', type: QPointTransaction })
  @ApiResponse({ status: 400, description: 'Invalid request or insufficient balance' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async withdraw(
    @Body() withdrawDto: WithdrawQPointsDto,
    @Req() req: Request,
  ): Promise<QPointTransaction> {
    const userId = (req as any).user?.id;
    const ipAddress = req.ip;
    const deviceFingerprint = req.headers['x-device-fingerprint'] as string;

    return await this.transactionService.withdraw(
      withdrawDto,
      userId,
      ipAddress,
      deviceFingerprint,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get transactions with optional filters' })
  @ApiResponse({ status: 200, description: 'Transactions retrieved', type: [QPointTransaction] })
  async getTransactions(@Query() query: GetTransactionsDto): Promise<QPointTransaction[]> {
    return await this.transactionService.getTransactions(query);
  }

  @Put('review-fraud')
  @ApiOperation({ summary: 'Review a flagged transaction' })
  @ApiResponse({ status: 200, description: 'Transaction reviewed', type: QPointTransaction })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async reviewFraud(
    @Body() reviewDto: ReviewFraudDto,
    @Req() req: Request,
  ): Promise<QPointTransaction> {
    const reviewerId = (req as any).user?.id || 'system';
    return await this.transactionService.reviewFlaggedTransaction(reviewDto, reviewerId);
  }
}
