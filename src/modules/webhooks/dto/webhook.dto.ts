import { IsUUID, IsUrl, IsArray, ArrayNotEmpty, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Supported enterprise webhook event types */
export const SUPPORTED_EVENTS = [
  'order.created',
  'order.updated',
  'order.fulfilled',
  'order.cancelled',
  'product.created',
  'product.updated',
  'inventory.updated',
  'payment.completed',
  'payment.failed',
  'payment.refunded',
  'fulfillment.updated',
  'qpoints.charged',
  'concierge.session_ended',
] as const;

export type WebhookEventType = (typeof SUPPORTED_EVENTS)[number];

export class CreateWebhookSubscriptionDto {
  @ApiProperty({ description: 'Entity ID that owns this subscription' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ description: 'HTTPS endpoint that will receive events' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({
    description: 'Event types to subscribe to',
    type: [String],
    example: ['order.created', 'payment.completed'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];
}

export class WebhookEventPayloadDto {
  @ApiProperty()
  @IsString()
  entityId: string;

  @ApiProperty()
  @IsString()
  eventType: string;

  @ApiProperty()
  data: Record<string, any>;
}
