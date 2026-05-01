import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '@modules/users/entities/user.entity';
import { FiProfile } from '../../loans/entities/fi-profile.entity';

/**
 * FiLicenseGuard
 *
 * Must be applied after JwtAuthGuard. Ensures the authenticated user holds one
 * of the FI roles AND that the FI entity they belong to has a verified
 * regulatory license (fi_profiles.license_verified = true).
 *
 * The guard reads entity_id from either the request body or query params
 * and falls back to checking all FI profiles owned by the user.
 */
@Injectable()
export class FiLicenseGuard implements CanActivate {
  private readonly FI_ROLES = new Set<string>([
    UserRole.FINANCIAL_INSTITUTION,
    UserRole.FI_LOAN_OFFICER,
    UserRole.FI_TELLER,
    UserRole.FI_AUDITOR,
  ]);

  constructor(
    @InjectRepository(FiProfile)
    private readonly fiProfileRepo: Repository<FiProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    // Platform admins bypass FI license check
    if (user.role === UserRole.ADMIN) return true;

    if (!this.FI_ROLES.has(user.role)) {
      throw new ForbiddenException('This route is restricted to Financial Institution accounts');
    }

    // Resolve the FI entity ID from body/params/query or from the user's own profile
    const entityId: string | undefined =
      request.body?.fiEntityId ??
      request.params?.fiEntityId ??
      request.query?.fiEntityId ??
      user.entityId;

    if (!entityId) {
      throw new ForbiddenException('FI entity ID could not be resolved for license verification');
    }

    const profile = await this.fiProfileRepo.findOne({ where: { entityId } });
    if (!profile) {
      throw new NotFoundException(`FI profile for entity ${entityId} not found`);
    }
    if (!profile.licenseVerified) {
      throw new ForbiddenException(
        'Your Financial Institution license has not been verified by the platform admin. Please complete onboarding.',
      );
    }

    return true;
  }
}
