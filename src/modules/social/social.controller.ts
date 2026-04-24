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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
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

@ApiTags('Social')
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  /**
   * Resolves user identity from explicit query param or JWT token.
   * Query param takes precedence for backward compatibility.
   */
  private resolveUserId(explicit: string | undefined, req: any): string {
    return explicit || req?.user?.id || 'system';
  }

  // HeyYa Requests
  @Post('heyya')
  @ApiOperation({ summary: 'Send HeyYa request' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Request sent successfully' })
  @ApiQuery({
    name: 'senderId',
    required: false,
    description: 'Sender ID (falls back to JWT user)',
  })
  createHeyYaRequest(
    @Body() dto: CreateHeyYaRequestDto,
    @Query('senderId') senderId: string,
    @Req() req: any,
  ) {
    return this.socialService.createHeyYaRequest(this.resolveUserId(senderId, req), dto);
  }

  @Patch('heyya/:id/respond')
  @ApiOperation({ summary: 'Respond to HeyYa request (PATCH)' })
  @ApiQuery({
    name: 'recipientId',
    required: false,
    description: 'Recipient ID (falls back to JWT user)',
  })
  patchRespondToHeyYa(
    @Param('id') id: string,
    @Query('recipientId') recipientId: string,
    @Body('accept') accept: boolean,
    @Req() req: any,
  ) {
    return this.socialService.respondToHeyYa(id, this.resolveUserId(recipientId, req), accept);
  }

  @Put('heyya/:id/respond')
  @ApiOperation({ summary: 'Respond to HeyYa request' })
  @ApiQuery({
    name: 'recipientId',
    required: false,
    description: 'Recipient ID (falls back to JWT user)',
  })
  respondToHeyYa(
    @Param('id') id: string,
    @Query('recipientId') recipientId: string,
    @Body('accept') accept: boolean,
    @Req() req: any,
  ) {
    return this.socialService.respondToHeyYa(id, this.resolveUserId(recipientId, req), accept);
  }

  @Get('heyya')
  @ApiOperation({ summary: 'Get HeyYa requests' })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID (falls back to JWT user)' })
  @ApiQuery({ name: 'asSender', required: false, type: Boolean })
  getHeyYaRequests(
    @Query('userId') userId: string,
    @Query('asSender') asSender?: string,
    @Req() req?: any,
  ) {
    return this.socialService.getHeyYaRequests(
      this.resolveUserId(userId, req),
      asSender ? asSender === 'true' : undefined,
    );
  }

  // Chat
  @Get('chat/sessions')
  @ApiOperation({ summary: 'Get user chat sessions' })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID (falls back to JWT user)' })
  getChatSessions(@Query('userId') userId: string, @Req() req?: any) {
    return this.socialService.getChatSessions(this.resolveUserId(userId, req));
  }

  @Post('chat/sessions')
  @ApiOperation({ summary: 'Get or create chat session' })
  getOrCreateChatSession(@Body('user1Id') user1Id: string, @Body('user2Id') user2Id: string) {
    return this.socialService.getOrCreateChatSession(user1Id, user2Id);
  }

  @Post('chat/messages')
  @ApiOperation({ summary: 'Send chat message' })
  @ApiQuery({
    name: 'senderId',
    required: false,
    description: 'Sender ID (falls back to JWT user)',
  })
  sendMessage(@Body() dto: SendMessageDto, @Query('senderId') senderId: string, @Req() req?: any) {
    return this.socialService.sendMessage(this.resolveUserId(senderId, req), dto);
  }

  @Get('chat/sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Get chat messages' })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID (falls back to JWT user)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getChatMessages(
    @Param('sessionId') sessionId: string,
    @Query('userId') userId: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    return this.socialService.getChatMessages(
      sessionId,
      this.resolveUserId(userId, req),
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Put('chat/sessions/:sessionId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark messages as read' })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID (falls back to JWT user)' })
  markMessagesAsRead(
    @Param('sessionId') sessionId: string,
    @Query('userId') userId: string,
    @Req() req?: any,
  ) {
    return this.socialService.markMessagesAsRead(sessionId, this.resolveUserId(userId, req));
  }

  // Updates
  @Post('updates')
  @ApiOperation({ summary: 'Create update' })
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  createUpdate(
    @Body() dto: CreateUpdateDto,
    @Query('authorId') authorId: string,
    @Req() req?: any,
  ) {
    return this.socialService.createUpdate(this.resolveUserId(authorId, req), dto);
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
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  updateUpdate(
    @Param('id') id: string,
    @Query('authorId') authorId: string,
    @Body() dto: UpdateUpdateDto,
    @Req() req?: any,
  ) {
    return this.socialService.updateUpdate(id, this.resolveUserId(authorId, req), dto);
  }

  @Delete('updates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete update' })
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  deleteUpdate(@Param('id') id: string, @Query('authorId') authorId: string, @Req() req?: any) {
    return this.socialService.deleteUpdate(id, this.resolveUserId(authorId, req));
  }

  // Comments
  @Post('comments')
  @ApiOperation({ summary: 'Create comment' })
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  createComment(
    @Body() dto: CreateCommentDto,
    @Query('authorId') authorId: string,
    @Req() req?: any,
  ) {
    return this.socialService.createComment(this.resolveUserId(authorId, req), dto);
  }

  @Get('updates/:updateId/comments')
  @ApiOperation({ summary: 'Get comments for update' })
  getComments(@Param('updateId') updateId: string) {
    return this.socialService.getComments(updateId);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete comment' })
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  deleteComment(@Param('id') id: string, @Query('authorId') authorId: string, @Req() req?: any) {
    return this.socialService.deleteComment(id, this.resolveUserId(authorId, req));
  }

  // Engagements
  @Post('engagements')
  @ApiOperation({ summary: 'Create engagement (like, share, etc.)' })
  @ApiQuery({ name: 'userId', required: false, description: 'User ID (falls back to JWT user)' })
  createEngagement(
    @Body() dto: CreateEngagementDto,
    @Query('userId') userId: string,
    @Req() req?: any,
  ) {
    return this.socialService.createEngagement(this.resolveUserId(userId, req), dto);
  }

  @Delete('engagements')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove engagement' })
  @ApiQuery({ name: 'userId', required: true })
  @ApiQuery({ name: 'targetType', required: true, enum: EngagementTarget })
  @ApiQuery({ name: 'targetId', required: true })
  @ApiQuery({ name: 'type', required: true, enum: EngagementType })
  removeEngagement(
    @Query('userId') userId: string,
    @Query('targetType') targetType: EngagementTarget,
    @Query('targetId') targetId: string,
    @Query('type') type: EngagementType,
    @Req() req?: any,
  ) {
    return this.socialService.removeEngagement(
      this.resolveUserId(userId, req),
      targetType,
      targetId,
      type,
    );
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
  @ApiQuery({
    name: 'senderId',
    required: false,
    description: 'Sender ID (falls back to JWT user)',
  })
  sendMessageInSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: SendMessageDto,
    @Query('senderId') senderId: string,
    @Req() req?: any,
  ) {
    dto.sessionId = sessionId;
    return this.socialService.sendMessage(this.resolveUserId(senderId, req), dto);
  }

  @Post('updates/:updateId/comments')
  @ApiOperation({ summary: 'Create comment on update (update-scoped path)' })
  @ApiQuery({
    name: 'authorId',
    required: false,
    description: 'Author ID (falls back to JWT user)',
  })
  createCommentOnUpdate(
    @Param('updateId') updateId: string,
    @Body() dto: CreateCommentDto,
    @Query('authorId') authorId: string,
    @Req() req?: any,
  ) {
    dto.updateId = updateId;
    return this.socialService.createComment(this.resolveUserId(authorId, req), dto);
  }

  // Content Reports
  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a content item (update, comment, user)' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Report submitted successfully' })
  @ApiQuery({
    name: 'reporterId',
    required: false,
    description: 'Reporter ID (falls back to JWT user)',
  })
  createReport(
    @Body() dto: CreateReportDto,
    @Query('reporterId') reporterId: string,
    @Req() req?: any,
  ) {
    return this.socialService.createReport(this.resolveUserId(reporterId, req), dto);
  }
}
