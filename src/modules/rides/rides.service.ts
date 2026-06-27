import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride, RideStatus } from './entities/ride.entity';
import { RideTracking } from './entities/ride-tracking.entity';
import { RideFeedback } from './entities/ride-feedback.entity';
import { RideReferral, ReferralStatus } from './entities/ride-referral.entity';
import { WaitTimeTracking } from './entities/wait-time-tracking.entity';
import { RideSOSAlert, SOSStatus } from './entities/ride-sos-alert.entity';
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { VerifyPINDto } from './dto/verify-pin.dto';
import { CreateRideFeedbackDto } from './dto/create-ride-feedback.dto';
import { CreateSOSAlertDto } from './dto/create-sos-alert.dto';
import { QPointsTransactionService } from '../qpoints/qpoints-transaction.service';
import { QPointAccount } from '../qpoints/entities/qpoint-account.entity';
import { AIPricingService } from '../ai/services/ai-pricing.service';
import { AINlpService } from '../ai/services/ai-nlp.service';
import { GoogleMapsService } from '../google-maps/google-maps.service';

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    @InjectRepository(RideTracking)
    private readonly trackingRepository: Repository<RideTracking>,
    @InjectRepository(RideFeedback)
    private readonly feedbackRepository: Repository<RideFeedback>,
    @InjectRepository(RideReferral)
    private readonly referralRepository: Repository<RideReferral>,
    @InjectRepository(WaitTimeTracking)
    private readonly waitTimeRepository: Repository<WaitTimeTracking>,
    @InjectRepository(RideSOSAlert)
    private readonly sosRepository: Repository<RideSOSAlert>,
    @InjectRepository(QPointAccount)
    private readonly qpointAccountRepository: Repository<QPointAccount>,
    private readonly qpointsService: QPointsTransactionService,
    private readonly aiPricing: AIPricingService,
    private readonly aiNlp: AINlpService,
    private readonly googleMaps: GoogleMapsService,
  ) {}

  async createRide(riderId: string, dto: CreateRideDto): Promise<Ride> {
    const rideNumber = `RIDE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;

    // Generate PINs for dual verification
    const riderPIN = String(Math.floor(Math.random() * 900000) + 100000);
    const driverPIN = String(Math.floor(Math.random() * 900000) + 100000);

    // Calculate AI-powered dynamic fare using real road distance
    const { distanceKm: distance } = await this.googleMaps.getDistanceAndDuration(
      { lat: dto.pickupLocation.lat, lng: dto.pickupLocation.lng },
      { lat: dto.dropoffLocation.lat, lng: dto.dropoffLocation.lng },
    );
    const aiPrice = this.aiPricing.computeRidePrice(
      {
        baseDistance: distance,
        pickupLat: dto.pickupLocation.lat,
        pickupLng: dto.pickupLocation.lng,
        dropoffLat: dto.dropoffLocation.lat,
        dropoffLng: dto.dropoffLocation.lng,
        rideType: dto.rideType,
        requestedAt: new Date(),
      },
      // demand/supply loaded externally; defaults to 1.0 for now
    );
    const estimatedFare = aiPrice.finalPrice;
    this.logger.log(
      `AI pricing for ride: dist=${distance.toFixed(2)}km surge=${aiPrice.surgeMultiplier}x fare=${estimatedFare}`,
    );

    const ride = this.rideRepository.create({
      rideNumber,
      riderId,
      rideType: dto.rideType,
      status: RideStatus.REQUESTED,
      pickupLocation: dto.pickupLocation,
      dropoffLocation: dto.dropoffLocation,
      estimatedDistance: distance,
      estimatedFare,
      scheduledPickupTime: dto.scheduledPickupTime || null,
      voiceNoteUrl: dto.voiceNoteUrl || null,
      notes: dto.notes || null,
      riderPIN,
      driverPIN,
    });

    return this.rideRepository.save(ride);
  }

  async assignDriver(rideId: string, driverId: string, vehicleId: string): Promise<Ride> {
    const ride = await this.getRide(rideId);

    if (ride.status !== RideStatus.REQUESTED) {
      throw new BadRequestException('Ride is not available for assignment');
    }

    ride.driverId = driverId;
    ride.vehicleId = vehicleId;
    ride.status = RideStatus.DRIVER_ASSIGNED;

    return this.rideRepository.save(ride);
  }

  async updateRideStatus(rideId: string, dto: UpdateRideStatusDto): Promise<Ride> {
    const ride = await this.getRide(rideId);

    const validTransitions: Partial<Record<RideStatus, RideStatus[]>> = {
      [RideStatus.REQUESTED]: [RideStatus.DRIVER_ASSIGNED, RideStatus.CANCELLED],
      [RideStatus.DRIVER_ASSIGNED]: [RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED],
      [RideStatus.DRIVER_ARRIVED]: [RideStatus.RIDE_STARTED, RideStatus.CANCELLED],
      [RideStatus.RIDE_STARTED]: [RideStatus.RIDE_COMPLETED],
    };

    const allowed = validTransitions[ride.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition ride from '${ride.status}' to '${dto.status}'`,
      );
    }

    ride.status = dto.status;

    if (dto.status === RideStatus.DRIVER_ARRIVED) {
      ride.driverArrivedAt = new Date();
    }

    if (dto.status === RideStatus.RIDE_STARTED) {
      ride.rideStartedAt = new Date();
    }

    if (dto.status === RideStatus.RIDE_COMPLETED) {
      ride.rideCompletedAt = new Date();

      // Calculate final fare with wait time charges
      ride.finalFare = (ride.estimatedFare || 0) + ride.waitTimeCharges;
    }

    return this.rideRepository.save(ride);
  }

  async verifyRiderPIN(rideId: string, dto: VerifyPINDto): Promise<{ verified: boolean }> {
    const ride = await this.getRide(rideId);

    const attempts: number = (ride.metadata?.riderPinAttempts ?? 0);
    if (attempts >= 5) {
      throw new BadRequestException('Too many PIN attempts. Please request a new ride.');
    }

    if (ride.riderPIN === dto.pin) {
      ride.riderPINVerified = true;
      ride.metadata = { ...ride.metadata, riderPinAttempts: 0 };
      await this.rideRepository.save(ride);
      return { verified: true };
    }

    ride.metadata = { ...ride.metadata, riderPinAttempts: attempts + 1 };
    await this.rideRepository.save(ride);
    return { verified: false };
  }

  async verifyDriverPIN(rideId: string, dto: VerifyPINDto): Promise<{ verified: boolean }> {
    const ride = await this.getRide(rideId);

    const attempts: number = (ride.metadata?.driverPinAttempts ?? 0);
    if (attempts >= 5) {
      throw new BadRequestException('Too many PIN attempts. Please request a new ride.');
    }

    if (ride.driverPIN === dto.pin) {
      ride.driverPINVerified = true;
      ride.metadata = { ...ride.metadata, driverPinAttempts: 0 };
      await this.rideRepository.save(ride);
      return { verified: true };
    }

    ride.metadata = { ...ride.metadata, driverPinAttempts: attempts + 1 };
    await this.rideRepository.save(ride);
    return { verified: false };
  }

  async trackRide(rideId: string, location: { lat: number; lng: number }): Promise<RideTracking> {
    const ride = await this.getRide(rideId);

    const { distanceKm: distanceToDestination, durationMinutes: etaMinutes } =
      await this.googleMaps.getDistanceAndDuration(
        { lat: location.lat, lng: location.lng },
        { lat: ride.dropoffLocation.lat, lng: ride.dropoffLocation.lng },
      );

    const tracking = this.trackingRepository.create({
      rideId,
      location,
      distanceToDestination,
      etaMinutes,
    });

    return this.trackingRepository.save(tracking);
  }

  async getRideTracking(rideId: string, limit = 50): Promise<RideTracking[]> {
    return this.trackingRepository.find({
      where: { rideId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async startWaitTime(rideId: string, userId: string, reason?: string): Promise<WaitTimeTracking> {
    const waitTime = this.waitTimeRepository.create({
      rideId,
      userId,
      waitStartTime: new Date(),
      chargePerMinute: 0.5, // QPoints per minute
      reason: reason || null,
    });

    return this.waitTimeRepository.save(waitTime);
  }

  async endWaitTime(waitTimeId: string): Promise<WaitTimeTracking> {
    const waitTime = await this.waitTimeRepository.findOne({ where: { id: waitTimeId } });
    if (!waitTime) {
      throw new NotFoundException('Wait time tracking not found');
    }

    const endTime = new Date();
    const waitMinutes = Math.ceil(
      (endTime.getTime() - waitTime.waitStartTime.getTime()) / (1000 * 60),
    );
    const totalCharge = waitMinutes * Number(waitTime.chargePerMinute);

    waitTime.waitEndTime = endTime;
    waitTime.waitMinutes = waitMinutes;
    waitTime.totalCharge = totalCharge;
    waitTime.chargeApplied = true;

    // Update ride with wait time charges
    const ride = await this.getRide(waitTime.rideId);
    ride.waitTimeCharges += totalCharge;
    await this.rideRepository.save(ride);

    return this.waitTimeRepository.save(waitTime);
  }

  async createFeedback(reviewerId: string, dto: CreateRideFeedbackDto): Promise<RideFeedback> {
    const feedback = this.feedbackRepository.create({
      rideId: dto.rideId,
      reviewerId,
      revieweeId: dto.revieweeId,
      rating: dto.rating,
      comment: dto.comment || null,
      tags: dto.tags || null,
    });

    return this.feedbackRepository.save(feedback);
  }

  async getRideFeedback(rideId: string): Promise<RideFeedback[]> {
    return this.feedbackRepository.find({ where: { rideId } });
  }

  async createReferral(referrerId: string, refereeId: string): Promise<RideReferral> {
    const referralCode = `REF${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const referral = this.referralRepository.create({
      referrerId,
      refereeId,
      referralCode,
      status: ReferralStatus.PENDING,
      referrerReward: 100, // QPoints
      refereeReward: 50,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    return this.referralRepository.save(referral);
  }

  async completeReferral(referralId: string, rideId: string): Promise<RideReferral> {
    const referral = await this.referralRepository.findOne({ where: { id: referralId } });
    if (!referral) {
      throw new NotFoundException('Referral not found');
    }

    referral.status = ReferralStatus.COMPLETED;
    referral.completionRideId = rideId;
    referral.completedAt = new Date();
    referral.referrerRewarded = true;
    referral.refereeRewarded = true;

    await this.referralRepository.save(referral);

    // Credit QPoints to referrer (100 QP) and referee (50 QP)
    const [referrerAccount, refereeAccount] = await Promise.all([
      this.qpointAccountRepository.findOne({ where: { entityId: referral.referrerId } }),
      this.qpointAccountRepository.findOne({ where: { entityId: referral.refereeId } }),
    ]);

    if (referrerAccount) {
      await this.qpointsService.deposit(
        {
          accountId: referrerAccount.id,
          amount: 100,
          paymentReference: `REFERRAL_REWARD_${referralId}`,
        },
        referral.referrerId,
      );
    }

    if (refereeAccount) {
      await this.qpointsService.deposit(
        {
          accountId: refereeAccount.id,
          amount: 50,
          paymentReference: `REFERRAL_SIGNUP_BONUS_${referralId}`,
        },
        referral.refereeId,
      );
    }

    return referral;
  }

  async createSOSAlert(userId: string, dto: CreateSOSAlertDto): Promise<RideSOSAlert> {
    const ride = await this.getRide(dto.rideId);

    const latestTracking = await this.trackingRepository.findOne({
      where: { rideId: dto.rideId },
      order: { createdAt: 'DESC' },
    });

    const location = latestTracking ? latestTracking.location : ride.pickupLocation;

    const alert = this.sosRepository.create({
      rideId: dto.rideId,
      userId,
      status: SOSStatus.ACTIVE,
      location,
      message: dto.message || null,
    });

    const savedAlert = await this.sosRepository.save(alert);

    // Emit structured critical log — ingested by monitoring (DataDog/Sentry/PagerDuty)
    // to trigger on-call notification for emergency support team
    this.logger.warn(
      JSON.stringify({
        event: 'SOS_ALERT_TRIGGERED',
        severity: 'CRITICAL',
        alertId: savedAlert.id,
        rideId: dto.rideId,
        userId,
        location,
        message: dto.message || null,
        riderName: ride.riderId,
        driverId: ride.driverId,
        timestamp: new Date().toISOString(),
      }),
    );

    return savedAlert;
  }

  async resolveSOSAlert(alertId: string, resolutionNotes: string): Promise<RideSOSAlert> {
    const alert = await this.sosRepository.findOne({ where: { id: alertId } });
    if (!alert) {
      throw new NotFoundException('SOS alert not found');
    }

    alert.status = SOSStatus.RESOLVED;
    alert.resolvedAt = new Date();
    alert.resolutionNotes = resolutionNotes;

    return this.sosRepository.save(alert);
  }

  async getRide(rideId: string): Promise<Ride> {
    const ride = await this.rideRepository.findOne({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  async getUserRides(userId: string, limit = 20): Promise<Ride[]> {
    return this.rideRepository.find({
      where: [{ riderId: userId }, { driverId: userId }],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

}
