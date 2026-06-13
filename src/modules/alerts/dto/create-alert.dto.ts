import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAlertDto {
  @ApiProperty() @IsString() title: string;
  @ApiProperty() @IsString() body: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() type?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() priority?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() entityId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsArray() tags?: string[];
  @ApiProperty({ required: false }) @IsOptional() metadata?: Record<string, any>;
}
