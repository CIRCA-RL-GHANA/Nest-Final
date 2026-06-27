import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { CampaignStatus } from './entities/campaign.entity';

const WRITE_ROLES = [UserRole.ENTERPRISE_ADMIN, UserRole.ENTERPRISE_OPERATOR, UserRole.ADMIN];
const READ_ROLES = [...WRITE_ROLES, UserRole.ENTERPRISE_VIEWER, UserRole.FI_AUDITOR];

@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Create a campaign' })
  create(@Body() dto: CreateCampaignDto, @CurrentUser('id') userId: string) {
    return this.svc.create(dto, userId);
  }

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'List campaigns for an entity' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'status', required: false, enum: CampaignStatus })
  findAll(
    @Query('entityId') entityId: string,
    @Query('status') status?: CampaignStatus,
  ) {
    return this.svc.findAll(entityId, status);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get a campaign by ID' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update a campaign' })
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a campaign' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Patch(':id/activate')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Activate a draft or paused campaign' })
  activate(@Param('id') id: string) {
    return this.svc.activate(id);
  }

  @Patch(':id/pause')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Pause an active campaign' })
  pause(@Param('id') id: string) {
    return this.svc.pause(id);
  }

  @Get(':id/analytics')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get campaign analytics' })
  getAnalytics(@Param('id') id: string) {
    return this.svc.getAnalytics(id);
  }
}
