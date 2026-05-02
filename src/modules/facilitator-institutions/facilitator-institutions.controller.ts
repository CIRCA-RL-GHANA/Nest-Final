import {
  Controller,
  Post,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FacilitatorInstitutionsService } from './facilitator-institutions.service';
import { OnboardInstitutionDto, IssueQpDto, InitiateSettlementDto } from './dto/institution.dto';

@ApiTags('facilitator-institutions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1')
export class FacilitatorInstitutionsController {
  constructor(private readonly svc: FacilitatorInstitutionsService) {}

  // ── Pathway 5 — Onboard ──────────────────────────────────────────────────

  @Post('facilitator/institutions/onboard')
  @ApiOperation({ summary: 'Onboard an enterprise as an institutional facilitator' })
  onboard(@Body() dto: OnboardInstitutionDto) {
    return this.svc.onboard(dto);
  }

  @Patch('facilitator/institutions/:entityId/approve')
  @ApiOperation({ summary: '(Admin) Approve an institutional facilitator after KYB' })
  approve(@Param('entityId') entityId: string) {
    return this.svc.approve(entityId);
  }

  // ── Pathway 5 — Issue QP ─────────────────────────────────────────────────

  @Post('facilitator/institutions/issue')
  @ApiOperation({ summary: 'Mint Q-Points up to the institution\'s approved cap' })
  issue(@Body() dto: IssueQpDto) {
    return this.svc.issue(dto);
  }

  // ── Pathway 5 — Get balance ───────────────────────────────────────────────

  @Get('facilitator/institutions/balance')
  @ApiOperation({ summary: 'Get QP balance, minted supply, and cap for an institution' })
  getBalance(@Body('entityId') entityId: string) {
    return this.svc.getBalance(entityId);
  }

  @Get('facilitator/institutions/:entityId/balance')
  @ApiOperation({ summary: 'Get balance by entity ID path param' })
  getBalanceByParam(@Param('entityId') entityId: string) {
    return this.svc.getBalance(entityId);
  }

  // ── Pathway 5 — Net-settlement ────────────────────────────────────────────

  @Post('qpoints/settlement/initiate')
  @ApiOperation({ summary: 'Net-settle QP obligations between two enterprise entities' })
  initiateSettlement(@Body() dto: InitiateSettlementDto) {
    return this.svc.initiateSettlement(dto);
  }
}
