import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../../entities/payment.entity';

export class QpChargeDto {
  @ApiProperty({ description: 'Genie user ID of the customer (must have sufficient QP)' })
  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({ description: 'Entity ID of the merchant receiving QP' })
  @IsUUID()
  @IsNotEmpty()
  merchantEntityId: string;

  @ApiProperty({ description: 'QP amount to charge', example: 100 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'External order reference', required: false })
  @IsOptional()
  @IsString()
  orderReference?: string;

  @ApiProperty({ description: 'Additional metadata', type: 'object', required: false })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class CreatePaymentDto {
  @ApiProperty({ description: 'Order ID (if payment is for an order)', required: false })
  @IsUUID()
  @IsOptional()
  orderId?: string;

  @ApiProperty({ description: 'Ride ID (if payment is for a ride)', required: false })
  @IsUUID()
  @IsOptional()
  rideId?: string;

  @ApiProperty({ description: 'Payment amount', example: 50.0 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Currency code', example: 'NGN', required: false })
  @IsString()
  @IsOptional()
  currency?: string;
}
