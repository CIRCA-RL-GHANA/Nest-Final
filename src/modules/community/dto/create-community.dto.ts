import { IsString, IsEnum, IsOptional, IsObject, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CommunityType, CommunityVisibility } from '../entities/community.entity';

export class CreateCommunityDto {
  @ApiProperty({ description: 'Community name' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CommunityType })
  @IsEnum(CommunityType)
  type: CommunityType;

  @ApiProperty({ enum: CommunityVisibility, required: false })
  @IsOptional()
  @IsEnum(CommunityVisibility)
  visibility?: CommunityVisibility;

  @ApiProperty({ required: false, description: 'Cover / banner image URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @ApiProperty({ required: false, description: 'Comma-separated discovery tags' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  @ApiProperty({ required: false, description: 'Type-specific metadata (event time, linked asset IDs, etc.)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
