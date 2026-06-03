import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, QpChargeDto } from './dto/create-payment.dto';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Process a payment' })
  async processPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: User,
  ) {
    return this.paymentsService.processPayment({ ...dto, userId: user.id });
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a completed payment (owner only)' })
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    // Ownership check: verify the payment belongs to the requesting user.
    const payment = await this.paymentsService.getPayment(id);
    if (payment.userId !== user.id) {
      throw new ForbiddenException('You can only refund your own payments');
    }
    return this.paymentsService.refundPayment(id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get payment history for current user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getPaymentHistory(
    @CurrentUser() user: User,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.paymentsService.getPaymentHistory(user.id, { limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific payment (owner only)' })
  async getPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    const payment = await this.paymentsService.getPayment(id);
    if (payment.userId !== user.id) {
      throw new ForbiddenException('You can only view your own payments');
    }
    return payment;
  }

  // ── Pathway 1: Q-Points Charge ─────────────────────────────────────────
  @Post('qp/charge')
  @ApiOperation({ summary: 'Pathway 1 — Charge Q-Points from a customer to a merchant (zero-commission)' })
  async chargeQp(@Body() dto: QpChargeDto) {
    return this.paymentsService.chargeQp(dto);
  }
}
