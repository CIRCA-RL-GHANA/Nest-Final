import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import {
  SubscriptionAssignment,
  SubscriptionTargetType,
} from './entities/subscription-assignment.entity';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // ==================== Subscription Plans ====================

  /**
   * ADMIN-only: create new subscription plan tiers.
   * Enterprise users subscribe to existing plans via /activate.
   */
  @Post('plans')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new subscription plan (admin only)' })
  @ApiResponse({ status: 201, description: 'Plan created successfully', type: SubscriptionPlan })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body() dto: CreateSubscriptionPlanDto): Promise<SubscriptionPlan> {
    return this.subscriptionsService.createPlan(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get all active subscription plans' })
  @ApiResponse({
    status: 200,
    description: 'Plans retrieved successfully',
    type: [SubscriptionPlan],
  })
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    return this.subscriptionsService.getAllPlans();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  @ApiResponse({ status: 200, description: 'Plan retrieved successfully', type: SubscriptionPlan })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async getPlanById(@Param('id') id: string): Promise<SubscriptionPlan> {
    return this.subscriptionsService.getPlanById(id);
  }

  @Put('plans/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update subscription plan (admin only)' })
  @ApiResponse({ status: 200, description: 'Plan updated successfully', type: SubscriptionPlan })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlan> {
    return this.subscriptionsService.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete subscription plan (admin only)' })
  @ApiResponse({ status: 200, description: 'Plan deleted successfully' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete plan with active subscriptions' })
  @HttpCode(HttpStatus.OK)
  async deletePlan(@Param('id') id: string): Promise<{ message: string }> {
    await this.subscriptionsService.deletePlan(id);
    return { message: 'Subscription plan deleted successfully' };
  }

  // ==================== Subscription Management ====================

  /**
   * Enterprise admin, FI owners, and platform admins may activate subscriptions.
   * Operators and viewers cannot modify billing.
   */
  @Post('activate')
  @Roles(UserRole.ENTERPRISE_ADMIN, UserRole.FINANCIAL_INSTITUTION, UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate subscription for Entity or Branch' })
  @ApiResponse({
    status: 201,
    description: 'Subscription activated successfully',
    type: SubscriptionAssignment,
  })
  @ApiResponse({ status: 400, description: 'Insufficient Q-Points or invalid request' })
  @ApiResponse({ status: 404, description: 'Plan or target not found' })
  @HttpCode(HttpStatus.CREATED)
  async activateSubscription(
    @Body() dto: ActivateSubscriptionDto,
    @Req() req: any,
  ): Promise<SubscriptionAssignment> {
    const userId = req.user?.id || 'system';
    return this.subscriptionsService.activateSubscription(dto, userId);
  }

  @Get('active/:targetType/:targetId')
  @ApiOperation({ summary: 'Get active subscription for Entity or Branch' })
  @ApiResponse({
    status: 200,
    description: 'Active subscription retrieved',
    type: SubscriptionAssignment,
  })
  @ApiResponse({ status: 404, description: 'No active subscription found' })
  async getActiveSubscription(
    @Param('targetType') targetType: SubscriptionTargetType,
    @Param('targetId') targetId: string,
  ): Promise<SubscriptionAssignment | null> {
    return this.subscriptionsService.getActiveSubscription(targetType, targetId);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel subscription (PATCH)' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @HttpCode(HttpStatus.OK)
  async patchCancelSubscription(
    @Param('id') id: string,
    @Req() req: any,
    @Body('reason') reason?: string,
  ): Promise<{ message: string }> {
    const userId = req.user?.id || 'system';
    await this.subscriptionsService.cancelSubscription(id, userId, reason);
    return { message: 'Subscription cancelled successfully' };
  }

  @Delete(':id/cancel')
  @Roles(UserRole.ENTERPRISE_ADMIN, UserRole.FINANCIAL_INSTITUTION, UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancel subscription' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(@Param('id') id: string, @Req() req: any): Promise<{ message: string }> {
    const userId = req.user?.id || 'system';
    await this.subscriptionsService.cancelSubscription(id, userId);
    return { message: 'Subscription cancelled successfully' };
  }

  /** ADMIN-only: manually trigger the scheduled renewal job. */
  @Post('renew')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Manually trigger subscription renewal process (admin only)' })
  @ApiResponse({ status: 200, description: 'Renewal process completed' })
  @HttpCode(HttpStatus.OK)
  async renewSubscriptions(): Promise<{ message: string }> {
    await this.subscriptionsService.renewSubscriptions();
    return { message: 'Subscription renewal process completed' };
  }
}
