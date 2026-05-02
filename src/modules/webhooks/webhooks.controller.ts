import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookSubscriptionDto } from './dto/webhook.dto';

/** Enterprise and FI operators may subscribe to / manage webhooks. */
@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.ENTERPRISE_ADMIN,
  UserRole.ENTERPRISE_OPERATOR,
  UserRole.FINANCIAL_INSTITUTION,
  UserRole.ADMIN,
)
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Post('subscriptions')
  @ApiOperation({ summary: 'Subscribe to enterprise webhook events (HMAC-SHA256 signed)' })
  subscribe(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.svc.subscribe(dto);
  }

  @Get('subscriptions/:entityId')
  @ApiOperation({ summary: 'List webhook subscriptions for an entity' })
  list(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.svc.list(entityId);
  }

  @Delete('subscriptions/:entityId/:subscriptionId')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  delete(
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ) {
    return this.svc.delete(entityId, subscriptionId);
  }
}
