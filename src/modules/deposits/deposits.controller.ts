import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Post()
  @ApiOperation({ summary: 'Lock Q-Points as a term deposit with a verified FI' })
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: any, @Body() dto: CreateDepositDto) {
    return this.depositsService.createDeposit(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all deposits for current user or FI entity' })
  async getDeposits(@CurrentUser() user: any) {
    return this.depositsService.getDeposits(user.id);
  }

  @Post(':id/mature')
  @ApiOperation({ summary: 'Trigger maturity payout for a deposit (FI admin or system)' })
  @HttpCode(HttpStatus.OK)
  async mature(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.depositsService.matureDeposit(id, user.id);
  }
}
