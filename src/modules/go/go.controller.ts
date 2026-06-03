import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { GoService } from './go.service';
import { GoTransactionCategory, GoTransactionType } from './entities/go-transaction.entity';

export class TopUpDto {
  @ApiProperty({ example: 500.0 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ example: 'Bank transfer top-up', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

@ApiTags('go')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('go')
export class GoController {
  constructor(private readonly goService: GoService) {}

  @Get('wallet')
  @ApiOperation({ summary: 'Get wallet summary with total in/out' })
  async getWalletSummary(@CurrentUser() user: User) {
    return this.goService.getWalletSummary(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiQuery({ name: 'type', required: false, enum: GoTransactionType })
  @ApiQuery({ name: 'category', required: false, enum: GoTransactionCategory })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getTransactions(
    @CurrentUser() user: User,
    @Query('type') type?: GoTransactionType,
    @Query('category') category?: GoTransactionCategory,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.goService.getTransactions(user.id, { type, category, limit, offset });
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a specific transaction' })
  async getTransaction(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.goService.getTransaction(id, user.id);
  }

  @Post('topup')
  @ApiOperation({ summary: 'Top up wallet balance' })
  async topUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    return this.goService.topUp(user.id, dto.amount, dto.description ?? 'Wallet top-up');
  }
}
