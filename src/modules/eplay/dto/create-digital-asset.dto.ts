import { IsString, IsEnum, IsNumber, IsOptional, IsArray, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DigitalAssetType, AccessModel } from '../entities/digital-asset.entity';

export class CreateDigitalAssetDto {
  @ApiProperty({ description: 'Content title' })
  @IsString()
  @MaxLength(300)
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: DigitalAssetType })
  @IsEnum(DigitalAssetType)
  type: DigitalAssetType;

  @ApiProperty({ enum: AccessModel })
  @IsEnum(AccessModel)
  accessModel: AccessModel;

  @ApiProperty({ description: 'Price in Q Points (min 0.01)', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  priceQPoints: number;

  @ApiProperty({ required: false, description: 'Required when accessModel = RENTAL' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  rentalDurationDays?: number;

  @ApiProperty({ required: false, description: 'Cover art URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @ApiProperty({ description: 'Encrypted storage reference (S3 object key)' })
  @IsString()
  @MaxLength(500)
  encryptedStorageRef: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;

  @ApiProperty({ required: false, description: 'Comma-separated genre tags' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  @ApiProperty({ required: false, description: 'ISO 3166-1 alpha-2 allowed country codes' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRegions?: string[];
}
