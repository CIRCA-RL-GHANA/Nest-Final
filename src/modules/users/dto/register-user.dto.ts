import { IsString, IsNotEmpty, MinLength, Matches, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterUserDto {
  @ApiProperty({
    description: 'User phone number (E.164 format, spaces allowed)',
    example: '+1234567890',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s]{7,20}$/, {
    message: 'Phone number must be in valid international format',
  })
  phoneNumber: string;

  @ApiProperty({
    description: 'Social username (alphanumeric, underscores allowed)',
    example: 'john_doe',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Social username can only contain letters, numbers, and underscores',
  })
  socialUsername: string;

  @ApiProperty({
    description: 'Password (min 8 chars, must include uppercase, lowercase, number, special char)',
    example: 'SecureP@ss8',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#!$%^&*])[A-Za-z\d@#!$%^&*]{8,}$/, {
    message:
      'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@#!$%^&*)',
  })
  password: string;

  @ApiProperty({
    description: 'Wire ID (unique identifier starting with @)',
    example: '@johndoe',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^@[a-zA-Z0-9_]+$/, {
    message: 'Wire ID must start with @ and contain only letters, numbers, and underscores',
  })
  wireId: string;

  @ApiPropertyOptional({ description: 'First name', example: 'John' })
  @IsString() @IsOptional() firstName?: string;

  @ApiPropertyOptional({ description: 'Last name', example: 'Doe' })
  @IsString() @IsOptional() lastName?: string;

  @ApiPropertyOptional({ description: 'Email address', example: 'john@example.com' })
  @IsEmail() @IsOptional() email?: string;

  @ApiPropertyOptional({
    description: 'Device fingerprint for security tracking',
    example: 'device-fingerprint-hash',
  })
  @IsString()
  @IsOptional()
  deviceFingerprint?: string;

  @ApiPropertyOptional({
    description: 'IP address of the user',
    example: '192.168.1.1',
  })
  @IsString()
  @IsOptional()
  ipAddress?: string;

  @ApiPropertyOptional({
    description: 'Geolocation data',
    example: { latitude: 40.7128, longitude: -74.006 },
  })
  @IsOptional()
  geolocation?: Record<string, any>;
}
