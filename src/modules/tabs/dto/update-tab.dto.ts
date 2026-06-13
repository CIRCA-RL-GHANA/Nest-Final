import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTabDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() label?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() creditLimit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
}
