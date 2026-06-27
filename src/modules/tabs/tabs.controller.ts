import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { TabsService } from './tabs.service';
import { CreateTabDto, UpdateTabDto, ChargeTabDto, SettleTabDto } from './dto/tab.dto';

const WRITE_ROLES = [UserRole.ENTERPRISE_ADMIN, UserRole.ENTERPRISE_OPERATOR, UserRole.ADMIN];
const READ_ROLES = [...WRITE_ROLES, UserRole.ENTERPRISE_VIEWER, UserRole.USER];

@ApiTags('tabs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tabs')
export class TabsController {
  constructor(private readonly svc: TabsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Open a new credit tab for a customer' })
  create(@Body() dto: CreateTabDto, @CurrentUser('id') userId: string) {
    return this.svc.create(dto, userId);
  }

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'List all tabs for an entity' })
  @ApiQuery({ name: 'entityId', required: true })
  findAll(@Query('entityId') entityId: string) {
    return this.svc.findAll(entityId);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get a tab by ID' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update a tab' })
  update(@Param('id') id: string, @Body() dto: UpdateTabDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close and delete a tab' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/charge')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Add a charge to the tab balance' })
  charge(@Param('id') id: string, @Body() dto: ChargeTabDto) {
    return this.svc.charge(id, dto);
  }

  @Post(':id/settle')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Settle (pay down) part or all of the tab balance' })
  settle(@Param('id') id: string, @Body() dto: SettleTabDto) {
    return this.svc.settle(id, dto);
  }

  @Get(':id/transactions')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get all transactions on a tab' })
  getTransactions(@Param('id') id: string) {
    return this.svc.getTransactions(id);
  }
}
