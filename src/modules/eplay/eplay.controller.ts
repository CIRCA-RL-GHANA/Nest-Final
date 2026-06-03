import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { EplayService } from './eplay.service';
import { CreateDigitalAssetDto } from './dto/create-digital-asset.dto';
import { PurchaseAssetDto } from './dto/purchase-asset.dto';
import { CreateCreatorProfileDto } from './dto/create-creator-profile.dto';
import { DigitalAssetType } from './entities/digital-asset.entity';

@ApiTags('eplay')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('eplay')
export class EplayController {
  constructor(private readonly eplayService: EplayService) {}

  // ── Creator Onboarding ──────────────────────────────────────────────────

  @Post('creator/open')
  @ApiOperation({ summary: 'Open a creator (digital branch) profile' })
  openCreatorProfile(@CurrentUser() user: User, @Body() dto: CreateCreatorProfileDto) {
    return this.eplayService.openCreatorProfile(user.id, dto);
  }

  @Get('creator/me')
  @ApiOperation({ summary: 'Get my creator profile' })
  getMyCreatorProfile(@CurrentUser() user: User) {
    return this.eplayService.getMyCreatorProfile(user.id);
  }

  // ── Content Management ──────────────────────────────────────────────────

  @Post('assets')
  @ApiOperation({ summary: 'Upload a new digital asset (creator only)' })
  uploadAsset(@CurrentUser() user: User, @Body() dto: CreateDigitalAssetDto) {
    return this.eplayService.uploadAsset(user.id, dto);
  }

  @Patch('assets/:id/publish')
  @ApiOperation({ summary: 'Publish a draft asset (creator only)' })
  publishAsset(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) assetId: string,
  ) {
    return this.eplayService.publishAsset(user.id, assetId);
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  @Get('browse')
  @ApiOperation({ summary: 'Browse published digital assets' })
  @ApiQuery({ name: 'type', required: false, enum: DigitalAssetType })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  browseAssets(
    @Query('type') type?: DigitalAssetType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.eplayService.browseAssets(type, page, limit);
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Get a single asset detail' })
  getAssetById(@Param('id', ParseUUIDPipe) assetId: string) {
    return this.eplayService.getAssetById(assetId);
  }

  // ── Cloud Locker ────────────────────────────────────────────────────────

  @Post('locker/purchase')
  @ApiOperation({ summary: 'Purchase a digital asset — adds to cloud locker' })
  purchaseAsset(@CurrentUser() user: User, @Body() dto: PurchaseAssetDto) {
    return this.eplayService.purchaseAsset(user.id, dto);
  }

  @Get('locker')
  @ApiOperation({ summary: 'Get my cloud locker (purchased content)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getMyLocker(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.eplayService.getMyLocker(user.id, page, limit);
  }

  @Post('locker/:assetId/stream')
  @ApiOperation({ summary: 'Request a short-lived stream token for a licensed asset' })
  streamAsset(
    @CurrentUser() user: User,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.eplayService.streamAsset(user.id, assetId);
  }

  @Patch('locker/licenses/:licenseId/pin')
  @ApiOperation({ summary: 'Toggle offline pin on a license' })
  togglePin(
    @CurrentUser() user: User,
    @Param('licenseId', ParseUUIDPipe) licenseId: string,
  ) {
    return this.eplayService.togglePin(user.id, licenseId);
  }
}
