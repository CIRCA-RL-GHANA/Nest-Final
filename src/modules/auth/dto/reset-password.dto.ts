import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Registered phone number', example: '+233545448456' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s]{7,20}$/, { message: 'Phone number must be in valid international format' })
  phoneNumber: string;

  @ApiProperty({ description: '6-digit reset code sent via SMS', example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Reset code must be 6 digits' })
  code: string;

  @ApiProperty({ description: 'New password (min 8 chars, uppercase, lowercase, number, special)', example: 'NewP@ss8' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#!$%^&*])[A-Za-z\d@#!$%^&*]{8,}$/, {
    message: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@#!$%^&*)',
  })
  newPassword: string;
}
