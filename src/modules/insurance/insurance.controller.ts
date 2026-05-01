import {
  Controller,
  Post,
  Get,
  Patch,
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
import { InsuranceService } from './insurance.service';
import { PurchasePolicyDto, FileClaimDto, ReviewClaimDto } from './dto/insurance.dto';

@ApiTags('insurance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/insurance')
export class InsuranceController {
  constructor(private readonly insuranceService: InsuranceService) {}

  @Post('policies')
  @ApiOperation({ summary: 'Purchase an insurance policy from a verified FI' })
  @HttpCode(HttpStatus.CREATED)
  async purchasePolicy(@CurrentUser() user: any, @Body() dto: PurchasePolicyDto) {
    return this.insuranceService.purchasePolicy(user.id, dto);
  }

  @Get('policies')
  @ApiOperation({ summary: 'Get all insurance policies for current user or FI entity' })
  async getPolicies(@CurrentUser() user: any) {
    return this.insuranceService.getPolicies(user.id);
  }

  @Post('claims')
  @ApiOperation({ summary: 'File an insurance claim against an active policy' })
  @HttpCode(HttpStatus.CREATED)
  async fileClaim(
    @CurrentUser() user: any,
    @Body() body: { policyId: string } & FileClaimDto,
  ) {
    const { policyId, ...dto } = body;
    return this.insuranceService.fileClaim(policyId, user.id, dto);
  }

  @Get('claims')
  @ApiOperation({ summary: 'Get all claims filed by current user' })
  async getClaims(@CurrentUser() user: any) {
    return this.insuranceService.getClaims(user.id);
  }

  @Patch('claims/:id')
  @ApiOperation({ summary: 'FI Admin approves or rejects a claim, triggering QP payout on approval' })
  async reviewClaim(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewClaimDto,
  ) {
    return this.insuranceService.reviewClaim(id, user.id, dto);
  }
}
