import {
  Controller, Post, Get, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EnterpriseService } from './enterprise.service';
import {
  RegisterEnterpriseDto,
  UpdateEnterpriseSettingsDto,
  VerifyEnterpriseDto,
  CreateApiKeyDto,
} from './dto/enterprise.dto';

@ApiTags('enterprise')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/enterprise')
export class EnterpriseController {
  constructor(private readonly enterpriseService: EnterpriseService) {}

  // ─── Registration ─────────────────────────────────────────────────────────

  @Post('register')
  @ApiOperation({ summary: 'Onboard a new enterprise entity onto the platform' })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterEnterpriseDto) {
    return this.enterpriseService.register(dto);
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List all enterprise profiles (admin)' })
  list() {
    return this.enterpriseService.listProfiles();
  }

  @Get('profiles/:entityId')
  @ApiOperation({ summary: 'Get enterprise profile by entity ID' })
  getProfile(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.enterpriseService.getProfile(entityId);
  }

  @Patch('profiles/:entityId/settings')
  @ApiOperation({ summary: 'Update enterprise webhook, settings, and pathways' })
  updateSettings(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: UpdateEnterpriseSettingsDto,
  ) {
    return this.enterpriseService.updateSettings(entityId, dto);
  }

  @Patch('profiles/:entityId/verify')
  @ApiOperation({ summary: 'Platform admin: verify or suspend an enterprise (KYB)' })
  verify(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: VerifyEnterpriseDto,
  ) {
    return this.enterpriseService.setVerification(entityId, dto);
  }

  // ─── Branches ────────────────────────────────────────────────────────────

  @Post('profiles/:entityId/branches')
  @ApiOperation({ summary: 'Create a branch/sub-entity under a verified parent enterprise' })
  @HttpCode(HttpStatus.CREATED)
  addBranch(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: RegisterEnterpriseDto,
  ) {
    return this.enterpriseService.registerBranch(entityId, dto);
  }

  // ─── API Keys ─────────────────────────────────────────────────────────────

  @Post('profiles/:entityId/api-keys')
  @ApiOperation({ summary: 'Generate a new API key for machine-to-machine integration' })
  @HttpCode(HttpStatus.CREATED)
  createApiKey(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.enterpriseService.createApiKey(entityId, dto);
  }

  @Get('profiles/:entityId/api-keys')
  @ApiOperation({ summary: 'List active API keys (prefixes only)' })
  listApiKeys(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.enterpriseService.listApiKeys(entityId);
  }

  @Delete('profiles/:entityId/api-keys/:keyId')
  @ApiOperation({ summary: 'Revoke an API key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    return this.enterpriseService.revokeApiKey(entityId, keyId);
  }
}
