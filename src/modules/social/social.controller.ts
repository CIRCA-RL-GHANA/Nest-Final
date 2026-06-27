import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { SocialService } from './social.service';
import { CreateHeyYaRequestDto } from './dto/create-heyya-request.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateVisibility } from './entities/update.entity';
import { EngagementType, EngagementTarget } from './entities/engagement.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Social')
@ApiBearerAuth()
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // HeyYa Requests
  @Post('heyya')
  @ApiOperation({ summary: 'Send HeyYa request' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Request sent successfully' })
  createHeyYaRequest(@Body() dto: CreateHeyYaRequestDto, @CurrentUser('id') senderId: string) {
    return this.socialService.createHeyYaRequest(senderId, dto);
  }

  @Patch('heyya/:id/respond')
  @ApiOperation({ summary: 'Respond to HeyYa request (PATCH)' })
  patchRespondToHeyYa(
    @Param('id') id: string,
    @Body('accept') accept: boolean,
    @CurrentUser('id') recipientId: string,
  ) {
    return this.socialService.respondToHeyYa(id, recipientId, accept);
  }

  @Put('heyya/:id/respond')
  @ApiOperation({ summary: 'Respond to HeyYa request' })
  respondToHeyYa(
    @Param('id') id: string,
    @Body('accept') accept: boolean,
    @CurrentUser('id') recipientId: string,
  ) {
    return this.socialService.respondToHeyYa(id, recipientId, accept);
  }

  @Get('heyya')
  @ApiOperation({ summary: 'Get HeyYa requests' })
  @ApiQuery({ name: 'asSender', required: false, type: Boolean })
  getHeyYaRequests(@CurrentUser('id') userId: string, @Query('asSender') asSender?: string) {
    return this.socialService.getHeyYaRequests(userId, asSender ? asSender === 'true' : undefined);
  }

  // Chat
  @Get('chat/sessions')
  @ApiOperation({ summary: 'Get user chat sessions' })
  getChatSessions(@CurrentUser('id') userId: string) {
    return this.socialService.getChatSessions(userId);
  }

  @Get('chat/sessions/:sessionId')
  @ApiOperation({ summary: 'Get a single chat session by ID' })
  getChatSessionById(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.socialService.getChatSessionById(sessionId, userId);
  }

  @Post('chat/sessions')
  @ApiOperation({ summary: 'Get or create chat session' })
  getOrCreateChatSession(
    @Body('user2Id') user2Id: string,
    @CurrentUser('id') currentUserId: string,
  ) {
    return this.socialService.getOrCreateChatSession(currentUserId, user2Id);
  }

  @Post('chat/messages')
  @ApiOperation({ summary: 'Send chat message' })
  sendMessage(@Body() dto: SendMessageDto, @CurrentUser('id') senderId: string) {
    return this.socialService.sendMessage(senderId, dto);
  }

  @Get('chat/sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Get chat messages' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getChatMessages(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.socialService.getChatMessages(sessionId, userId, limit ? parseInt(limit, 10) : 50);
  }

  @Put('chat/sessions/:sessionId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark messages as read' })
  markMessagesAsRead(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.socialService.markMessagesAsRead(sessionId, userId);
  }

  // Updates
  @Post('updates')
  @ApiOperation({ summary: 'Create update' })
  createUpdate(@Body() dto: CreateUpdateDto, @CurrentUser('id') authorId: string) {
    return this.socialService.createUpdate(authorId, dto);
  }

  @Get('updates')
  @ApiOperation({ summary: 'Get updates' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'visibility', required: false, enum: UpdateVisibility })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getUpdates(
    @Query('userId') userId?: string,
    @Query('visibility') visibility?: UpdateVisibility,
    @Query('limit') limit?: string,
  ) {
    return this.socialService.getUpdates(userId, visibility, limit ? parseInt(limit, 10) : 20);
  }

  @Get('updates/:id')
  @ApiOperation({ summary: 'Get update by ID' })
  getUpdateById(@Param('id') id: string) {
    return this.socialService.getUpdateById(id);
  }

  @Put('updates/:id')
  @ApiOperation({ summary: 'Update post' })
  updateUpdate(
    @Param('id') id: string,
    @Body() dto: UpdateUpdateDto,
    @CurrentUser('id') authorId: string,
  ) {
    return this.socialService.updateUpdate(id, authorId, dto);
  }

  @Delete('updates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete update' })
  deleteUpdate(@Param('id') id: string, @CurrentUser('id') authorId: string) {
    return this.socialService.deleteUpdate(id, authorId);
  }

  // Comments
  @Post('comments')
  @ApiOperation({ summary: 'Create comment' })
  createComment(@Body() dto: CreateCommentDto, @CurrentUser('id') authorId: string) {
    return this.socialService.createComment(authorId, dto);
  }

  @Get('updates/:updateId/comments')
  @ApiOperation({ summary: 'Get comments for update' })
  getComments(@Param('updateId') updateId: string) {
    return this.socialService.getComments(updateId);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete comment' })
  deleteComment(@Param('id') id: string, @CurrentUser('id') authorId: string) {
    return this.socialService.deleteComment(id, authorId);
  }

  // Engagements
  @Post('engagements')
  @ApiOperation({ summary: 'Create engagement (like, share, etc.)' })
  createEngagement(@Body() dto: CreateEngagementDto, @CurrentUser('id') userId: string) {
    return this.socialService.createEngagement(userId, dto);
  }

  @Delete('engagements')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove engagement' })
  @ApiQuery({ name: 'targetType', required: true, enum: EngagementTarget })
  @ApiQuery({ name: 'targetId', required: true })
  @ApiQuery({ name: 'type', required: true, enum: EngagementType })
  removeEngagement(
    @CurrentUser('id') userId: string,
    @Query('targetType') targetType: EngagementTarget,
    @Query('targetId') targetId: string,
    @Query('type') type: EngagementType,
  ) {
    return this.socialService.removeEngagement(userId, targetType, targetId, type);
  }

  @Get('users/:userId/engagements')
  @ApiOperation({ summary: 'Get user engagements' })
  @ApiQuery({ name: 'type', required: false, enum: EngagementType })
  getUserEngagements(@Param('userId') userId: string, @Query('type') type?: EngagementType) {
    return this.socialService.getUserEngagements(userId, type);
  }

  // === Additional endpoints for frontend parity ===

  @Post('chat/sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Send chat message (session-scoped path)' })
  sendMessageInSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('id') senderId: string,
  ) {
    dto.sessionId = sessionId;
    return this.socialService.sendMessage(senderId, dto);
  }

  @Post('updates/:updateId/comments')
  @ApiOperation({ summary: 'Create comment on update (update-scoped path)' })
  createCommentOnUpdate(
    @Param('updateId') updateId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser('id') authorId: string,
  ) {
    dto.updateId = updateId;
    return this.socialService.createComment(authorId, dto);
  }

  // Content Reports
  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a content item (update, comment, user)' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Report submitted successfully' })
  createReport(@Body() dto: CreateReportDto, @CurrentUser('id') reporterId: string) {
    return this.socialService.createReport(reporterId, dto);
  }
}
