import { IsUUID, IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { HeyYaIntent } from '../entities/heyya-request.entity';

export class CreateHeyYaRequestDto {
  @ApiProperty({ description: 'Recipient ID' })
  @IsUUID()
  recipientId: string;

  @ApiProperty({ description: 'Opening message to the person you like', required: false })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({
    description: 'Primary date intent — what kind of date you have in mind',
    enum: HeyYaIntent,
    default: HeyYaIntent.ANY,
    required: false,
  })
  @IsEnum(HeyYaIntent)
  @IsOptional()
  intent?: HeyYaIntent;

  @ApiProperty({ description: 'Expiration date', required: false })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
