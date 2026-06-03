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
import { RolesGuard } from '../auth/guards/roles.guard';
import { FiLicenseGuard } from '../auth/guards/fi-license.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';
import { InsuranceService } from './insurance.service';
import { PurchasePolicyDto, FileClaimDto, ReviewClaimDto } from './dto/insurance.dto';

@ApiTags('insurance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('insurance')
export class InsuranceController {
  constructor(private readonly insuranceService: InsuranceService) {}

  /** Any authenticated user can purchase a policy. */
  @Post('policies')
  @ApiOperation({ summary: 'Purchase an insurance policy from a verified FI' })
  @HttpCode(HttpStatus.CREATED)
  async purchasePolicy(@CurrentUser() user: User, @Body() dto: PurchasePolicyDto) {
    return this.insuranceService.purchasePolicy(user.id, dto);
  }

  @Get('policies')
  @ApiOperation({ summary: 'Get all insurance policies for current user or FI entity' })
  async getPolicies(@CurrentUser() user: User) {
    return this.insuranceService.getPolicies(user.id);
  }

  /** Any authenticated user can file a claim. */
  @Post('claims')
  @ApiOperation({ summary: 'File an insurance claim against an active policy' })
  @HttpCode(HttpStatus.CREATED)
  async fileClaim(
    @CurrentUser() user: User,
    @Body() body: { policyId: string } & FileClaimDto,
  ) {
    const { policyId, ...dto } = body;
    return this.insuranceService.fileClaim(policyId, user.id, dto);
  }

  @Get('claims')
  @ApiOperation({ summary: 'Get all claims filed by current user' })
  async getClaims(@CurrentUser() user: User) {
    return this.insuranceService.getClaims(user.id);
  }

  /**
   * FI admin reviews (approve/reject) a claim — requires verified FI license.
   */
  @Patch('claims/:id')
  @UseGuards(RolesGuard, FiLicenseGuard)
  @Roles(UserRole.FINANCIAL_INSTITUTION, UserRole.FI_TELLER, UserRole.ADMIN)
  @ApiOperation({ summary: 'FI Admin approves or rejects a claim, triggering QP payout on approval' })
  async reviewClaim(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewClaimDto,
  ) {
    return this.insuranceService.reviewClaim(id, user.id, dto);
  }
}
