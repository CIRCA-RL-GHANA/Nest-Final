import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Registered phone number', example: '+233545448456' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s]{7,20}$/, { message: 'Phone number must be in valid international format' })
  phoneNumber: string;
}
