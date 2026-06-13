import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'List user alerts' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'category', required: false })
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
  ) {
    return this.alertsService.list(user.id, { status, priority, category });
  }

  @Post()
  @ApiOperation({ summary: 'Create alert' })
  create(@CurrentUser() user: User, @Body() dto: CreateAlertDto) {
    return this.alertsService.create(user.id, dto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk create alerts' })
  bulkCreate(@CurrentUser() user: User, @Body() body: { alerts: CreateAlertDto[] }) {
    return this.alertsService.bulkCreate(user.id, body.alerts);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get alert analytics summary' })
  analytics(@CurrentUser() user: User) {
    return this.alertsService.getAnalytics(user.id);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get alert templates' })
  templates() {
    return this.alertsService.getTemplates();
  }

  @Get('search')
  @ApiOperation({ summary: 'Search alerts by title or body' })
  @ApiQuery({ name: 'q', required: true })
  search(@CurrentUser() user: User, @Query('q') q: string) {
    return this.alertsService.search(user.id, q ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get alert by ID' })
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.alertsService.findOne(id, user.id);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve an alert' })
  resolve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.alertsService.resolve(id, user.id);
  }

  @Patch(':id/dismiss')
  @ApiOperation({ summary: 'Dismiss an alert' })
  dismiss(@CurrentUser() user: User, @Param('id') id: string) {
    return this.alertsService.dismiss(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an alert' })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.alertsService.remove(id, user.id);
  }
}
