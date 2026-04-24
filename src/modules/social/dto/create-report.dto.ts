import { IsUUID, IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReportDto {
  @ApiProperty({
    description: 'ID of the content being reported',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  contentId: string;

  @ApiProperty({
    description: 'Type of content (update, comment, user)',
    example: 'update',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  contentType: string;

  @ApiProperty({
    description: 'Reason for the report',
    example: 'spam',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  reason: string;

  @ApiProperty({
    description: 'Additional details about the report',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
