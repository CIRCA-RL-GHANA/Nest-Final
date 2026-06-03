import {
  Controller, Post, Get, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { EnterpriseService } from './enterprise.service';
import { EnterpriseAnalyticsService } from './enterprise-analytics.service';
import {
  RegisterEnterpriseDto,
  UpdateEnterpriseSettingsDto,
  VerifyEnterpriseDto,
  CreateApiKeyDto,
} from './dto/enterprise.dto';

/** All enterprise + FI roles that may read entity-scoped data */
const ENTERPRISE_READ_ROLES = [
  UserRole.ENTERPRISE_ADMIN,
  UserRole.ENTERPRISE_OPERATOR,
  UserRole.ENTERPRISE_VIEWER,
  UserRole.FINANCIAL_INSTITUTION,
  UserRole.FI_AUDITOR,
  UserRole.ADMIN,
] as const;

/** Roles that may mutate enterprise settings, branches, and API keys */
const ENTERPRISE_WRITE_ROLES = [
  UserRole.ENTERPRISE_ADMIN,
  UserRole.FINANCIAL_INSTITUTION,
  UserRole.ADMIN,
] as const;

@ApiTags('enterprise')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('enterprise')
export class EnterpriseController {
  constructor(
    private readonly enterpriseService: EnterpriseService,
    private readonly analyticsService: EnterpriseAnalyticsService,
  ) {}

  // ─── Registration ─────────────────────────────────────────────────────────

  /** Any authenticated user can self-register an enterprise (starts PENDING). */
  @Post('register')
  @ApiOperation({ summary: 'Onboard a new enterprise entity onto the platform' })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterEnterpriseDto) {
    return this.enterpriseService.register(dto);
  }

  /** ADMIN-only — platform management dashboard. */
  @Get('profiles')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all enterprise profiles (admin only)' })
  list() {
    return this.enterpriseService.listProfiles();
  }

  /** Enterprise / FI roles read their own profile; ADMIN reads any. */
  @Get('profiles/:entityId')
  @Roles(...ENTERPRISE_READ_ROLES)
  @ApiOperation({ summary: 'Get enterprise profile by entity ID' })
  getProfile(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.enterpriseService.getProfile(entityId);
  }

  /** Enterprise admin and ADMIN update settings & pathways. */
  @Patch('profiles/:entityId/settings')
  @Roles(...ENTERPRISE_WRITE_ROLES)
  @ApiOperation({ summary: 'Update enterprise webhook, settings, and pathways' })
  updateSettings(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: UpdateEnterpriseSettingsDto,
  ) {
    return this.enterpriseService.updateSettings(entityId, dto);
  }

  /** ADMIN-only — KYB approval / suspension. */
  @Patch('profiles/:entityId/verify')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Platform admin: verify or suspend an enterprise (KYB)' })
  verify(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: VerifyEnterpriseDto,
  ) {
    return this.enterpriseService.setVerification(entityId, dto);
  }

  // ─── Branches ────────────────────────────────────────────────────────────

  /** Enterprise admin (and ADMIN) can create branches/subsidiaries. */
  @Post('profiles/:entityId/branches')
  @Roles(...ENTERPRISE_WRITE_ROLES)
  @ApiOperation({ summary: 'Create a branch/sub-entity under a verified parent enterprise' })
  @HttpCode(HttpStatus.CREATED)
  addBranch(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: RegisterEnterpriseDto,
  ) {
    return this.enterpriseService.registerBranch(entityId, dto);
  }

  // ─── API Keys ─────────────────────────────────────────────────────────────

  /** Enterprise admin generates M2M API keys. Operators/viewers cannot. */
  @Post('profiles/:entityId/api-keys')
  @Roles(...ENTERPRISE_WRITE_ROLES)
  @ApiOperation({ summary: 'Generate a new API key for machine-to-machine integration' })
  @HttpCode(HttpStatus.CREATED)
  createApiKey(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.enterpriseService.createApiKey(entityId, dto);
  }

  /** All enterprise/FI roles may list key prefixes (values never stored). */
  @Get('profiles/:entityId/api-keys')
  @Roles(...ENTERPRISE_READ_ROLES)
  @ApiOperation({ summary: 'List active API keys (prefixes only)' })
  listApiKeys(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.enterpriseService.listApiKeys(entityId);
  }

  /** Enterprise admin and ADMIN may revoke API keys. */
  @Delete('profiles/:entityId/api-keys/:keyId')
  @Roles(...ENTERPRISE_WRITE_ROLES)
  @ApiOperation({ summary: 'Revoke an API key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiKey(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ) {
    return this.enterpriseService.revokeApiKey(entityId, keyId);
  }

  // ─── Analytics Dashboard ──────────────────────────────────────────────────

  /**
   * Entity-scoped analytics snapshot: orders, products, subscription,
   * webhook health, fee usage, and staff headcount.
   *
   * All enterprise and FI roles can call this for their own entity.
   * Platform admins can call it for any entity.
   * Optional ?branchId= scopes product/order data to a single branch.
   */
  @Get('analytics/:entityId')
  @Roles(...ENTERPRISE_READ_ROLES)
  @ApiOperation({ summary: 'Aggregated analytics snapshot for an enterprise entity' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Scope to a specific branch UUID' })
  getAnalytics(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.analyticsService.getSnapshot(entityId, branchId);
  }

  /**
   * Multi-branch summary table — all branches with their order + product counts.
   * Ideal for the enterprise management hub / branch selector.
   */
  @Get('analytics/:entityId/branches')
  @Roles(...ENTERPRISE_READ_ROLES)
  @ApiOperation({ summary: 'Branch-level summaries (order + product counts) for all branches' })
  getBranchSummaries(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.analyticsService.getBranchSummaries(entityId);
  }

  /**
   * Monthly platform-fee counters for this entity (last 6 months).
   * Restricted to enterprise_admin, FI owners, FI auditors, and platform admin.
   * Operators and viewers are excluded from billing data.
   */
  @Get('analytics/:entityId/fees')
  @Roles(UserRole.ENTERPRISE_ADMIN, UserRole.FINANCIAL_INSTITUTION, UserRole.FI_AUDITOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Monthly platform-fee counters for this entity (last 6 months)' })
  getEntityFees(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.analyticsService.getEntityFees(entityId);
  }
}
