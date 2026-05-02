import {
  IsUUID, IsString, IsOptional, IsObject, MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({ description: 'Enterprise entity UUID' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ description: 'End-user ID (from the enterprise system)' })
  @IsString()
  @MaxLength(500)
  endUserId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string;

  @ApiProperty({ required: false, description: 'Contextual data injected into every AI turn (user profile, cart, etc.)' })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  message: string;

  @ApiProperty({ required: false, description: 'Updated context to merge for this turn only' })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

export class UpdateSessionContextDto {
  @ApiProperty()
  @IsObject()
  context: Record<string, any>;
}
