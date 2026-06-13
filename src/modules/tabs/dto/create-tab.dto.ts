import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTabDto {
  @ApiProperty() @IsString() entityId: string;
  @ApiProperty() @IsString() customerId: string;
  @ApiProperty() @IsString() label: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() creditLimit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() metadata?: Record<string, any>;
}
