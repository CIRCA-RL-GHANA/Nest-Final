import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseAssetDto {
  @ApiProperty({ description: 'Digital asset ID to purchase' })
  @IsUUID()
  digitalAssetId: string;

  @ApiProperty({ description: 'Optional QPoints transaction reference from client', required: false })
  @IsOptional()
  @IsUUID()
  transactionId?: string;
}
