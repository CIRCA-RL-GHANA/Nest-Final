import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AiInputSanitizerGuard } from '../../common/guards/ai-input-sanitizer.guard';
import { AIService } from './ai.service';
import { AINlpService } from './services/ai-nlp.service';
import { AIPricingService } from './services/ai-pricing.service';
import { AIFraudService } from './services/ai-fraud.service';
import { AIInsightsService } from './services/ai-insights.service';
import { AISearchService } from './services/ai-search.service';
import { AIRecommendationsService } from './services/ai-recommendations.service';
import { WorkflowOrchestratorService, WorkflowDefinition } from './services/workflow-orchestrator.service';
import { FeatureStoreService, FeatureRecord } from './services/feature-store.service';
import { EtlService } from './services/etl.service';
import { PluginService, RegisterPluginDto } from './services/plugin.service';
import { EventBusService } from './services/event-bus.service';
import { ModelProvenanceService } from './services/model-provenance.service';
import { CreateAIModelDto } from './dto/create-ai-model.dto';
import { CreateInferenceDto } from './dto/create-inference.dto';
import { GetRecommendationsDto } from './dto/get-recommendations.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { CreateAIEventDto } from './dto/create-ai-event.dto';
import { AIModel, ModelStatus } from './entities/ai-model.entity';
import { AIInference } from './entities/ai-inference.entity';
import { AIFeature } from './entities/ai-feature.entity';
import { AIRecommendation } from './entities/ai-recommendation.entity';
import { AIWorkflow, WorkflowStatus } from './entities/ai-workflow.entity';
import { AIEvent } from './entities/ai-event.entity';
import { PluginType, PluginStatus } from './entities/ai-plugin.entity';

@ApiTags('ai')
@Controller('ai')
@UseGuards(AiInputSanitizerGuard)
export class AIController {
  constructor(
    private readonly aiService: AIService,
    private readonly nlpService: AINlpService,
    private readonly pricingService: AIPricingService,
    private readonly fraudService: AIFraudService,
    private readonly insightsService: AIInsightsService,
    private readonly searchService: AISearchService,
    private readonly recommendationService: AIRecommendationsService,
    private readonly workflowOrchestrator: WorkflowOrchestratorService,
    private readonly featureStore: FeatureStoreService,
    private readonly etlService: EtlService,
    private readonly pluginService: PluginService,
    private readonly eventBus: EventBusService,
    private readonly modelProvenance: ModelProvenanceService,
  ) {}

  // ============ Model Provenance & Signing ============

  @Post('models/:id/sign')
  @ApiOperation({ summary: 'Sign a model artifact (MLOps pipeline use)' })
  @ApiResponse({ status: 201, description: 'Model signed' })
  signModel(
    @Param('id') id: string,
    @Body()
    body: {
      version: string;
      roleShard: string;
      sha256Hash: string;
      sizeBytes: number;
      trainedAt: string;
    },
  ) {
    return this.modelProvenance.sign({
      modelId: id,
      version: body.version,
      roleShard: body.roleShard,
      sha256Hash: body.sha256Hash,
      sizeBytes: body.sizeBytes,
      trainedAt: new Date(body.trainedAt),
    });
  }

