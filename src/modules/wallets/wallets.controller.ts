import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get current user wallet balance' })
  async getBalance(@CurrentUser() user: User) {
    return this.walletsService.getBalance(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user wallet details' })
  async getWallet(@CurrentUser() user: User) {
    return this.walletsService.getWallet(user.id);
  }
}
