import { Controller, Get, Post, Put, Patch, Body, Param, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { VerifyPINDto } from './dto/verify-pin.dto';
import { CreateRideFeedbackDto } from './dto/create-ride-feedback.dto';
import { CreateSOSAlertDto } from './dto/create-sos-alert.dto';
import { Ride } from './entities/ride.entity';
import { RideTracking } from './entities/ride-tracking.entity';
import { RideFeedback } from './entities/ride-feedback.entity';
import { RideReferral } from './entities/ride-referral.entity';
import { WaitTimeTracking } from './entities/wait-time-tracking.entity';
import { RideSOSAlert } from './entities/ride-sos-alert.entity';

@ApiTags('rides')
@Controller('rides')
@ApiBearerAuth()
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  @ApiOperation({ summary: 'Request a new ride' })
  @ApiResponse({ status: 201, description: 'Ride requested successfully', type: Ride })
  async createRide(@CurrentUser('id') riderId: string, @Body() dto: CreateRideDto): Promise<Ride> {
    return this.ridesService.createRide(riderId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ride by ID' })
  @ApiResponse({ status: 200, description: 'Ride found', type: Ride })
  async getRide(
    @Param('id') id: string,
    @CurrentUser() currentUser: User,
  ): Promise<Ride> {
    const ride = await this.ridesService.getRide(id);
    // ISSUE-F: only the rider, the assigned driver, or an admin can see a ride.
    if (ride.riderId !== currentUser.id && ride.driverId !== currentUser.id) {
      throw new ForbiddenException('Access denied to this ride');
    }
    return ride;
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user rides' })
  @ApiResponse({ status: 200, description: 'Rides retrieved', type: [Ride] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUserRides(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: User,
    @Query('limit') limit?: number,
  ): Promise<Ride[]> {
    // ISSUE-G: users can only list their own rides.
    if (currentUser.id !== userId) {
      throw new ForbiddenException('You can only view your own rides');
    }
    return this.ridesService.getUserRides(userId, limit);
  }

  @Patch(':id/assign-driver')
  @ApiOperation({ summary: 'Assign driver to ride (PATCH)' })
  @ApiResponse({ status: 200, description: 'Driver assigned', type: Ride })
  async patchAssignDriver(
    @Param('id') rideId: string,
    @CurrentUser() currentUser: User,
    @Body('driverId') driverId: string,
    @Body('vehicleId') vehicleId: string,
  ): Promise<Ride> {
    // ISSUE-H: only the driver claiming the ride can assign themselves.
    if (currentUser.id !== driverId) {
      throw new ForbiddenException('You can only assign yourself as driver');
    }
    return this.ridesService.assignDriver(rideId, driverId, vehicleId);
  }

  @Put(':id/assign-driver')
  @ApiOperation({ summary: 'Assign driver to ride' })
  @ApiResponse({ status: 200, description: 'Driver assigned', type: Ride })
  async assignDriver(
    @Param('id') rideId: string,
    @CurrentUser() currentUser: User,
    @Body('driverId') driverId: string,
    @Body('vehicleId') vehicleId: string,
  ): Promise<Ride> {
    // ISSUE-H: only the driver claiming the ride can assign themselves.
    if (currentUser.id !== driverId) {
      throw new ForbiddenException('You can only assign yourself as driver');
    }
    return this.ridesService.assignDriver(rideId, driverId, vehicleId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update ride status (PATCH)' })
  @ApiResponse({ status: 200, description: 'Ride status updated', type: Ride })
  async patchRideStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: User,
    @Body() dto: UpdateRideStatusDto,
  ): Promise<Ride> {
    // ISSUE-I: only the rider or the assigned driver may update status.
    const ride = await this.ridesService.getRide(id);
    if (ride.riderId !== currentUser.id && ride.driverId !== currentUser.id) {
      throw new ForbiddenException('Access denied to this ride');
    }
    return this.ridesService.updateRideStatus(id, dto);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update ride status' })
  @ApiResponse({ status: 200, description: 'Ride status updated', type: Ride })
  async updateRideStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: User,
    @Body() dto: UpdateRideStatusDto,
  ): Promise<Ride> {
    // ISSUE-I: only the rider or the assigned driver may update status.
    const ride = await this.ridesService.getRide(id);
    if (ride.riderId !== currentUser.id && ride.driverId !== currentUser.id) {
      throw new ForbiddenException('Access denied to this ride');
    }
    return this.ridesService.updateRideStatus(id, dto);
  }

  @Post(':id/verify-rider-pin')
  @ApiOperation({ summary: 'Verify rider PIN' })
  @ApiResponse({ status: 200, description: 'PIN verification result' })
  async verifyRiderPIN(
    @Param('id') rideId: string,
    @CurrentUser() currentUser: User,
    @Body() dto: VerifyPINDto,
  ): Promise<{ verified: boolean }> {
    // ISSUE-J: only the assigned driver should verify the rider's PIN.
    const ride = await this.ridesService.getRide(rideId);
    if (ride.driverId !== currentUser.id) {
      throw new ForbiddenException('Only the assigned driver can verify the rider PIN');
    }
    return this.ridesService.verifyRiderPIN(rideId, dto);
  }

  @Post(':id/verify-driver-pin')
  @ApiOperation({ summary: 'Verify driver PIN' })
  @ApiResponse({ status: 200, description: 'PIN verification result' })
  async verifyDriverPIN(
    @Param('id') rideId: string,
    @CurrentUser() currentUser: User,
    @Body() dto: VerifyPINDto,
  ): Promise<{ verified: boolean }> {
    // ISSUE-J: only the rider should verify the driver's PIN.
    const ride = await this.ridesService.getRide(rideId);
    if (ride.riderId !== currentUser.id) {
      throw new ForbiddenException('Only the rider can verify the driver PIN');
    }
    return this.ridesService.verifyDriverPIN(rideId, dto);
  }

  @Post(':id/track')
  @ApiOperation({ summary: 'Track ride location' })
  @ApiResponse({ status: 201, description: 'Location tracked', type: RideTracking })
  async trackRide(
    @Param('id') rideId: string,
    @Body('location') location: { lat: number; lng: number },
  ): Promise<RideTracking> {
    return this.ridesService.trackRide(rideId, location);
  }

  @Get(':id/tracking')
  @ApiOperation({ summary: 'Get ride tracking history' })
  @ApiResponse({ status: 200, description: 'Tracking history retrieved', type: [RideTracking] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRideTracking(
    @Param('id') rideId: string,
    @Query('limit') limit?: number,
  ): Promise<RideTracking[]> {
    return this.ridesService.getRideTracking(rideId, limit);
  }

  @Post('wait-time/start')
  @ApiOperation({ summary: 'Start wait time tracking' })
  @ApiResponse({ status: 201, description: 'Wait time tracking started', type: WaitTimeTracking })
  async startWaitTime(
    @Body('rideId') rideId: string,
    @Body('userId') userId: string,
    @Body('reason') reason?: string,
  ): Promise<WaitTimeTracking> {
    return this.ridesService.startWaitTime(rideId, userId, reason);
  }

  @Put('wait-time/:id/end')
  @ApiOperation({ summary: 'End wait time tracking' })
  @ApiResponse({ status: 200, description: 'Wait time tracking ended', type: WaitTimeTracking })
  async endWaitTime(@Param('id') waitTimeId: string): Promise<WaitTimeTracking> {
    return this.ridesService.endWaitTime(waitTimeId);
  }

  @Post('feedback')
  @ApiOperation({ summary: 'Create ride feedback' })
  @ApiResponse({ status: 201, description: 'Feedback created', type: RideFeedback })
  async createFeedback(
    @CurrentUser('id') reviewerId: string,
    @Body() dto: CreateRideFeedbackDto,
  ): Promise<RideFeedback> {
    return this.ridesService.createFeedback(reviewerId, dto);
  }

  @Get(':id/feedback')
  @ApiOperation({ summary: 'Get ride feedback' })
  @ApiResponse({ status: 200, description: 'Feedback retrieved', type: [RideFeedback] })
  async getRideFeedback(@Param('id') rideId: string): Promise<RideFeedback[]> {
    return this.ridesService.getRideFeedback(rideId);
  }

  @Post('referrals')
  @ApiOperation({ summary: 'Create ride referral' })
  @ApiResponse({ status: 201, description: 'Referral created', type: RideReferral })
  async createReferral(
    @CurrentUser('id') referrerId: string,
    @Body('refereeId') refereeId: string,
  ): Promise<RideReferral> {
    return this.ridesService.createReferral(referrerId, refereeId);
  }

  @Put('referrals/:id/complete')
  @ApiOperation({ summary: 'Complete referral' })
  @ApiResponse({ status: 200, description: 'Referral completed', type: RideReferral })
  async completeReferral(
    @Param('id') referralId: string,
    @Body('rideId') rideId: string,
  ): Promise<RideReferral> {
    return this.ridesService.completeReferral(referralId, rideId);
  }

  @Post('sos')
  @ApiOperation({ summary: 'Create SOS alert' })
  @ApiResponse({ status: 201, description: 'SOS alert created', type: RideSOSAlert })
  async createSOSAlert(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSOSAlertDto,
  ): Promise<RideSOSAlert> {
    return this.ridesService.createSOSAlert(userId, dto);
  }

  @Put('sos/:id/resolve')
  @ApiOperation({ summary: 'Resolve SOS alert' })
  @ApiResponse({ status: 200, description: 'SOS alert resolved', type: RideSOSAlert })
  async resolveSOSAlert(
    @Param('id') alertId: string,
    @Body('resolutionNotes') resolutionNotes: string,
  ): Promise<RideSOSAlert> {
    return this.ridesService.resolveSOSAlert(alertId, resolutionNotes);
  }
}
