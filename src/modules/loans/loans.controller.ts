import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FiLicenseGuard } from '../auth/guards/fi-license.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';
import { LoansService } from './loans.service';
import { ApplyLoanDto, ApproveLoanDto, RepayLoanDto } from './dto/loans.dto';

@ApiTags('loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  /** Any authenticated user can apply for a loan. */
  @Post('apply')
  @ApiOperation({ summary: 'User applies for a loan from a specific FI' })
  @HttpCode(HttpStatus.CREATED)
  async apply(@CurrentUser() user: User, @Body() dto: ApplyLoanDto) {
    return this.loansService.requestLoan(user.id, dto);
  }

  @Get('applications')
  @ApiOperation({ summary: 'Get loan applications for current user or FI entity' })
  async getApplications(@CurrentUser() user: User) {
    return this.loansService.getApplications(user.id);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Get competing loan offers from all verified FIs' })
  @ApiQuery({ name: 'amount', type: Number })
  @ApiQuery({ name: 'purpose', type: String })
  async getOffers(
    @CurrentUser() user: User,
    @Query('amount') amount: string,
    @Query('purpose') purpose: string,
  ) {
    return this.loansService.getLoanOffers(user.id, parseFloat(amount), purpose);
  }

  /**
   * FI Loan Officers and FI owners approve loans.
   * FiLicenseGuard ensures the FI entity has a verified regulatory license.
   */
  @Patch(':id/approve')
  @UseGuards(RolesGuard, FiLicenseGuard)
  @Roles(UserRole.FINANCIAL_INSTITUTION, UserRole.FI_LOAN_OFFICER, UserRole.ADMIN)
  @ApiOperation({ summary: 'FI Loan Officer approves a pending loan application' })
  async approve(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveLoanDto,
  ) {
    return this.loansService.approveLoan(id, user.id, dto);
  }

  /**
   * FI Loan Officers and FI owners reject loans.
   * FiLicenseGuard ensures the FI entity has a verified regulatory license.
   */
  @Patch(':id/reject')
  @UseGuards(RolesGuard, FiLicenseGuard)
  @Roles(UserRole.FINANCIAL_INSTITUTION, UserRole.FI_LOAN_OFFICER, UserRole.ADMIN)
  @ApiOperation({ summary: 'FI Loan Officer rejects a pending loan application' })
  async reject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notes?: string },
  ) {
    return this.loansService.rejectLoan(id, user.id, body.notes);
  }

  /** Any authenticated user can make a manual repayment. */
  @Post(':id/repay')
  @ApiOperation({ summary: 'Manually repay an active loan' })
  @HttpCode(HttpStatus.OK)
  async repay(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepayLoanDto,
  ) {
    return this.loansService.repayLoan(id, user.id, dto, false);
  }
}
