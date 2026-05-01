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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LoansService } from './loans.service';
import { ApplyLoanDto, ApproveLoanDto, RepayLoanDto } from './dto/loans.dto';

@ApiTags('loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post('apply')
  @ApiOperation({ summary: 'User applies for a loan from a specific FI' })
  @HttpCode(HttpStatus.CREATED)
  async apply(@CurrentUser() user: any, @Body() dto: ApplyLoanDto) {
    return this.loansService.requestLoan(user.id, dto);
  }

  @Get('applications')
  @ApiOperation({ summary: 'Get loan applications for current user or FI entity' })
  async getApplications(@CurrentUser() user: any) {
    return this.loansService.getApplications(user.id);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Get competing loan offers from all verified FIs' })
  @ApiQuery({ name: 'amount', type: Number })
  @ApiQuery({ name: 'purpose', type: String })
  async getOffers(
    @CurrentUser() user: any,
    @Query('amount') amount: string,
    @Query('purpose') purpose: string,
  ) {
    return this.loansService.getLoanOffers(user.id, parseFloat(amount), purpose);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'FI Loan Officer approves a pending loan application' })
  async approve(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveLoanDto,
  ) {
    return this.loansService.approveLoan(id, user.id, dto);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'FI Loan Officer rejects a pending loan application' })
  async reject(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notes?: string },
  ) {
    return this.loansService.rejectLoan(id, user.id, body.notes);
  }

  @Post(':id/repay')
  @ApiOperation({ summary: 'Manually repay an active loan' })
  @HttpCode(HttpStatus.OK)
  async repay(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepayLoanDto,
  ) {
    return this.loansService.repayLoan(id, user.id, dto, false);
  }
}
