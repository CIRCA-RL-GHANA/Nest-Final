import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  READY_FOR_PICKUP = 'ready_for_pickup',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentMethod {
  QPOINTS = 'qpoints',
  CASH = 'cash',
  CARD = 'card',
  MOBILE_MONEY = 'mobile_money',
}

@Entity('orders')
@Index(['buyerId'])
@Index(['branchId'])
@Index(['status'])
@Index(['createdAt'])
export class Order extends BaseEntity {
  @ApiProperty({ description: 'Order number', example: 'ORD-2026-00001' })
  @Column({ type: 'varchar', unique: true, length: 50 })
  orderNumber: string;

  @ApiProperty({ description: 'Buyer ID' })
  @Column({ type: 'uuid' })
  buyerId: string;

  @ApiProperty({ description: 'Branch ID' })
  @Column({ type: 'uuid' })
  branchId: string;

  @ApiProperty({ description: 'Order status', enum: OrderStatus })
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @ApiProperty({ description: 'Subtotal amount', example: 100.0 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @ApiProperty({ description: 'Delivery fee', example: 5.0 })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deliveryFee: number;

  @ApiProperty({ description: 'Tax amount', example: 7.5 })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax: number;

  @ApiProperty({ description: 'Discount amount', example: 10.0 })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

  @ApiProperty({ description: 'Total amount', example: 102.5 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod })
  @Column({ type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Whether payment is completed' })
  @Column({ type: 'boolean', default: false })
  isPaid: boolean;

  @ApiProperty({ description: 'Delivery address', type: 'object' })
  @Column({ type: 'jsonb' })
  deliveryAddress: { street: string; city: string; coordinates?: { lat: number; lng: number } };

  @ApiProperty({ description: 'Delivery notes', required: false })
  @Column({ type: 'text', nullable: true })
  deliveryNotes: string | null;

  @ApiProperty({ description: 'Estimated delivery time', required: false })
  @Column({ type: 'timestamp', nullable: true })
  estimatedDelivery: Date | null;

  @ApiProperty({ description: 'Actual delivery time', required: false })
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @ApiProperty({ description: 'Fulfiller ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  fulfillerId: string | null;

  @ApiProperty({ description: 'Driver ID', required: false })
  @Column({ type: 'uuid', nullable: true })
  driverId: string | null;

  @ApiProperty({ description: 'Order metadata', type: 'object', required: false })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({ description: 'Rating (1-5)', required: false })
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  rating: number | null;

  @ApiProperty({ description: 'Written review', required: false })
  @Column({ type: 'text', nullable: true })
  review: string | null;
}
