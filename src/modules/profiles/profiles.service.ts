import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { VisibilitySettings } from './entities/visibility-settings.entity';
import { InteractionPreferences } from './entities/interaction-preferences.entity';
import { AuditLog } from '@modules/users/entities/audit-log.entity';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateVisibilitySettingsDto } from './dto/update-visibility-settings.dto';
import { UpdateInteractionPreferencesDto } from './dto/update-interaction-preferences.dto';
import {
  MessageRestriction,
  ProfileViewRestriction,
} from './entities/interaction-preferences.entity';
import { AISearchService } from '../ai/services/ai-search.service';
import { AINlpService } from '../ai/services/ai-nlp.service';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectRepository(Profile)
    private readonly profileRepository: Repository<Profile>,
    @InjectRepository(VisibilitySettings)
    private readonly visibilityRepository: Repository<VisibilitySettings>,
    @InjectRepository(InteractionPreferences)
    private readonly interactionRepository: Repository<InteractionPreferences>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly dataSource: DataSource,
    private readonly aiSearch: AISearchService,
    private readonly aiNlp: AINlpService,
  ) {}

  /**
   * Create a new profile with default visibility and interaction settings
   */
  async createProfile(
    dto: CreateProfileDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<Profile> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check if profile already exists for this user
      const existingProfile = await this.profileRepository.findOne({
        where: { userId: dto.userId },
      });
      if (existingProfile) {
        throw new ConflictException('Profile already exists for this user');
      }

      // Check if profile already exists for this entity
      const existingEntityProfile = await this.profileRepository.findOne({
        where: { entityId: dto.entityId },
      });
      if (existingEntityProfile) {
        throw new ConflictException('Profile already exists for this entity');
      }

      // Create profile
      const profile = queryRunner.manager.create(Profile, {
        userId: dto.userId,
        entityId: dto.entityId,
        publicName: dto.publicName,
        profilePictureUrl: dto.profilePictureUrl,
        bio: dto.bio,
        mfaVerified: false,
      });

      const savedProfile = await queryRunner.manager.save(profile);

      // Create default visibility settings
      const visibilitySettings = queryRunner.manager.create(VisibilitySettings, {
        profileId: savedProfile.id,
        isPublic: true,
        allowProfileView: true,
        allowMessageReceive: true,
      });

      await queryRunner.manager.save(visibilitySettings);

      // Create default interaction preferences
      const interactionPreferences = queryRunner.manager.create(InteractionPreferences, {
        profileId: savedProfile.id,
        messageRestriction: MessageRestriction.EVERYONE,
        profileViewRestriction: ProfileViewRestriction.PUBLIC,
      });

      await queryRunner.manager.save(interactionPreferences);

      // Log audit
      await this.logAudit(
        'Create Profile',
        'SUCCESS',
        dto.userId,
        { userId: dto.userId, profileId: savedProfile.id, entityId: dto.entityId },
        ipAddress,
        userAgent,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();

      this.logger.log(`Profile created successfully for user ${dto.userId}`);

      // AI: index profile for semantic search (best-effort)
      try {
        const indexText = [savedProfile.publicName, savedProfile.bio].filter(Boolean).join(' ');
        if (indexText.length > 3) {
          await this.aiSearch.indexEntity('profile', savedProfile.id, indexText);
        }
      } catch (aiErr) {
        this.logger.warn(`AI profile indexing failed: ${aiErr.message}`);
      }

      return savedProfile;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error creating profile: ${error.message}`, error.stack);

      // Log failed attempt
      await this.logAudit(
        'Create Profile',
        'ERROR',
        dto.userId,
        { error: error.message },
        ipAddress,
        userAgent,
      );

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update profile metadata
   */
  async updateProfile(
    profileId: string,
    dto: UpdateProfileDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<Profile> {
    try {
      const profile = await this.profileRepository.findOne({ where: { id: profileId } });
      if (!profile) {
        throw new NotFoundException('Profile not found');
      }

      // Update fields if provided
      if (dto.publicName !== undefined) profile.publicName = dto.publicName;
      if (dto.profilePictureUrl !== undefined) profile.profilePictureUrl = dto.profilePictureUrl;
      if (dto.bio !== undefined) profile.bio = dto.bio;

      const updatedProfile = await this.profileRepository.save(profile);

      // Log audit
      await this.logAudit(
        'Update Profile',
        'SUCCESS',
        userId,
        { profileId, changes: dto },
        ipAddress,
        userAgent,
      );

      // AI: re-index updated profile (best-effort)
      try {
        const indexText = [updatedProfile.publicName, updatedProfile.bio].filter(Boolean).join(' ');
        if (indexText.length > 3) {
          await this.aiSearch.indexEntity('profile', updatedProfile.id, indexText);
        }
      } catch (aiErr) {
        this.logger.warn(`AI profile re-indexing failed: ${aiErr.message}`);
      }

      this.logger.log(`Profile ${profileId} updated successfully`);
      return updatedProfile;
    } catch (error) {
      this.logger.error(`Error updating profile: ${error.message}`, error.stack);

      await this.logAudit(
        'Update Profile',
        'ERROR',
        userId,
        { profileId, error: error.message },
        ipAddress,
        userAgent,
      );

      throw error;
    }
  }

  /**
   * Get profile by ID
   */
  async getProfile(profileId: string): Promise<Profile> {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      relations: ['user', 'entity'],
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  /**
   * Get profile by user ID
   */
  async getProfileByUserId(userId: string): Promise<Profile | null> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
      relations: ['user', 'entity'],
    });

    return profile ?? null;
  }

  /**
   * Get profile by entity ID
   */
  async getProfileByEntityId(entityId: string): Promise<Profile> {
    const profile = await this.profileRepository.findOne({
      where: { entityId },
      relations: ['user', 'entity'],
    });

    if (!profile) {
      throw new NotFoundException('Profile not found for this entity');
    }

    return profile;
  }

  /**
   * Delete profile (soft delete via base entity)
   */
  async deleteProfile(
    profileId: string,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    try {
      const profile = await this.profileRepository.findOne({ where: { id: profileId } });
      if (!profile) {
        throw new NotFoundException('Profile not found');
      }

      await this.profileRepository.softDelete(profileId);

      // Log audit
      await this.logAudit('Delete Profile', 'SUCCESS', userId, { profileId }, ipAddress, userAgent);

      this.logger.log(`Profile ${profileId} deleted successfully`);
    } catch (error) {
      this.logger.error(`Error deleting profile: ${error.message}`, error.stack);

      await this.logAudit(
        'Delete Profile',
        'ERROR',
        userId,
        { profileId, error: error.message },
        ipAddress,
        userAgent,
      );

      throw error;
    }
  }

  /**
   * Update visibility settings
   */
  async updateVisibilitySettings(
    profileId: string,
    dto: UpdateVisibilitySettingsDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<VisibilitySettings> {
    try {
      const settings = await this.visibilityRepository.findOne({ where: { profileId } });
      if (!settings) {
        throw new NotFoundException('Visibility settings not found');
      }

      // Update fields if provided
      if (dto.isPublic !== undefined) settings.isPublic = dto.isPublic;
      if (dto.allowProfileView !== undefined) settings.allowProfileView = dto.allowProfileView;
      if (dto.allowMessageReceive !== undefined)
        settings.allowMessageReceive = dto.allowMessageReceive;

      const updatedSettings = await this.visibilityRepository.save(settings);

      // Log audit
      await this.logAudit(
        'Update Visibility Settings',
        'SUCCESS',
        userId,
        { profileId, changes: dto },
        ipAddress,
        userAgent,
      );

      this.logger.log(`Visibility settings updated for profile ${profileId}`);
      return updatedSettings;
    } catch (error) {
      this.logger.error(`Error updating visibility settings: ${error.message}`, error.stack);

      await this.logAudit(
        'Update Visibility Settings',
        'ERROR',
        userId,
        { profileId, error: error.message },
        ipAddress,
        userAgent,
      );

      throw error;
    }
  }

  /**
   * Get visibility settings
   */
  async getVisibilitySettings(profileId: string): Promise<VisibilitySettings> {
    const settings = await this.visibilityRepository.findOne({
      where: { profileId },
      relations: ['profile'],
    });

    if (!settings) {
      throw new NotFoundException('Visibility settings not found');
    }

    return settings;
  }

  /**
   * Update interaction preferences
   */
  async updateInteractionPreferences(
    profileId: string,
    dto: UpdateInteractionPreferencesDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<InteractionPreferences> {
    try {
      const preferences = await this.interactionRepository.findOne({ where: { profileId } });
      if (!preferences) {
        throw new NotFoundException('Interaction preferences not found');
      }

      // Update fields if provided
      if (dto.messageRestriction !== undefined)
        preferences.messageRestriction = dto.messageRestriction;
      if (dto.profileViewRestriction !== undefined)
        preferences.profileViewRestriction = dto.profileViewRestriction;

      const updatedPreferences = await this.interactionRepository.save(preferences);

      // Log audit
      await this.logAudit(
        'Update Interaction Preferences',
        'SUCCESS',
        userId,
        { profileId, changes: dto },
        ipAddress,
        userAgent,
      );

      this.logger.log(`Interaction preferences updated for profile ${profileId}`);
      return updatedPreferences;
    } catch (error) {
      this.logger.error(`Error updating interaction preferences: ${error.message}`, error.stack);

      await this.logAudit(
        'Update Interaction Preferences',
        'ERROR',
        userId,
        { profileId, error: error.message },
        ipAddress,
        userAgent,
      );

      throw error;
    }
  }

  /**
   * Get interaction preferences
   */
  async getInteractionPreferences(profileId: string): Promise<InteractionPreferences> {
    const preferences = await this.interactionRepository.findOne({
      where: { profileId },
      relations: ['profile'],
    });

    if (!preferences) {
      throw new NotFoundException('Interaction preferences not found');
    }

    return preferences;
  }

  /**
   * Private helper to log audit events
   */
  /**
   * AI PROFILE INTELLIGENCE
   */

  async getAIProfileKeywords(
    profileId: string,
  ): Promise<{ keywords: string[]; sentiment: any; summary: string }> {
    const profile = await this.profileRepository.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const bioText = [profile.publicName, profile.bio].filter(Boolean).join(' ');
    if (bioText.length < 5) {
      return { keywords: [], sentiment: null, summary: '' };
    }

    const [keywords, sentiment, summary] = await Promise.all([
      this.aiNlp.extractKeywords(bioText, 10),
      this.aiNlp.analyzeSentiment(bioText),
      this.aiNlp.summariseText(bioText),
    ]);

    return { keywords, sentiment, summary: summary.summary };
  }

  private async logAudit(
    action: string,
    status: string,
    userId: string,
    metadata: any,
    ipAddress: string,
    userAgent: string,
    manager?: any,
  ): Promise<void> {
    const auditLog = {
      action,
      status,
      userId,
      metadata,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    };

    if (manager) {
      await manager.save(AuditLog, auditLog);
    } else {
      await this.auditLogRepository.save(auditLog);
    }
  }
}
