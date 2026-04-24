import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PostType } from '../entities/community-post.entity';

export class CreatePostDto {
  @ApiProperty({ enum: PostType, required: false })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiProperty({ required: false, description: 'ID of a linked e-Play asset or market product' })
  @IsOptional()
  @IsUUID()
  linkedContentId?: string;

  @ApiProperty({ required: false, description: 'Type-specific metadata (poll options, event details, etc.)' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
