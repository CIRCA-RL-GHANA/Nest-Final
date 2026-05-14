import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

@Entity('order_items')
@Index(['orderId'])
@Index(['productId'])
export class OrderItem extends BaseEntity {
  @ApiProperty({ description: 'Order ID' })
  @Column({ type: 'uuid' })
  orderId: string;

  @ApiProperty({ description: 'Product ID' })
  @Column({ type: 'uuid' })
  productId: string;

  @ApiProperty({ description: 'Product name (snapshot)' })
  @Column({ type: 'varchar', length: 200 })
  productName: string;

  @ApiProperty({ description: 'Quantity', example: 2 })
  @Column({ type: 'int' })
  quantity: number;

  @ApiProperty({ description: 'Unit price at time of order', example: 25.0 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @ApiProperty({ description: 'Total price for this item', example: 50.0 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice: number;

  @ApiProperty({ description: 'Special instructions', required: false })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ApiProperty({ description: 'Whether item is available' })
  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;

  @ApiProperty({ description: 'Replacement product ID if original unavailable', required: false })
  @Column({ type: 'uuid', nullable: true })
  replacementProductId: string | null;
}
