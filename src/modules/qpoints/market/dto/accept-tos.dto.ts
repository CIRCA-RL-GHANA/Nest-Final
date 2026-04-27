import { IsBoolean, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AcceptancePlatform {
  WEB = 'web',
  IOS = 'ios',
  ANDROID = 'android',
}

/**
 * Body sent by the client when the user actively accepts the Q Points ToS.
 * All three boolean fields must be true — any false value is rejected (400).
 */
export class AcceptQPointsTosDto {
  @ApiProperty({
    description:
      'Version of the ToS being accepted (must match the current server version, e.g. "1.0.0")',
    example: '1.0.0',
  })
  @IsString()
  @IsNotEmpty()
  tosVersion: string;

  @ApiProperty({
    description: 'User explicitly confirms they have read the full Terms of Service',
    example: true,
  })
  @IsBoolean()
  readConfirmed: boolean;

  @ApiProperty({
    description: 'User explicitly acknowledges all Risk Disclosures (Section 9)',
    example: true,
  })
  @IsBoolean()
  riskConfirmed: boolean;

  @ApiProperty({
    description: 'User confirms they are at least 18 years old (Section 3.1)',
    example: true,
  })
  @IsBoolean()
  ageConfirmed: boolean;

  @ApiProperty({
    enum: AcceptancePlatform,
    description: 'Platform/channel via which acceptance occurs',
    example: AcceptancePlatform.IOS,
  })
  @IsEnum(AcceptancePlatform)
  platform: AcceptancePlatform;
}
