import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  async processPayment(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.processPayment(dto);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a completed payment' })
  async refundPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.refundPayment(id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get payment history for current user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getPaymentHistory(
    @Request() req: any,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.paymentsService.getPaymentHistory(req.user.id, { limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific payment' })
  async getPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getPayment(id);
  }

  // ── Pathway 1: Q-Points Charge ─────────────────────────────────────────
  @Post('qp/charge')
  @ApiOperation({ summary: 'Pathway 1 — Charge Q-Points from a customer to a merchant (zero-commission)' })
  async chargeQp(@Body() dto: QpChargeDto) {
    return this.paymentsService.chargeQp(dto);
  }
}
