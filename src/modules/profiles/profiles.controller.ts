import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateVisibilitySettingsDto } from './dto/update-visibility-settings.dto';
import { UpdateInteractionPreferencesDto } from './dto/update-interaction-preferences.dto';
import { Profile } from './entities/profile.entity';
import { VisibilitySettings } from './entities/visibility-settings.entity';
import { InteractionPreferences } from './entities/interaction-preferences.entity';

@ApiTags('Profiles')
@Controller('profiles')
@ApiBearerAuth()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // ==================== Profile Endpoints ====================

  @Post()
  @ApiOperation({ summary: 'Create a new profile with default settings' })
  @ApiResponse({ status: 201, description: 'Profile created successfully', type: Profile })
  @ApiResponse({ status: 409, description: 'Profile already exists' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @HttpCode(HttpStatus.CREATED)
  async createProfile(@Body() dto: CreateProfileDto, @Req() req: any): Promise<Profile> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    return this.profilesService.createProfile(dto, ipAddress, userAgent);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get profile by ID' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully', type: Profile })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfile(@Param('id') id: string): Promise<Profile> {
    return this.profilesService.getProfile(id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get profile by user ID' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully', type: Profile })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfileByUserId(@Param('userId') userId: string): Promise<Profile | null> {
    return this.profilesService.getProfileByUserId(userId);
  }

  @Get('entity/:entityId')
  @ApiOperation({ summary: 'Get profile by entity ID' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully', type: Profile })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfileByEntityId(@Param('entityId') entityId: string): Promise<Profile> {
    return this.profilesService.getProfileByEntityId(entityId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update profile metadata' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully', type: Profile })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
    @Req() req: any,
  ): Promise<Profile> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user?.id || 'system'; // Will be populated by auth guard
    return this.profilesService.updateProfile(id, dto, userId, ipAddress, userAgent);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete profile (soft delete)' })
  @ApiResponse({ status: 200, description: 'Profile deleted successfully' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @HttpCode(HttpStatus.OK)
  async deleteProfile(@Param('id') id: string, @Req() req: any): Promise<{ message: string }> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user?.id || 'system';
    await this.profilesService.deleteProfile(id, userId, ipAddress, userAgent);
    return { message: 'Profile deleted successfully' };
  }

  // ==================== Visibility Settings Endpoints ====================

  @Get(':profileId/visibility')
  @ApiOperation({ summary: 'Get visibility settings for a profile' })
  @ApiResponse({
    status: 200,
    description: 'Visibility settings retrieved successfully',
    type: VisibilitySettings,
  })
  @ApiResponse({ status: 404, description: 'Visibility settings not found' })
  async getVisibilitySettings(@Param('profileId') profileId: string): Promise<VisibilitySettings> {
    return this.profilesService.getVisibilitySettings(profileId);
  }

  @Put(':profileId/visibility')
  @ApiOperation({ summary: 'Update visibility settings for a profile' })
  @ApiResponse({
    status: 200,
    description: 'Visibility settings updated successfully',
    type: VisibilitySettings,
  })
  @ApiResponse({ status: 404, description: 'Visibility settings not found' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async updateVisibilitySettings(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateVisibilitySettingsDto,
    @Req() req: any,
  ): Promise<VisibilitySettings> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user?.id || 'system';
    return this.profilesService.updateVisibilitySettings(
      profileId,
      dto,
      userId,
      ipAddress,
      userAgent,
    );
  }

  // ==================== Interaction Preferences Endpoints ====================

  @Get(':profileId/interaction-preferences')
  @ApiOperation({ summary: 'Get interaction preferences for a profile' })
  @ApiResponse({
    status: 200,
    description: 'Interaction preferences retrieved successfully',
    type: InteractionPreferences,
  })
  @ApiResponse({ status: 404, description: 'Interaction preferences not found' })
  async getInteractionPreferences(
    @Param('profileId') profileId: string,
  ): Promise<InteractionPreferences> {
    return this.profilesService.getInteractionPreferences(profileId);
  }

  @Put(':profileId/interaction-preferences')
  @ApiOperation({ summary: 'Update interaction preferences for a profile' })
  @ApiResponse({
    status: 200,
    description: 'Interaction preferences updated successfully',
    type: InteractionPreferences,
  })
  @ApiResponse({ status: 404, description: 'Interaction preferences not found' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async updateInteractionPreferences(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateInteractionPreferencesDto,
    @Req() req: any,
  ): Promise<InteractionPreferences> {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user?.id || 'system';
    return this.profilesService.updateInteractionPreferences(
      profileId,
      dto,
      userId,
      ipAddress,
      userAgent,
    );
  }
}
