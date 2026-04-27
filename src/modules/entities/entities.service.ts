import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EntityProfile, EntityType } from './entities/entity.entity';
import { Branch } from './entities/branch.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { BoosterPointsAccount } from '../qpoints/entities/booster-points-account.entity';
import { CreateIndividualEntityDto } from './dto/create-individual-entity.dto';
import { CreateOtherEntityDto } from './dto/create-other-entity.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { AISearchService } from '../ai/services/ai-search.service';

@Injectable()
export class EntitiesService {
  private readonly logger = new Logger(EntitiesService.name);

  constructor(
    @InjectRepository(EntityProfile)
    private readonly entityRepository: Repository<EntityProfile>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(QPointAccount)
    private readonly qpointAccountRepository: Repository<QPointAccount>,
    @InjectRepository(BoosterPointsAccount)
    private readonly boosterAccountRepository: Repository<BoosterPointsAccount>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly dataSource: DataSource,
    private readonly aiSearch: AISearchService,
  ) {}

  /**
   * Create Individual Entity
   * - Automatically created after user registration and MFA completion
   * - Creates Q-Points account
   * - Uses user's existing Wire ID and social username
   */
  async createIndividualEntity(dto: CreateIndividualEntityDto) {
    const { userId } = dto;

    // Use transaction to ensure atomicity
    return this.dataSource.transaction(async (manager) => {
      // Verify user exists and is eligible
      const user = await manager.findOne(User, {
        where: { id: userId },
      });

      if (!user) {
        await this.logAudit('Individual Entity Creation', 'FAILED', userId, {
          reason: 'User not found',
        });
        throw new NotFoundException('User not found.');
      }

      if (!user.otpVerified || !user.biometricVerified) {
        await this.logAudit('Individual Entity Creation', 'FAILED', userId, {
          reason: 'User not fully verified',
          otpVerified: user.otpVerified,
          biometricVerified: user.biometricVerified,
        });
        throw new BadRequestException('User must complete OTP and biometric verification first.');
      }

      // Check if entity already exists
      const existingEntity = await manager.findOne(EntityProfile, {
        where: { ownerId: userId },
      });

      if (existingEntity) {
        await this.logAudit('Individual Entity Creation', 'FAILED', userId, {
          reason: 'Entity already exists',
          entityId: existingEntity.id,
        });
        throw new ConflictException('Individual entity already created for this user.');
      }

      // Create Individual Entity
      const entity = manager.create(EntityProfile, {
        type: EntityType.INDIVIDUAL,
        wireId: user.wireId ?? '',
        socialUsername: user.socialUsername ?? '',
        ownerId: userId,
      });

      const savedEntity = await manager.save(EntityProfile, entity);

      // Create Q-Points Account
      const qpointAccount = manager.create(QPointAccount, {
        entityId: savedEntity.id,
        balance: 0,
        currency: 'QP',
        isActive: true,
      });

      await manager.save(QPointAccount, qpointAccount);

      // Log success
      await this.logAudit('Individual Entity Creation', 'SUCCESS', userId, {
        entityId: savedEntity.id,
        qpointAccountId: qpointAccount.id,
        wireId: user.wireId,
        socialUsername: user.socialUsername,
      });

      this.logger.log(`Individual entity created for user ${userId}: ${savedEntity.id}`);

      return {
        entityId: savedEntity.id,
        qpointAccountId: qpointAccount.id,
        message: 'Individual entity and Q-Points account created successfully.',
      };
    });
  }

