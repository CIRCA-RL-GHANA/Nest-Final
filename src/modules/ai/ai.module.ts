import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { AIModel } from './entities/ai-model.entity';
import { AIInference } from './entities/ai-inference.entity';
import { AIFeature } from './entities/ai-feature.entity';
import { AIRecommendation } from './entities/ai-recommendation.entity';
import { AIWorkflow } from './entities/ai-workflow.entity';
import { AIEvent } from './entities/ai-event.entity';
import { AIPlugin } from './entities/ai-plugin.entity';
import { AINlpService } from './services/ai-nlp.service';
import { AIPricingService } from './services/ai-pricing.service';
import { AIFraudService } from './services/ai-fraud.service';
import { AIInsightsService } from './services/ai-insights.service';
import { AISearchService } from './services/ai-search.service';
import { AIRecommendationsService } from './services/ai-recommendations.service';
import { AITensorflowService } from './services/ai-tensorflow.service';
import { WorkflowOrchestratorService } from './services/workflow-orchestrator.service';
import { FeatureStoreService } from './services/feature-store.service';
import { EtlService } from './services/etl.service';
import { PluginService } from './services/plugin.service';
import { EventBusService } from './services/event-bus.service';
import { ModelProvenanceService } from './services/model-provenance.service';
import { LlmService } from './services/llm.service';
import { AiInputSanitizerGuard } from '../../common/guards/ai-input-sanitizer.guard';
import { EtlProcessor } from './processors/etl.processor';
import { EventBusProcessor } from './processors/event-bus.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AIModel,
      AIInference,
      AIFeature,
      AIRecommendation,
      AIWorkflow,
      AIEvent,
      AIPlugin,
    ]),
    BullModule.registerQueue(
      { name: 'etl-pipeline' },
      { name: 'event-bus' },
    ),
    HttpModule,
  ],
  controllers: [AIController],
  providers: [
    AIService,
    AINlpService,
    AIPricingService,
    AIFraudService,
    AIInsightsService,
    AISearchService,
    AIRecommendationsService,
    AITensorflowService,
    WorkflowOrchestratorService,
    FeatureStoreService,
    EtlService,
    PluginService,
    EventBusService,
    EtlProcessor,
    EventBusProcessor,
    ModelProvenanceService,
    AiInputSanitizerGuard,
    LlmService,
  ],
  exports: [
    AIService,
    AINlpService,
    AIPricingService,
    AIFraudService,
    AIInsightsService,
    AISearchService,
    AIRecommendationsService,
    AITensorflowService,
    WorkflowOrchestratorService,
    FeatureStoreService,
    EtlService,
    ModelProvenanceService,
    PluginService,
    EventBusService,
    LlmService,
  ],
})
export class AIModule {}
