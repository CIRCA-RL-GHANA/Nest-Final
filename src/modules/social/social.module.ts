import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { ChatService } from './services/chat.service';
import { HeyYaRequest } from './entities/heyya-request.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { Update } from './entities/update.entity';
import { UpdateComment } from './entities/update-comment.entity';
import { Engagement } from './entities/engagement.entity';
import { ContentReport } from './entities/content-report.entity';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HeyYaRequest,
      ChatSession,
      ChatMessage,
      Update,
      UpdateComment,
      Engagement,
      ContentReport,
    ]),
    AIModule,
  ],
  controllers: [SocialController],
  providers: [SocialService, ChatService],
  exports: [SocialService, ChatService],
})
export class SocialModule {}
