import {
  Controller, Post, Get, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AgenticConciergeService } from './agentic-concierge.service';
import { CreateSessionDto, SendMessageDto, UpdateSessionContextDto } from './dto/concierge.dto';

/** Enterprise and FI users access AI concierge; viewers may open sessions but not configure them. */
@ApiTags('agentic-concierge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.ENTERPRISE_ADMIN,
  UserRole.ENTERPRISE_OPERATOR,
  UserRole.ENTERPRISE_VIEWER,
  UserRole.FINANCIAL_INSTITUTION,
  UserRole.FI_LOAN_OFFICER,
  UserRole.FI_TELLER,
  UserRole.FI_AUDITOR,
  UserRole.ADMIN,
)
@Controller('api/v1/concierge')
export class AgenticConciergeController {
  constructor(private readonly conciergeService: AgenticConciergeService) {}

  // ─── Sessions ─────────────────────────────────────────────────────────────

  @Post('sessions')
  @ApiOperation({ summary: 'Open a new AI concierge session for an enterprise end-user' })
  @HttpCode(HttpStatus.CREATED)
  createSession(@Body() dto: CreateSessionDto) {
    return this.conciergeService.createSession(dto);
  }

  @Get('sessions/:entityId')
  @ApiOperation({ summary: 'List concierge sessions for an enterprise' })
  listSessions(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.conciergeService.listSessions(entityId);
  }

  @Delete('sessions/:sessionId')
  @ApiOperation({ summary: 'Close a concierge session' })
  closeSession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.conciergeService.closeSession(sessionId);
  }

  @Patch('sessions/:sessionId/context')
  @ApiOperation({ summary: 'Update shared context for a session (user profile, cart, etc.)' })
  updateContext(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateSessionContextDto,
  ) {
    return this.conciergeService.updateContext(sessionId, dto);
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  @Post('sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Send a message to the AI concierge and get a reply' })
  sendMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.conciergeService.sendMessage(sessionId, dto);
  }

  @Get('sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Get full message history for a session' })
  getHistory(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.conciergeService.getHistory(sessionId);
  }
}
