import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto, ResolveAlertDto, AddTimelineEventDto } from './dto/update-alert.dto';
import { Alert, AlertStatus, AlertCategory, AlertPriority } from './entities/alert.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new alert' })
  @ApiResponse({ status: 201, type: Alert })
  create(@Body() dto: CreateAlertDto, @CurrentUser() user: User): Promise<Alert> {
    return this.alertsService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List alerts with optional filters' })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: AlertStatus })
  @ApiQuery({ name: 'category', required: false, enum: AlertCategory })
  @ApiQuery({ name: 'priority', required: false, enum: AlertPriority })
  @ApiQuery({ name: 'assigneeId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  findAll(
    @Query('entityId') entityId?: string,
    @Query('status') status?: AlertStatus,
    @Query('category') category?: AlertCategory,
    @Query('priority') priority?: AlertPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.alertsService.findAll({
      entityId,
      status,
      category,
      priority,
      assigneeId,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get alert statistics' })
  @ApiQuery({ name: 'entityId', required: false })
  getStats(@Query('entityId') entityId?: string) {
    return this.alertsService.getStats(entityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get alert by ID' })
  @ApiResponse({ status: 200, type: Alert })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id') id: string): Promise<Alert> {
    return this.alertsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an alert' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAlertDto,
    @CurrentUser() user: User,
  ): Promise<Alert> {
    return this.alertsService.update(id, dto, user.socialUsername ?? user.id);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resolve an alert' })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
    @CurrentUser() user: User,
  ): Promise<Alert> {
    return this.alertsService.resolve(id, dto, user.socialUsername ?? user.id);
  }

  @Post(':id/escalate')
  @ApiOperation({ summary: 'Escalate an alert' })
  escalate(@Param('id') id: string, @CurrentUser() user: User): Promise<Alert> {
    return this.alertsService.escalate(id, user.socialUsername ?? user.id);
  }

  @Post(':id/timeline')
  @ApiOperation({ summary: 'Add a comment/event to the alert timeline' })
  addTimelineEvent(
    @Param('id') id: string,
    @Body() dto: AddTimelineEventDto,
    @CurrentUser() user: User,
  ): Promise<Alert> {
    return this.alertsService.addTimelineEvent(id, dto, user.socialUsername ?? user.id);
  }

  @Patch(':id/bookmark')
  @ApiOperation({ summary: 'Toggle bookmark on an alert' })
  toggleBookmark(@Param('id') id: string): Promise<Alert> {
    return this.alertsService.toggleBookmark(id);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create multiple alerts in one request' })
  createBulk(
    @Body() body: { alerts: CreateAlertDto[] },
    @CurrentUser() user: User,
  ) {
    return Promise.all(
      body.alerts.map(dto => this.alertsService.create(dto, user.id)),
    );
  }

  @Patch(':id/dismiss')
  @ApiOperation({ summary: 'Dismiss an alert (closes it without a resolution note)' })
  dismiss(@Param('id') id: string, @CurrentUser() user: User): Promise<Alert> {
    return this.alertsService.update(
      id,
      { status: AlertStatus.CLOSED },
      user.socialUsername ?? user.id,
    );
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get alert analytics / statistics' })
  @ApiQuery({ name: 'entityId', required: false })
  getAnalytics(@Query('entityId') entityId?: string) {
    return this.alertsService.getStats(entityId);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get common alert templates' })
  getTemplates() {
    return [
      { id: 'low-stock', name: 'Low Stock', category: 'inventory', priority: 'medium', template: 'Product {{product}} is below reorder level.' },
      { id: 'payment-failed', name: 'Payment Failed', category: 'financial', priority: 'high', template: 'Payment of {{amount}} QP failed for order {{order}}.' },
      { id: 'sos', name: 'SOS Alert', category: 'safety', priority: 'critical', template: 'SOS triggered by {{user}} at {{location}}.' },
      { id: 'fraud-detected', name: 'Fraud Detected', category: 'security', priority: 'critical', template: 'Suspicious transaction of {{amount}} QP flagged on account {{account}}.' },
      { id: 'order-delayed', name: 'Order Delayed', category: 'fulfillment', priority: 'medium', template: 'Order {{order}} is past its expected delivery window.' },
    ];
  }

  @Get('search')
  @ApiOperation({ summary: 'Search alerts by keyword' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'entityId', required: false })
  search(
    @Query('q') q: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.alertsService.findAll({
      entityId,
      searchQuery: q,
      limit: 50,
      offset: 0,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an alert' })
  remove(@Param('id') id: string): Promise<void> {
    return this.alertsService.remove(id);
  }
}
