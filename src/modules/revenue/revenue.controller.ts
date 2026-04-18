import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RevenueService } from './revenue.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { UserRole } from '@modules/users/entities/user.entity';

@ApiTags('Revenue (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/revenue')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide revenue stats (totals by type, current month)' })
  getStats() {
    return this.revenue.getStats();
  }

  @Get('entities/:entityId/transaction-fees')
  @ApiOperation({ summary: 'Get monthly transaction fee counters for a business entity' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM format; omit for all months' })
  getEntityFees(
    @Param('entityId') entityId: string,
    @Query('month') month?: string,
  ) {
    return this.revenue.getEntityMonthlyFees(entityId, month);
  }
}