  /**
   * Create Other Entity
   * - Creates business/organization entity
   * - Generates unique Wire ID
   * - Creates Q-Points account
   * - Assigns subscription plan if provided
   */
  async createOtherEntity(dto: CreateOtherEntityDto) {
    const { createdBy, wireId, phoneNumber, name, type, subscriptionPlanId, metadata } = dto;

    return this.dataSource.transaction(async (manager) => {
      // Verify creator exists
      const creator = await manager.findOne(User, {
        where: { id: createdBy },
      });

      if (!creator) {
        await this.logAudit('Other Entity Creation', 'FAILED', createdBy, {
          reason: 'Creator not found',
        });
        throw new NotFoundException('Creator user not found.');
      }

      // Check Wire ID uniqueness
      const existingWireId = await manager.findOne(EntityProfile, {
        where: { wireId },
      });

      if (existingWireId) {
        await this.logAudit('Other Entity Creation', 'FAILED', createdBy, {
          reason: 'Wire ID exists',
          wireId,
        });
        throw new ConflictException('Wire ID already in use.');
      }

      // Check phone number uniqueness
      const existingPhone = await manager.findOne(EntityProfile, {
        where: { phoneNumber },
      });

      if (existingPhone) {
        await this.logAudit('Other Entity Creation', 'FAILED', createdBy, {
          reason: 'Phone number exists',
          phoneNumber,
        });
        throw new ConflictException('Phone number already registered to another entity.');
      }

      // Create Other Entity
      const entity = manager.create(EntityProfile, {
        type: EntityType.OTHER,
        wireId,
        socialUsername: wireId.substring(1), // Remove @ prefix for username
        ownerId: createdBy,
        name,
        otherEntityType: type,
        phoneNumber,
        subscriptionPlanId,
        createdById: createdBy,
        metadata,
      });

      const savedEntity = await manager.save(EntityProfile, entity);

      // Create Q-Points Account
      const qpointAccount = manager.create(QPointAccount, {
        entityId: savedEntity.id,
        balance: 0,
        currency: 'QP',
        isActive: true,
      });

      await manager.save(QPointAccount, qpointAccount);

      // Create Booster Points Account
      const boosterAccount = manager.create(BoosterPointsAccount, {
        entityId: savedEntity.id,
        balance: 0,
        currency: 'BPT',
        isActive: true,
      });

      await manager.save(BoosterPointsAccount, boosterAccount);

      // Log success
      await this.logAudit('Other Entity Creation', 'SUCCESS', createdBy, {
        entityId: savedEntity.id,
        qpointAccountId: qpointAccount.id,
        boosterAccountId: boosterAccount.id,
        name,
        wireId,
        type,
      });

      this.logger.log(`Other entity created by user ${createdBy}: ${savedEntity.id} (${name})`);

      return {
        entityId: savedEntity.id,
        qpointAccountId: qpointAccount.id,
        boosterAccountId: boosterAccount.id,
        message: 'Other entity, Q-Points, and Booster Points accounts created successfully.',
      };
    });
  }

  /**
   * Create Branch
   * - Creates branch for an existing entity
   * - Assigns subscription plan if provided
   * - Assigns manager if provided
   * - Creates Booster Points account for the branch
   */
  async createBranch(dto: CreateBranchDto) {
    const {
      entityId,
      name,
      type,
      phoneNumber,
      location,
      managerId,
      subscriptionPlanId,
      serviceScope,
      metadata,
    } = dto;

    return this.dataSource.transaction(async (manager) => {
      // Verify entity exists
      const entity = await manager.findOne(EntityProfile, {
        where: { id: entityId },
      });

      if (!entity) {
        throw new NotFoundException('Entity not found.');
      }

      // Create branch
      const branch = manager.create(Branch, {
        entityId,
        name,
        type,
        phoneNumber,
        location,
        managerId,
        subscriptionPlanId,
        serviceScope,
        metadata,
        activatedAt: new Date(),
      });

      const savedBranch = await manager.save(Branch, branch);

      // Create Booster Points Account for the branch
      const boosterAccount = manager.create(BoosterPointsAccount, {
        branchId: savedBranch.id,
        balance: 0,
        currency: 'BPT',
        isActive: true,
      });

      await manager.save(BoosterPointsAccount, boosterAccount);

      await this.logAudit('Branch Creation', 'SUCCESS', entity.ownerId, {
        branchId: savedBranch.id,
        boosterAccountId: boosterAccount.id,
        entityId,
        name,
        type,
      });

      this.logger.log(`Branch created for entity ${entityId}: ${savedBranch.id} (${name})`);

      return {
        branchId: savedBranch.id,
        boosterAccountId: boosterAccount.id,
        message: 'Branch and Booster Points account created successfully.',
      };
    });
  }

  /**
   * Find entity by ID
   */
  async findById(id: string) {
    const entity = await this.entityRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException('Entity not found.');
    }

    return entity;
  }

  /**
   * Find entity by owner ID
   */
  async findByOwnerId(ownerId: string) {
    return this.entityRepository.findOne({
      where: { ownerId },
    });
  }

  /**
   * Find branches by entity ID
   */
  async findBranchesByEntityId(entityId: string) {
    return this.branchRepository.find({
      where: { entityId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create audit log entry
   */
  private async logAudit(
    action: string,
    status: string,
    userId: string | null,
    metadata: Record<string, any>,
  ) {
    try {
      await this.auditLogRepository.save({
        action,
        status,
        userId,
        metadata,
      });
    } catch (error) {
      this.logger.error('Failed to create audit log', error.stack);
    }
  }

  /**
   * AI: Semantic search across entity profiles.
   */
  async searchEntitiesAI(query: string): Promise<{ entityId: string; score: number }[]> {
    try {
      const entities = await this.entityRepository.find({ take: 500 });
      const corpus = entities.map((e) => ({
        id: e.id,
        text: [
          (e as any).businessName ?? '',
          (e as any).wireId ?? '',
          (e as any).type ?? '',
          (e as any).description ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      }));
      const results = await this.aiSearch.rankCandidates(query, corpus);
      return results.map((r) => ({ entityId: r.id, score: r.score }));
    } catch {
      return [];
    }
  }
}
