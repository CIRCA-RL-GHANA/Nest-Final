import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreditDataService } from './credit-data.service';

class RequestCreditScoreDto {
  @ApiProperty()
  @IsUUID()
  subjectUserId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  consentId?: string;
}

class SubscribeCreditDataDto {
  @ApiProperty({ enum: ['basic', 'professional', 'enterprise'] })
  @IsEnum(['basic', 'professional', 'enterprise'])
  planTier: 'basic' | 'professional' | 'enterprise';
}

@ApiTags('credit-data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/credit-data')
export class CreditDataController {
  constructor(private readonly creditDataService: CreditDataService) {}

  @Post('score')
  @ApiOperation({ summary: 'FI requests a credit score for a platform user (requires consent)' })
  @HttpCode(HttpStatus.OK)
  async requestScore(@CurrentUser() user: any, @Body() dto: RequestCreditScoreDto) {
    return this.creditDataService.requestCreditScore(user.id, dto.subjectUserId, dto.consentId);
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'FI subscribes to a credit data plan tier' })
  @HttpCode(HttpStatus.OK)
  async subscribe(@CurrentUser() user: any, @Body() dto: SubscribeCreditDataDto) {
    return this.creditDataService.subscribeToCreditData(user.id, dto.planTier);
  }
}
