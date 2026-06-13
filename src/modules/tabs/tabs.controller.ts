import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TabsService } from './tabs.service';
import { CreateTabDto } from './dto/create-tab.dto';
import { UpdateTabDto } from './dto/update-tab.dto';

@ApiTags('tabs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tabs')
export class TabsController {
  constructor(private readonly tabsService: TabsService) {}

  @Get()
  @ApiOperation({ summary: 'List tabs for an entity' })
  @ApiQuery({ name: 'entityId', required: true })
  list(@Query('entityId') entityId: string) {
    return this.tabsService.listByEntity(entityId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a tab' })
  create(@Body() dto: CreateTabDto) {
    return this.tabsService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tab by ID' })
  findOne(@Param('id') id: string) {
    return this.tabsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update tab' })
  update(@Param('id') id: string, @Body() dto: UpdateTabDto) {
    return this.tabsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete tab' })
  remove(@Param('id') id: string) {
    return this.tabsService.remove(id);
  }

  @Post(':id/charge')
  @ApiOperation({ summary: 'Charge to tab' })
  charge(
    @Param('id') id: string,
    @Body() body: { amount: number; description?: string },
  ) {
    return this.tabsService.chargeTab(id, body.amount, body.description);
  }

  @Post(':id/settle')
  @ApiOperation({ summary: 'Settle tab balance' })
  settle(
    @Param('id') id: string,
    @Body() body: { amount: number },
  ) {
    return this.tabsService.settleTab(id, body.amount);
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get tab transactions (stub)' })
  transactions(@Param('id') _id: string) {
    return [];
  }
}
