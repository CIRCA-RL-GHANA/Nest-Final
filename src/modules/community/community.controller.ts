import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { CommunityService } from './community.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CommunityType } from './entities/community.entity';

class BanMemberDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}

@ApiTags('community')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // ── Discovery ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Discover public communities (all 7 types)' })
  @ApiQuery({ name: 'type', required: false, enum: CommunityType })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  discover(
    @Query('type') type?: CommunityType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.communityService.discoverCommunities(type, page, limit);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get communities I have joined' })
  getMyMemberships(@Request() req: any) {
    return this.communityService.getMyMemberships(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get community details' })
  getCommunity(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.getCommunityById(id, req.user.id);
  }

  // ── Create ───────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new community (Library, Playlist, Theater, Fair, Hub, Hangout, or Journal)' })
  createCommunity(@Request() req: any, @Body() dto: CreateCommunityDto) {
    return this.communityService.createCommunity(req.user.id, dto);
  }

  // ── Membership ───────────────────────────────────────────────────────────

  @Post(':id/join')
  @ApiOperation({ summary: 'Join a public community' })
  join(@Request() req: any, @Param('id', ParseUUIDPipe) communityId: string) {
    return this.communityService.join(req.user.id, communityId);
  }

  @Delete(':id/leave')
  @ApiOperation({ summary: 'Leave a community' })
  leave(@Request() req: any, @Param('id', ParseUUIDPipe) communityId: string) {
    return this.communityService.leave(req.user.id, communityId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List members of a community' })
  getMembers(
    @Param('id', ParseUUIDPipe) communityId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return this.communityService.getMembers(communityId, page, limit);
  }

  @Patch(':id/members/:userId/ban')
  @ApiOperation({ summary: 'Ban a member from the community (admin / moderator only)' })
  banMember(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: BanMemberDto,
  ) {
    return this.communityService.banMember(req.user.id, communityId, targetUserId, dto.reason);
  }

  // ── Posts / Feed ─────────────────────────────────────────────────────────

  @Post(':id/posts')
  @ApiOperation({ summary: 'Create a post in a community' })
  createPost(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Body() dto: CreatePostDto,
  ) {
    return this.communityService.createPost(req.user.id, communityId, dto);
  }

  @Get(':id/posts')
  @ApiOperation({ summary: 'Get the post feed for a community' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getFeed(
    @Param('id', ParseUUIDPipe) communityId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit = 30,
  ) {
    return this.communityService.getFeed(communityId, page, limit);
  }

  @Delete(':id/posts/:postId')
  @ApiOperation({ summary: 'Remove a post (moderator action)' })
  removePost(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) communityId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    return this.communityService.removePost(req.user.id, communityId, postId);
  }

  // ── Enterprise Brand View ────────────────────────────────────────────

  /**
   * Enterprise admins and platform admins can view all communities
   * created by/linked to a specific brand entity.
   */
  @Get('brand/:entityId')
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.ENTERPRISE_ADMIN,
    UserRole.ENTERPRISE_OPERATOR,
    UserRole.ENTERPRISE_VIEWER,
    UserRole.FINANCIAL_INSTITUTION,
    UserRole.FI_AUDITOR,
    UserRole.ADMIN,
  )
  @ApiOperation({ summary: '[Enterprise] Get communities owned by/linked to a brand entity' })
  getBrandCommunities(@Param('entityId', ParseUUIDPipe) entityId: string) {
    return this.communityService.getByOwner(entityId);
  }
}
