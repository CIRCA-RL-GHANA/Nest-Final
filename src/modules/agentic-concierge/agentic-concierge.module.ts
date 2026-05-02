import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConciergeSession, ConciergeMessage } from './entities/concierge.entity';
import { AgenticConciergeService } from './agentic-concierge.service';
import { AgenticConciergeController } from './agentic-concierge.controller';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConciergeSession, ConciergeMessage]),
    AIModule,
  ],
  controllers: [AgenticConciergeController],
  providers: [AgenticConciergeService],
  exports: [AgenticConciergeService, TypeOrmModule],
})
export class AgenticConciergeModule {}
