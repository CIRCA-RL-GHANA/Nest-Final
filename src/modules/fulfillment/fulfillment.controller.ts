import {
  Controller, Post, Get, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FulfillmentService } from './fulfillment.service';
import {
  CreateRoutingRuleDto,
  DispatchFulfillmentDto,
  UpdateFulfillmentStatusDto,
} from './dto/fulfillment.dto';

@ApiTags('fulfillment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fulfillment')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  // ─── Routing Rules ────────────────────────────────────────────────────────

  @Post('rules')
  @ApiOperation({ summary: 'Create a fulfillment routing rule for an enterprise' })
  @HttpCode(HttpStatus.CREATED)
  createRule(@Body() dto: CreateRoutingRuleDto) {
    return this.fulfillmentService.createRule(dto);
  }

  @Get('rules/:entityId')
  @ApiOperation({ summary: 'List routing rules for an enterprise' })
  listRules(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.fulfillmentService.listRules(entityId);
  }

  @Delete('rules/:ruleId')
  @ApiOperation({ summary: 'Deactivate a routing rule' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRule(@Param('ruleId', ParseUUIDPipe) ruleId: string) {
    return this.fulfillmentService.deleteRule(ruleId);
  }

  // ─── Fulfillment Tasks ────────────────────────────────────────────────────

  @Post('tasks')
  @ApiOperation({ summary: 'Dispatch a new fulfillment task for an order' })
  @HttpCode(HttpStatus.CREATED)
  dispatch(@Body() dto: DispatchFulfillmentDto) {
    return this.fulfillmentService.dispatch(dto);
  }

  @Get('tasks/:entityId')
  @ApiOperation({ summary: 'List fulfillment tasks for an enterprise' })
  listTasks(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.fulfillmentService.listTasks(entityId);
  }

  @Get('tasks/detail/:taskId')
  @ApiOperation({ summary: 'Get a specific fulfillment task' })
  getTask(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.fulfillmentService.getTask(taskId);
  }

  @Patch('tasks/:taskId/status')
  @ApiOperation({ summary: 'Update fulfillment status (webhook callback from provider)' })
  updateStatus(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateFulfillmentStatusDto,
  ) {
    return this.fulfillmentService.updateStatus(taskId, dto);
  }
}
