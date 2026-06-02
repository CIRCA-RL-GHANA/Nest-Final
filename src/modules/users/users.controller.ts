import { Controller, Post, Body, HttpCode, HttpStatus, Get, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerifyBiometricDto } from './dto/verify-biometric.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { AssignStaffRoleDto } from './dto/assign-staff-role.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully. OTP sent to phone number.',
    schema: {
      example: {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        message: 'User registered successfully. OTP sent to phone number.',
      },
    },
  })
  @ApiConflictResponse({ description: 'Phone number, username, or Wire ID already exists' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  async register(@Body() registerUserDto: RegisterUserDto) {
    return this.usersService.register(registerUserDto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code' })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully',
    schema: {
      example: {
        message: 'OTP verified successfully.',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'OTP not found' })
  @ApiBadRequestResponse({ description: 'Invalid or expired OTP' })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.usersService.verifyOtp(verifyOtpDto);
  }

  @Public()
  @Post('verify-biometric')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update biometric verification status' })
  @ApiResponse({
    status: 200,
    description: 'Biometric verification status updated',
    schema: {
      example: {
        message: 'Biometric verification status updated successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'User not eligible for biometric verification' })
  async verifyBiometric(@Body() verifyBiometricDto: VerifyBiometricDto) {
    return this.usersService.verifyBiometric(verifyBiometricDto);
  }

  @Public()
  @Post('set-pin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Set PIN for user' })
  @ApiResponse({
    status: 201,
    description: 'PIN setup successful',
    schema: {
      example: {
        message: 'PIN setup successful.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'PIN setup failed' })
  async setPin(@Body() setPinDto: SetPinDto) {
    return this.usersService.setPin(setPinDto);
  }

  @Post('staff/assign')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign staff role to user' })
  @ApiResponse({
    status: 201,
    description: 'Staff role assigned successfully',
    schema: {
      example: {
        message: 'Staff role assigned successfully.',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid role or staff assignment failed' })
  async assignStaffRole(@Body() assignStaffRoleDto: AssignStaffRoleDto) {
    return this.usersService.assignStaffRole(assignStaffRoleDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Public()
  @Get('check-username/:username')
  @ApiOperation({ summary: 'Check if a username is available' })
  @ApiResponse({
    status: 200,
    description: 'Username availability result',
    schema: {
      example: { available: true, username: 'john_doe' },
    },
  })
  async checkUsername(@Param('username') username: string) {
    return this.usersService.checkUsernameAvailability(username);
  }

  @Public()
  @Post('check-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if a phone number exists in the system' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phoneNumber'],
      properties: { phoneNumber: { type: 'string', example: '+233545448456' } },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Phone number check result',
    schema: {
      example: { exists: false, phoneNumber: '+1234567890' },
    },
  })
  async checkPhone(@Body() body: { phoneNumber: string }) {
    return this.usersService.checkPhoneExists(body.phoneNumber);
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP to phone number' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phoneNumber'],
      properties: { phoneNumber: { type: 'string', example: '+233545448456' } },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP resent successfully',
    schema: {
      example: { message: 'OTP sent to phone number.' },
    },
  })
  async resendOtp(@Body() body: { phoneNumber: string }) {
    return this.usersService.resendOtp(body.phoneNumber);
  }
}
