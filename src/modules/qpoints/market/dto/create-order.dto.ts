import { IsEnum, IsNumber, IsPositive, Max, Min, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QPointOrderType } from '../entities/q-point-order.entity';

export class CreateOrderDto {
  @ApiProperty({ enum: QPointOrderType, description: 'buy or sell' })
  @IsEnum(QPointOrderType)
  type: QPointOrderType;

  @ApiPropertyOptional({
    description: 'Price per Q Point in USD. Always fixed at $1.00 – this field is ignored.',
    example: 1.0,
    deprecated: true,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Min(0.0001)
  @Max(9999)
  price?: number;

  @ApiProperty({ description: 'Quantity of Q Points', example: 100 })
  @IsNumber()
  @IsPositive()
  @Min(0.0001)
  @Max(1_000_000)
  quantity: number;
}