  @Post('models/:id/verify')
  @ApiOperation({ summary: 'Client verifies model integrity before loading' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  verifyModel(
    @Param('id') id: string,
    @Body() body: { version: string; sha256Hash: string },
  ): { verified: boolean } {
    const verified = this.modelProvenance.verify(id, body.version, body.sha256Hash);
    return { verified };
  }

  @Get('models/provenance/active')
  @ApiOperation({ summary: 'Get active signed models for a role shard' })
  @ApiQuery({ name: 'roleShard', required: true, type: String })
  getActiveSignedModels(@Query('roleShard') roleShard: string) {
    return this.modelProvenance.getActive(roleShard);
  }

  @Post('models/:id/rollback')
  @ApiOperation({ summary: 'Roll back a model version (MLOps safety valve)' })
  rollbackModel(
    @Param('id') id: string,
    @Body() body: { version: string },
  ): { rolled_back: boolean } {
    this.modelProvenance.rollback(id, body.version);
    return { rolled_back: true };
  }

  // ============ Models ============

  @Post('models')
  @ApiOperation({ summary: 'Create new AI model' })
  @ApiResponse({ status: 201, description: 'Model created', type: AIModel })
  async createModel(@Body() dto: CreateAIModelDto): Promise<AIModel> {
    return this.aiService.createModel(dto);
  }

  @Get('models/:id')
  @ApiOperation({ summary: 'Get model by ID' })
  @ApiResponse({ status: 200, description: 'Model found', type: AIModel })
  async getModel(@Param('id') id: string): Promise<AIModel> {
    return this.aiService.getModel(id);
  }

  @Get('models')
  @ApiOperation({ summary: 'Get active models' })
  @ApiResponse({ status: 200, description: 'Models retrieved', type: [AIModel] })
  @ApiQuery({ name: 'type', required: false, type: String })
  async getActiveModels(@Query('type') type?: string): Promise<AIModel[]> {
    return this.aiService.getActiveModels(type);
  }

  @Put('models/:id/status')
  @ApiOperation({ summary: 'Update model status' })
  @ApiResponse({ status: 200, description: 'Model status updated', type: AIModel })
  async updateModelStatus(
    @Param('id') id: string,
    @Body('status') status: ModelStatus,
  ): Promise<AIModel> {
    return this.aiService.updateModelStatus(id, status);
  }

  @Put('models/:id/metrics')
  @ApiOperation({ summary: 'Update model metrics' })
  @ApiResponse({ status: 200, description: 'Model metrics updated', type: AIModel })
  async updateModelMetrics(
    @Param('id') id: string,
    @Body('metrics') metrics: Record<string, any>,
  ): Promise<AIModel> {
    return this.aiService.updateModelMetrics(id, metrics);
  }

  @Get('models/:id/stats')
  @ApiOperation({ summary: 'Get model statistics' })
  @ApiResponse({ status: 200, description: 'Model stats retrieved' })
  async getModelStats(@Param('id') id: string): Promise<any> {
    return this.aiService.getModelStats(id);
  }

  @Put('models/:id')
  @ApiOperation({ summary: 'Update AI model' })
  @ApiResponse({ status: 200, description: 'Model updated', type: AIModel })
  async updateModel(@Param('id') id: string, @Body() data: Record<string, any>): Promise<AIModel> {
    return this.aiService.updateModel(id, data);
  }

  // ============ Inference ============

  @Post('inferences')
  @ApiOperation({ summary: 'Create new inference' })
  @ApiResponse({ status: 201, description: 'Inference created', type: AIInference })
  async createInference(@Body() dto: CreateInferenceDto): Promise<AIInference> {
    return this.aiService.createInference(dto);
  }

  @Get('inferences')
  @ApiOperation({ summary: 'List all inferences' })
  @ApiResponse({ status: 200, description: 'Inferences retrieved', type: [AIInference] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listInferences(@Query('limit') limit?: number): Promise<AIInference[]> {
    return this.aiService.getInferences(limit);
  }

  @Get('inferences/model/:modelId')
  @ApiOperation({ summary: 'Get inferences by model ID' })
  @ApiResponse({ status: 200, description: 'Inferences retrieved', type: [AIInference] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getInferencesByModel(
    @Param('modelId') modelId: string,
    @Query('limit') limit?: number,
  ): Promise<AIInference[]> {
    return this.aiService.getInferencesByModel(modelId, limit);
  }

  @Get('inferences/entity/:entityType/:entityId')
  @ApiOperation({ summary: 'Get inferences by entity' })
  @ApiResponse({ status: 200, description: 'Inferences retrieved', type: [AIInference] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getInferencesByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: number,
  ): Promise<AIInference[]> {
    return this.aiService.getInferencesByEntity(entityType, entityId, limit);
  }

  @Get('inferences/:id')
  @ApiOperation({ summary: 'Get inference by ID' })
  @ApiResponse({ status: 200, description: 'Inference found', type: AIInference })
  async getInference(@Param('id') id: string): Promise<AIInference> {
    return this.aiService.getInference(id);
  }

  @Get('inferences/user/:userId')
  @ApiOperation({ summary: 'Get user inferences' })
  @ApiResponse({ status: 200, description: 'Inferences retrieved', type: [AIInference] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUserInferences(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
  ): Promise<AIInference[]> {
    return this.aiService.getUserInferences(userId, limit);
  }

  // ============ Features ============

  @Get('features/:entityType/:entityId')
  @ApiOperation({ summary: 'Get entity features' })
  @ApiResponse({ status: 200, description: 'Features retrieved', type: [AIFeature] })
  async getFeatures(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<AIFeature[]> {
    return this.aiService.getFeatures(entityType, entityId);
  }

  @Get('features/:entityType/:entityId/:featureName')
  @ApiOperation({ summary: 'Get specific feature' })
  @ApiResponse({ status: 200, description: 'Feature found', type: AIFeature })
  async getFeatureByName(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('featureName') featureName: string,
  ): Promise<AIFeature | null> {
    return this.aiService.getFeatureByName(entityType, entityId, featureName);
  }

  // ============ Recommendations ============

  @Get('recommendations')
  @ApiOperation({ summary: 'List all recommendations' })
  @ApiResponse({ status: 200, description: 'Recommendations retrieved', type: [AIRecommendation] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listRecommendations(@Query('limit') limit?: number): Promise<AIRecommendation[]> {
    return this.aiService.getRecommendations(limit);
  }

  @Get('recommendations/entity/:entityType/:entityId')
  @ApiOperation({ summary: 'Get recommendations for entity' })
  @ApiResponse({ status: 200, description: 'Recommendations retrieved', type: [AIRecommendation] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getRecommendationsForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: number,
  ): Promise<AIRecommendation[]> {
    return this.aiService.getRecommendationsForEntity(entityType, entityId, limit);
  }

  @Post('recommendations')
  @ApiOperation({ summary: 'Generate recommendations' })
  @ApiResponse({ status: 201, description: 'Recommendations generated', type: [AIRecommendation] })
  async generateRecommendations(@Body() dto: GetRecommendationsDto): Promise<AIRecommendation[]> {
    return this.aiService.generateRecommendations(dto);
  }

  @Put('recommendations/:id/view')
  @ApiOperation({ summary: 'Track recommendation view' })
  @ApiResponse({ status: 200, description: 'View tracked' })
  async trackRecommendationView(@Param('id') id: string): Promise<void> {
    return this.aiService.trackRecommendationView(id);
  }

  @Put('recommendations/:id/click')
  @ApiOperation({ summary: 'Track recommendation click' })
  @ApiResponse({ status: 200, description: 'Click tracked' })
  async trackRecommendationClick(@Param('id') id: string): Promise<void> {
    return this.aiService.trackRecommendationClick(id);
  }

  @Put('recommendations/:id/convert')
  @ApiOperation({ summary: 'Track recommendation conversion' })
  @ApiResponse({ status: 200, description: 'Conversion tracked' })
  async trackRecommendationConversion(@Param('id') id: string): Promise<void> {
    return this.aiService.trackRecommendationConversion(id);
  }

  @Get('recommendations/stats/:userId')
  @ApiOperation({ summary: 'Get recommendation statistics' })
  @ApiResponse({ status: 200, description: 'Recommendation stats retrieved' })
  async getRecommendationStats(@Param('userId') userId: string): Promise<any> {
    return this.aiService.getRecommendationStats(userId);
  }

  // ============ Workflows ============

  @Post('workflows')
  @ApiOperation({ summary: 'Create new workflow' })
  @ApiResponse({ status: 201, description: 'Workflow created', type: AIWorkflow })
  async createWorkflow(@Body() dto: CreateWorkflowDto): Promise<AIWorkflow> {
    return this.aiService.createWorkflow(dto);
  }

  @Get('workflows/:id')
  @ApiOperation({ summary: 'Get workflow by ID' })
  @ApiResponse({ status: 200, description: 'Workflow found', type: AIWorkflow })
  async getWorkflow(@Param('id') id: string): Promise<AIWorkflow> {
    return this.aiService.getWorkflow(id);
  }

  @Get('workflows')
  @ApiOperation({ summary: 'Get workflows' })
  @ApiResponse({ status: 200, description: 'Workflows retrieved', type: [AIWorkflow] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getWorkflows(@Query('limit') limit?: number): Promise<AIWorkflow[]> {
    return this.aiService.getWorkflows(limit);
  }

  // ============ Events ============

  @Post('events')
  @ApiOperation({ summary: 'Create AI event' })
  @ApiResponse({ status: 201, description: 'Event created', type: AIEvent })
  async createEvent(@Body() dto: CreateAIEventDto): Promise<AIEvent> {
    return this.aiService.createEvent(dto);
  }

  @Get('events/unprocessed')
  @ApiOperation({ summary: 'Get unprocessed events' })
  @ApiResponse({ status: 200, description: 'Events retrieved', type: [AIEvent] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUnprocessedEvents(@Query('limit') limit?: number): Promise<AIEvent[]> {
    return this.aiService.getUnprocessedEvents(limit);
  }

  @Get('events/entity/:entityType/:entityId')
  @ApiOperation({ summary: 'Get events by entity' })
  @ApiResponse({ status: 200, description: 'Events retrieved', type: [AIEvent] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getEventsByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Query('limit') limit?: number,
  ): Promise<AIEvent[]> {
    return this.aiService.getEventsByEntity(entityType, entityId, limit);
  }

  @Put('events/:id/process')
  @ApiOperation({ summary: 'Mark event as processed' })
  @ApiResponse({ status: 200, description: 'Event marked processed' })
  async markEventProcessed(@Param('id') id: string): Promise<void> {
    return this.aiService.markEventProcessed(id);
  }

  @Get('events/user/:userId')
  @ApiOperation({ summary: 'Get user events' })
  @ApiResponse({ status: 200, description: 'Events retrieved', type: [AIEvent] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getUserEvents(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
  ): Promise<AIEvent[]> {
    return this.aiService.getUserEvents(userId, limit);
  }

  // ════════════════════════════════════════════════════════════════════════
  // NLP ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('nlp/sentiment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyse text sentiment (positive/neutral/negative)' })
  @ApiBody({ schema: { properties: { text: { type: 'string' } } } })
  analyzeSentiment(@Body('text') text: string) {
    return this.nlpService.analyzeSentiment(text ?? '');
  }

  @Post('nlp/intent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detect user intent and extract entities from text' })
  @ApiBody({ schema: { properties: { text: { type: 'string' } } } })
  detectIntent(@Body('text') text: string) {
    return this.nlpService.detectIntent(text ?? '');
  }

  @Post('nlp/keywords')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extract top keywords from text' })
  @ApiBody({ schema: { properties: { text: { type: 'string' }, topN: { type: 'number' } } } })
  extractKeywords(@Body('text') text: string, @Body('topN') topN?: number) {
    return { keywords: this.nlpService.extractKeywords(text ?? '', topN ?? 10) };
  }

  @Post('nlp/summarise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Summarise long text and extract keywords' })
  @ApiBody({ schema: { properties: { text: { type: 'string' } } } })
  summariseText(@Body('text') text: string) {
    return this.nlpService.summariseText(text ?? '');
  }

  @Post('nlp/similarity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute cosine similarity between two texts (0–1)' })
  @ApiBody({ schema: { properties: { text1: { type: 'string' }, text2: { type: 'string' } } } })
  textSimilarity(@Body('text1') text1: string, @Body('text2') text2: string) {
    return { similarity: this.nlpService.similarity(text1 ?? '', text2 ?? '') };
  }

  @Post('nlp/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TF-IDF ranked search over indexed documents' })
  @ApiBody({
    schema: {
      properties: {
        query: { type: 'string' },
        documents: {
          type: 'array',
          items: { properties: { id: { type: 'string' }, text: { type: 'string' } } },
        },
        topN: { type: 'number' },
      },
    },
  })
  semanticSearch(
    @Body('query') query: string,
    @Body('documents') documents: Array<{ id: string; text: string }>,
    @Body('topN') topN?: number,
  ) {
    this.nlpService.resetIndex();
    (documents ?? []).forEach((d) => this.nlpService.indexDocument(d.id, d.text));
    return this.nlpService.searchDocuments(query ?? '', topN ?? 20);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRICING ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('pricing/ride')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute AI dynamic ride pricing with surge' })
  async computeRidePrice(
    @Body()
    body: {
      baseDistance: number;
      pickupLat: number;
      pickupLng: number;
      dropoffLat: number;
      dropoffLng: number;
      rideType?: string;
      demandFactor?: number;
      supplyFactor?: number;
    },
  ) {
    return this.pricingService.computeRidePriceAsync(
      {
        baseDistance: body.baseDistance,
        pickupLat: body.pickupLat,
        pickupLng: body.pickupLng,
        dropoffLat: body.dropoffLat,
        dropoffLng: body.dropoffLng,
        rideType: body.rideType,
        requestedAt: new Date(),
      },
      body.demandFactor ?? 1.0,
      body.supplyFactor ?? 1.0,
    );
  }

  @Post('pricing/discount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get AI discount recommendation for a product' })
  async recommendDiscount(
    @Body()
    body: {
      currentPrice: number;
      daysSinceLastSale: number;
      viewCount: number;
      conversionRate: number;
      stockLevel: number;
    },
  ) {
    return this.pricingService.recommendDiscountAsync(
      body.currentPrice,
      body.daysSinceLastSale,
      body.viewCount,
      body.conversionRate,
      body.stockLevel,
    );
  }

  @Post('pricing/retention')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get AI subscription retention discount offer' })
  async suggestRetentionDiscount(
    @Body()
    body: {
      monthsSubscribed: number;
      lastLoginDaysAgo: number;
      featureUsageScore: number;
      currentMonthlyPrice: number;
    },
  ) {
    return this.pricingService.suggestRetentionDiscountAsync(
      body.monthsSubscribed,
      body.lastLoginDaysAgo,
      body.featureUsageScore,
      body.currentMonthlyPrice,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // FRAUD ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('fraud/score')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Score a transaction for fraud risk (0–1)' })
  async scoreTransaction(
    @Body()
    body: {
      userId: string;
      amount: number;
      currency: string;
      paymentMethod: string;
      ipAddress?: string;
      deviceId?: string;
      latitude?: number;
      longitude?: number;
      recentAmounts?: number[];
      recentCountInHour?: number;
      avgHistoricAmount?: number;
    },
  ) {
    return this.fraudService.scoreTransactionAsync(body);
  }

  @Post('fraud/location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Score geographical anomaly for a transaction' })
  scoreLocationAnomaly(
    @Body() body: { knownLat: number; knownLng: number; txnLat: number; txnLng: number },
  ) {
    const signal = this.fraudService.scoreLocationAnomaly(
      body.knownLat,
      body.knownLng,
      body.txnLat,
      body.txnLng,
    );
    return signal ?? { name: 'no_anomaly', risk: 0, detail: 'Location within expected range' };
  }

  // ════════════════════════════════════════════════════════════════════════
  // INSIGHTS ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('insights/financials')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI financial insights from income/expense transactions' })
  analyseFinancials(
    @Body()
    body: {
      incomeTransactions: Array<{ amount: number; category: string; date: string }>;
      expenseTransactions: Array<{ amount: number; category: string; date: string }>;
    },
  ) {
    const mapDate = (t: { amount: number; category: string; date: string }) => ({
      ...t,
      date: new Date(t.date),
    });
    return this.insightsService.analyseFinancials(
      (body.incomeTransactions ?? []).map(mapDate),
      (body.expenseTransactions ?? []).map(mapDate),
    );
  }

  @Post('insights/spending-pattern')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyse spending pattern from transactions' })
  getSpendingPattern(
    @Body() body: { transactions: Array<{ amount: number; category: string; date: string }> },
  ) {
    return this.insightsService.getSpendingPattern(
      (body.transactions ?? []).map((t) => ({ ...t, date: new Date(t.date) })),
    );
  }

  @Post('insights/forecast')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revenue forecast for next 7 and 30 days' })
  forecastRevenue(@Body() body: { dailySales: Array<{ date: string; revenue: number }> }) {
    return this.insightsService.forecastRevenue(
      (body.dailySales ?? []).map((d) => ({ date: new Date(d.date), revenue: d.revenue })),
    );
  }

  @Post('insights/collaborative-filter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Collaborative filtering — personalised item recommendations' })
  collaborativeFilter(
    @Body()
    body: {
      targetVector: Record<string, number>;
      allVectors: Record<string, Record<string, number>>;
      topN?: number;
    },
  ) {
    return this.insightsService.collaborativeFilter(
      body.targetVector ?? {},
      body.allVectors ?? {},
      body.topN ?? 10,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEARCH ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cross-entity semantic search over a provided document set' })
  @ApiBody({
    schema: {
      properties: {
        query: { type: 'string' },
        documents: {
          type: 'array',
          items: {
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              entityType: { type: 'string' },
            },
          },
        },
        entityType: { type: 'string', description: 'Optional filter' },
        topN: { type: 'number' },
      },
    },
  })
  semanticSearchDocuments(
    @Body('query') query: string,
    @Body('documents') documents: Array<{ id: string; text: string; entityType?: string }>,
    @Body('entityType') entityType?: string,
    @Body('topN') topN?: number,
  ) {
    return this.searchService.searchDocuments(query ?? '', documents ?? [], topN ?? 20);
  }

  @Post('search/rank')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-rank pre-fetched candidates by cosine similarity to query' })
  rankCandidates(
    @Body('query') query: string,
    @Body('candidates') candidates: Array<{ id: string; text: string; entityType?: string }>,
    @Body('topN') topN?: number,
  ) {
    return this.searchService.rankCandidates(query ?? '', candidates ?? [], topN ?? 20);
  }

  @Post('search/suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extract autocomplete keyword suggestions from a query' })
  @ApiBody({ schema: { properties: { query: { type: 'string' } } } })
  suggestKeywords(@Body('query') query: string) {
    return {
      keywords: this.searchService.suggestKeywords(query ?? ''),
      entities: this.searchService.extractQueryEntities(query ?? ''),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // RECOMMENDATION ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('recommendations/similar-items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find items similar to a target using content-based filtering' })
  getSimilarItems(
    @Body('targetTags') targetTags: string,
    @Body('catalogueItems') catalogueItems: Array<{ id: string; tags: string }>,
    @Body('topN') topN?: number,
  ) {
    return this.recommendationService.getSimilarItems(
      targetTags ?? '',
      catalogueItems ?? [],
      topN ?? 10,
    );
  }

  @Post('recommendations/products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personalised product recommendations based on purchase history' })
  getProductRecommendations(
    @Body('purchasedTexts') purchasedTexts: string,
    @Body('catalogueItems') catalogueItems: Array<{ id: string; text: string }>,
    @Body('topN') topN?: number,
  ) {
    return this.recommendationService.getProductRecommendations(
      purchasedTexts ?? '',
      catalogueItems ?? [],
      topN ?? 10,
    );
  }

  @Post('recommendations/feed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personalised content feed ranking based on user interests' })
  getPersonalizedFeed(
    @Body('interestText') interestText: string,
    @Body('contentItems') contentItems: Array<{ id: string; type: string; text: string }>,
    @Body('topN') topN?: number,
  ) {
    return this.recommendationService.getPersonalizedFeed(
      interestText ?? '',
      contentItems ?? [],
      topN ?? 20,
    );
  }

  @Post('recommendations/blend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Blend collaborative and content-based recommendation lists' })
  blendRecommendations(
    @Body('collaborative') collaborative: Array<{ id: string; score: number }>,
    @Body('contentBased') contentBased: Array<{ id: string; score: number }>,
    @Body('topN') topN?: number,
  ) {
    return this.recommendationService.blendRecommendations(
      collaborative ?? [],
      contentBased ?? [],
      topN ?? 10,
    );
  }

  @Post('recommendations/subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recommend optimal subscription plan for a user' })
  recommendSubscriptionPlan(
    @Body('usageScore') usageScore: number,
    @Body('currentTier') currentTier: string,
    @Body('plans')
    plans: Array<{ id: string; name: string; tier: string; featureScore: number; price: number }>,
  ) {
    return this.recommendationService.recommendSubscriptionPlan(
      usageScore ?? 0.5,
      currentTier ?? '',
      plans ?? [],
    );
  }

  @Post('recommendations/wishlist-score')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Score wishlist items by purchase conversion likelihood' })
  scoreWishlistConversion(
    @Body('items')
    items: Array<{
      id: string;
      name: string;
      priority: number;
      addedDaysAgo: number;
      estimatedPrice: number;
      budget?: number;
    }>,
  ) {
    return this.recommendationService.scoreWishlistConversion(items ?? []);
  }

  @Post('recommendations/rank-relevance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rank items by TF-model relevance for a user profile (70% TF + 30% NLP; falls back to NLP)',
  })
  async rankItemsByRelevance(
    @Body('userFeatures')
    userFeatures: {
      ageNorm: number;
      purchaseRate: number;
      avgSpendNorm: number;
      categoryDiversity: number;
      engagementScore: number;
    },
    @Body('items')
    items: Array<{
      id: string;
      tags?: string;
      priceNorm: number;
      categoryScore: number;
      popularity: number;
      avgRating: number;
      recencyNorm: number;
    }>,
    @Body('targetTags') targetTags?: string,
    @Body('topN') topN?: number,
  ) {
    return this.recommendationService.rankItemsByRelevanceAsync(
      userFeatures ?? { ageNorm: 0.5, purchaseRate: 0.5, avgSpendNorm: 0.5, categoryDiversity: 0.5, engagementScore: 0.5 },
      items ?? [],
      targetTags ?? '',
      topN ?? 10,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // WORKFLOW ORCHESTRATOR ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('orchestrator/workflows')
  @ApiOperation({ summary: 'Create a new workflow definition' })
  @ApiResponse({ status: 201, description: 'Workflow created', type: AIWorkflow })
  createOrchestratorWorkflow(@Body() definition: WorkflowDefinition): Promise<AIWorkflow> {
    return this.workflowOrchestrator.createWorkflow(definition);
  }

  @Post('orchestrator/workflows/:id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a workflow by ID' })
  @ApiResponse({ status: 200, description: 'Workflow execution result', type: AIWorkflow })
  executeWorkflow(
    @Param('id') id: string,
    @Body() inputData: Record<string, any>,
  ): Promise<AIWorkflow> {
    return this.workflowOrchestrator.executeWorkflow(id, inputData);
  }

  @Put('orchestrator/workflows/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a running or pending workflow' })
  @ApiResponse({ status: 200, description: 'Workflow cancelled', type: AIWorkflow })
  cancelWorkflow(@Param('id') id: string): Promise<AIWorkflow> {
    return this.workflowOrchestrator.cancelWorkflow(id);
  }

  @Get('orchestrator/workflows/:id')
  @ApiOperation({ summary: 'Get workflow state' })
  @ApiResponse({ status: 200, description: 'Workflow state', type: AIWorkflow })
  getOrchestratorWorkflow(@Param('id') id: string): Promise<AIWorkflow> {
    return this.workflowOrchestrator.getWorkflow(id);
  }

  @Get('orchestrator/workflows')
  @ApiOperation({ summary: 'List workflows with optional status filter' })
  @ApiResponse({ status: 200, description: 'Workflow list', type: [AIWorkflow] })
  @ApiQuery({ name: 'status', required: false, enum: WorkflowStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listOrchestratorWorkflows(
    @Query('status') status?: WorkflowStatus,
    @Query('limit') limit?: number,
  ): Promise<AIWorkflow[]> {
    return this.workflowOrchestrator.listWorkflows(status, limit);
  }

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE STORE ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Get('feature-store/:entityType/:entityId')
  @ApiOperation({ summary: 'Get all features for an entity' })
  getEntityFeatures(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<Record<string, any>> {
    return this.featureStore.getEntityFeatures(entityType, entityId);
  }

  @Get('feature-store/:entityType/:entityId/:featureName')
  @ApiOperation({ summary: 'Get a specific feature value' })
  getFeatureValue(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('featureName') featureName: string,
  ): Promise<any> {
    return this.featureStore.getFeature(entityType, entityId, featureName);
  }

  @Post('feature-store')
  @ApiOperation({ summary: 'Set a feature value' })
  @ApiResponse({ status: 201, description: 'Feature saved', type: AIFeature })
  setFeatureValue(@Body() record: FeatureRecord): Promise<AIFeature> {
    return this.featureStore.setFeature(record);
  }

  @Post('feature-store/batch')
  @ApiOperation({ summary: 'Batch set feature values' })
  @ApiResponse({ status: 201, description: 'Features saved', type: [AIFeature] })
  batchSetFeatures(@Body('features') features: FeatureRecord[]): Promise<AIFeature[]> {
    return this.featureStore.batchSetFeatures(features ?? []);
  }

  @Delete('feature-store/:entityType/:entityId/:featureName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a specific feature' })
  deleteFeature(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('featureName') featureName: string,
  ): Promise<void> {
    return this.featureStore.deleteFeature(entityType, entityId, featureName);
  }

  // ════════════════════════════════════════════════════════════════════════
  // ETL PIPELINE ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('etl/pipelines/:name/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger an ETL pipeline' })
  triggerPipeline(
    @Param('name') name: string,
    @Body() options: Record<string, any>,
  ) {
    return this.etlService.runPipeline(name, options);
  }

  @Post('etl/pipelines/:name/queue')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue an ETL pipeline for background execution' })
  queuePipeline(
    @Param('name') name: string,
    @Body() options: Record<string, any>,
  ): Promise<void> {
    return this.etlService.queuePipeline(name, options);
  }

  @Get('etl/pipelines')
  @ApiOperation({ summary: 'Get all ETL pipeline statuses' })
  getAllPipelineStatuses() {
    return this.etlService.getAllPipelineStatuses();
  }

  @Get('etl/pipelines/:name/status')
  @ApiOperation({ summary: 'Get status of a specific ETL pipeline' })
  getPipelineStatus(@Param('name') name: string) {
    return this.etlService.getPipelineStatus(name);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PLUGIN SYSTEM ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('plugins')
  @ApiOperation({ summary: 'Register a new plugin' })
  @ApiResponse({ status: 201, description: 'Plugin registered' })
  registerPlugin(@Body() dto: RegisterPluginDto) {
    return this.pluginService.register(dto);
  }

  @Get('plugins')
  @ApiOperation({ summary: 'List all registered plugins' })
  @ApiQuery({ name: 'type', required: false, enum: PluginType })
  listPlugins(@Query('type') type?: PluginType) {
    return this.pluginService.findAll(type);
  }

  @Get('plugins/:name')
  @ApiOperation({ summary: 'Get a plugin by name' })
  getPlugin(@Param('name') name: string) {
    return this.pluginService.findByName(name);
  }

  @Post('plugins/:name/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a plugin with input data' })
  executePlugin(@Param('name') name: string, @Body() input: any) {
    return this.pluginService.execute(name, input);
  }

  @Put('plugins/:name/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update plugin status (active/inactive)' })
  updatePluginStatus(@Param('name') name: string, @Body('status') status: PluginStatus) {
    return this.pluginService.setStatus(name, status);
  }

  @Delete('plugins/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a plugin' })
  deletePlugin(@Param('name') name: string): Promise<void> {
    return this.pluginService.delete(name);
  }

  // ════════════════════════════════════════════════════════════════════════
  // EVENT BUS ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════

  @Post('event-bus/emit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emit an event to the event bus' })
  emitEvent(
    @Body('eventName') eventName: string,
    @Body('payload') payload: Record<string, any>,
    @Body('options') options?: { persist?: boolean; async?: boolean; entityType?: string; entityId?: string; userId?: string },
  ): Promise<void> {
    return this.eventBus.emit(eventName, payload ?? {}, options ?? {});
  }

  @Get('event-bus/events/unprocessed')
  @ApiOperation({ summary: 'Get unprocessed events from the event bus' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getUnprocessedBusEvents(@Query('limit') limit?: number) {
    return this.eventBus.getUnprocessedEvents(limit);
  }

  @Get('event-bus/events/:eventName')
  @ApiOperation({ summary: 'Get recent events by name' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getEventsByName(@Param('eventName') eventName: string, @Query('limit') limit?: number) {
    return this.eventBus.getEventsByName(eventName, limit);
  }

  @Put('event-bus/events/:id/processed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark an event as processed' })
  markEventBusEventProcessed(@Param('id') id: string): Promise<void> {
    return this.eventBus.markProcessed(id);
  }

  @Get('event-bus/subscriptions')
  @ApiOperation({ summary: 'List all active event subscriptions' })
  listEventSubscriptions() {
    return { events: this.eventBus.listEvents() };
  }
}
