import { Entity, Column, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BaseEntity } from '@/common/entities/base.entity';

export enum ProductCategory {
  FOOD = 'Food',
  BEVERAGE = 'Beverage',
  ELECTRONICS = 'Electronics',
  CLOTHING = 'Clothing',
  HEALTH = 'Health',
  HOME = 'Home',
  OTHER = 'Other',
}

export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  OUT_OF_STOCK = 'out_of_stock',
  DISCONTINUED = 'discontinued',
}

@Entity('products')
@Index(['branchId'])
@Index(['category'])
@Index(['status'])
@Index(['name'])
export class Product extends BaseEntity {
  @ApiProperty({
    description: 'Product name',
    example: 'Premium Coffee Beans',
  })
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @ApiProperty({
    description: 'Product description',
    required: false,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'Branch ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ type: 'uuid' })
  branchId: string;

  @ApiProperty({
    description: 'Product category',
    enum: ProductCategory,
    example: ProductCategory.FOOD,
  })
  @Column({ type: 'enum', enum: ProductCategory })
  category: ProductCategory;

  @ApiProperty({
    description: 'Product price',
    example: 29.99,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @ApiProperty({
    description: 'Discounted price',
    required: false,
    example: 24.99,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discountedPrice: number | null;

  @ApiProperty({
    description: 'Stock quantity',
    example: 100,
  })
  @Column({ type: 'int', default: 0 })
  stockQuantity: number;

  @ApiProperty({
    description: 'SKU (Stock Keeping Unit)',
    required: false,
  })
  @Column({ type: 'varchar', length: 100, nullable: true })
  sku: string | null;

  @ApiProperty({
    description: 'Product status',
    enum: ProductStatus,
    example: ProductStatus.ACTIVE,
  })
  @Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.ACTIVE })
  status: ProductStatus;

  @ApiProperty({
    description: 'Product weight in kg',
    required: false,
  })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  weight: number | null;

  @ApiProperty({
    description: 'Product dimensions (length x width x height)',
    required: false,
    example: { length: 10, width: 5, height: 3 },
  })
  @Column({ type: 'jsonb', nullable: true })
  dimensions: { length: number; width: number; height: number } | null;

  @ApiProperty({
    description: 'Product tags',
    type: [String],
    required: false,
    example: ['organic', 'premium', 'bestseller'],
  })
  @Column({ type: 'jsonb', nullable: true })
  tags: string[] | null;

  @ApiProperty({
    description: 'Product images',
    type: [String],
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  images: string[] | null;

  @ApiProperty({
    description: 'Average rating',
    required: false,
    example: 4.5,
  })
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  rating: number | null;

  @ApiProperty({
    description: 'Number of reviews',
    example: 125,
  })
  @Column({ type: 'int', default: 0 })
  reviewCount: number;

  @ApiProperty({
    description: 'Number of views',
    example: 1500,
  })
  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @ApiProperty({
    description: 'Whether product is featured',
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  isFeatured: boolean;

  @ApiProperty({
    description: 'Additional metadata',
    type: 'object',
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
