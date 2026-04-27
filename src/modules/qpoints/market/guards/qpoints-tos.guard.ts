import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { QPointsTosService } from '../services/qpoints-tos.service';

/**
 * Metadata key for routes that should skip the ToS gate.
 * Apply @SkipTosCheck() to a controller method to bypass this guard.
 */
export const SKIP_TOS_CHECK_KEY = 'skipTosCheck';

export function SkipTosCheck(): MethodDecorator {
  return (target, key, descriptor) => {
    Reflect.defineMetadata(SKIP_TOS_CHECK_KEY, true, descriptor.value as object);
    return descriptor;
  };
}

/**
 * QPoints ToS Guard — enforces that the authenticated user has accepted the
 * current version of the Q Points Terms of Service before they may perform
 * any market operations (place orders, cash in/out, view balance, etc.).
 *
 * The GET /qpoints/tos endpoint is explicitly exempted via @SkipTosCheck()
 * so users can always retrieve the ToS for display.
 *
 * Legal basis: Section 3 (Eligibility) and Section 1.2 of the Q Points ToS.
 */
@Injectable()
export class QPointsTosGuard implements CanActivate {
  constructor(
    private readonly tosService: QPointsTosService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow routes explicitly decorated with @SkipTosCheck()
    const skip = this.reflector.get<boolean>(
      SKIP_TOS_CHECK_KEY,
      context.getHandler(),
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const userId = request.user?.id;

    if (!userId) {
      // JwtAuthGuard runs first; if we reach here without a user, deny
      throw new ForbiddenException('Authentication required.');
    }

    const accepted = await this.tosService.hasAcceptedCurrentTos(userId);
    if (!accepted) {
      throw new ForbiddenException(
        'You must accept the Q Points Terms of Service before using the Q Points Market. ' +
          'Please fetch the current Terms at GET /api/v1/qpoints/tos and submit your acceptance ' +
          'to POST /api/v1/qpoints/tos/accept.',
      );
    }

    return true;
  }
}
