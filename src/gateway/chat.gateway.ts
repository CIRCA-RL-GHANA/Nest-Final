import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket, Namespace } from 'socket.io';
import { ChatService } from '../modules/social/services/chat.service';
import { JwtService } from '@nestjs/jwt';

interface SocketUser {
  id: string;
  phoneNumber: string;
  username: string;
}

@Injectable()
@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private userConnections = new Map<string, Set<string>>();

  server: Namespace;

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Handle client connection with JWT validation
   */
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Connection refused: no token`);
        client.disconnect();
        return;
      }

      // Validate JWT
      const jwtSecret = this.configService.get<string>('jwt.secret');
      if (!jwtSecret) {
        this.logger.error('JWT_SECRET is not configured — refusing WebSocket connection');
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token, { secret: jwtSecret });

      const user: SocketUser = {
        id: payload.sub,
        phoneNumber: payload.phoneNumber,
        username: payload.socialUsername,
      };

      client.data.user = user;

      if (!this.userConnections.has(user.id)) {
        this.userConnections.set(user.id, new Set());
      }
      this.userConnections.get(user.id)!.add(client.id);

      client.join(`user:${user.id}`);

      this.logger.log(`User ${user.id} connected. Active: ${this.getActiveConnections()}`);

      client.emit('connection:confirmed', {
        userId: user.id,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect();
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser;

    if (user) {
      const connections = this.userConnections.get(user.id);
      if (connections) {
        connections.delete(client.id);
        if (connections.size === 0) {
          this.userConnections.delete(user.id);
          this.broadcastUserStatus(user.id, 'offline');
        }
      }

      this.logger.log(`User ${user.id} disconnected. Active: ${this.getActiveConnections()}`);
    }
  }

  /**
   * Send message to conversation
   */
  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      type: string;
      attachments?: string[];
    },
  ) {
    try {
      const user = client.data.user as SocketUser;

      if (!payload.conversationId || !payload.content?.trim()) {
        throw new WsException('Invalid message payload');
      }

      const message = await this.chatService.createMessage({
        senderId: user.id,
        conversationId: payload.conversationId,
        content: payload.content.trim(),
        type: payload.type || 'text',
        attachmentUrls: payload.attachments || [],
      });

      const conversation = await this.chatService.getConversation(payload.conversationId);
      const participantIds = conversation.participants.map((p) => p.id);

      for (const participantId of participantIds) {
        this.server.to(`user:${participantId}`).emit('message:new', {
          ...message,
          senderName: user.username,
          sendPhoneNumber: user.phoneNumber,
        });
      }

      client.emit('message:ack', {
        id: message.id,
        timestamp: message.createdAt,
      });

      this.logger.debug(`Message: ${message.id} → ${payload.conversationId}`);
    } catch (error) {
      client.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        code: 'MESSAGE_SEND_ERROR',
      });
    }
  }

  /**
   * Typing indicator start
   */
  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const user = client.data.user as SocketUser;

    client.to(`conversation:${payload.conversationId}`).emit('user:typing', {
      userId: user.id,
      username: user.username,
      conversationId: payload.conversationId,
    });
  }

  /**
   * Typing indicator stop
   */
  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const user = client.data.user as SocketUser;

    client.to(`conversation:${payload.conversationId}`).emit('user:stopped-typing', {
      userId: user.id,
      conversationId: payload.conversationId,
    });
  }

  /**
   * Mark message as read
   */
  @SubscribeMessage('message:read')
  async handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string },
  ) {
    const user = client.data.user as SocketUser;

    await this.chatService.markMessageAsRead(payload.messageId, user.id);

    const message = await this.chatService.getMessage(payload.messageId);
    this.server.to(`user:${message.senderId}`).emit('message:read-receipt', {
      messageId: payload.messageId,
      readBy: user.id,
      readAt: new Date(),
    });
  }

  /**
   * Delete message
   */
  @SubscribeMessage('message:delete')
  async handleMessageDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string },
  ) {
    try {
      const user = client.data.user as SocketUser;

      const message = await this.chatService.deleteMessage(payload.messageId, user.id);

      this.server.to(`conversation:${message.conversationId}`).emit('message:deleted', {
        messageId: message.id,
        conversationId: message.conversationId,
        deletedAt: new Date(),
      });
    } catch (error) {
      client.emit('error', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Join conversation room
   */
  @SubscribeMessage('conversation:join')
  handleConversationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const user = client.data.user as SocketUser;
    client.join(`conversation:${payload.conversationId}`);
    this.logger.debug(`User ${user.id} joined conversation ${payload.conversationId}`);
  }

  /**
   * Leave conversation room
   */
  @SubscribeMessage('conversation:leave')
  handleConversationLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    client.leave(`conversation:${payload.conversationId}`);
  }

  /**
   * Broadcast user status
   */
  private broadcastUserStatus(userId: string, status: 'online' | 'offline'): void {
    this.server.emit('user:status-changed', {
      userId,
      status,
      timestamp: new Date(),
    });
  }

  private getActiveConnections(): number {
    return Array.from(this.userConnections.values()).reduce((sum, set) => sum + set.size, 0);
  }
}
