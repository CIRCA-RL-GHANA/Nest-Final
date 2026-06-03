import {
  Controller, Post, Get, Put, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { MultiChannelService } from './multi-channel.service';
import { RegisterChannelDto, SyncChannelDto } from './dto/multi-channel.dto';

/** Enterprise and admin users only — operators can read/sync but not delete channels. */
@ApiTags('multi-channel')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ENTERPRISE_ADMIN, UserRole.ENTERPRISE_OPERATOR, UserRole.ADMIN)
@Controller('multi-channel')
export class MultiChannelController {
  constructor(private readonly multiChannelService: MultiChannelService) {}

  @Post('channels')
  @ApiOperation({ summary: 'Register an external channel (Shopify, Walmart, Amazon, POS, etc.)' })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterChannelDto) {
    return this.multiChannelService.registerChannel(dto);
  }

  @Get('channels/:entityId')
  @ApiOperation({ summary: 'List all active channels for an enterprise entity' })
  list(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.multiChannelService.listChannels(entityId);
  }

  @Put('channels/:id/sync')
  @ApiOperation({ summary: 'Trigger manual inventory/order sync for a channel' })
  sync(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SyncChannelDto,
  ) {
    return this.multiChannelService.syncChannel(id, dto);
  }

  @Delete('channels/:id')
  @ApiOperation({ summary: 'Deactivate a channel' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.multiChannelService.deactivateChannel(id);
  }

  @Post('channels/:id/webhook')
  @ApiOperation({ summary: 'Receive an inbound webhook event from an external channel' })
  @HttpCode(HttpStatus.OK)
  webhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { eventType: string; payload: Record<string, any> },
  ) {
    return this.multiChannelService.receiveWebhookEvent(id, body.eventType, body.payload);
  }
}
