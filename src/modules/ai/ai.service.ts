import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AIModel, ModelStatus, ModelType } from './entities/ai-model.entity';
import { AIInference, InferenceStatus } from './entities/ai-inference.entity';
import { AIFeature, FeatureType } from './entities/ai-feature.entity';
import { AIRecommendation, RecommendationType } from './entities/ai-recommendation.entity';
import { AIWorkflow, WorkflowStatus } from './entities/ai-workflow.entity';
import { AIEvent } from './entities/ai-event.entity';
import { CreateAIModelDto } from './dto/create-ai-model.dto';
import { CreateInferenceDto } from './dto/create-inference.dto';
import { GetRecommendationsDto } from './dto/get-recommendations.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { CreateAIEventDto } from './dto/create-ai-event.dto';
import { AITensorflowService } from './services/ai-tensorflow.service';
import { AINlpService } from './services/ai-nlp.service';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    @InjectRepository(AIModel)
    private readonly modelRepository: Repository<AIModel>,
    @InjectRepository(AIInference)
    private readonly inferenceRepository: Repository<AIInference>,
    @InjectRepository(AIFeature)
    private readonly featureRepository: Repository<AIFeature>,
    @InjectRepository(AIRecommendation)
    private readonly recommendationRepository: Repository<AIRecommendation>,
    @InjectRepository(AIWorkflow)
    private readonly workflowRepository: Repository<AIWorkflow>,
    @InjectRepository(AIEvent)
    private readonly eventRepository: Repository<AIEvent>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly tfService: AITensorflowService,
    private readonly nlpService: AINlpService,
  ) {}

  // ============ Model Management ============

  async createModel(dto: CreateAIModelDto): Promise<AIModel> {
    const model = this.modelRepository.create({
      name: dto.name,
      modelType: dto.modelType,
      version: dto.version,
      description: dto.description,
      config: dto.config,
      status: ModelStatus.TRAINING,
      trainingStartedAt: new Date(),
    });

    return this.modelRepository.save(model);
  }

  async getModel(modelId: string): Promise<AIModel> {
    const model = await this.modelRepository.findOne({ where: { id: modelId } });
    if (!model) {
      throw new NotFoundException('Model not found');
    }
    return model;
  }

  async getActiveModels(modelType?: string): Promise<AIModel[]> {
    const where: any = { status: ModelStatus.ACTIVE };
    if (modelType) where.modelType = modelType;

    return this.modelRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async updateModelStatus(modelId: string, status: ModelStatus): Promise<AIModel> {
    const model = await this.getModel(modelId);
    model.status = status;

    if (status === ModelStatus.ACTIVE) {
      model.trainingCompletedAt = new Date();
    }

    return this.modelRepository.save(model);
  }

  async updateModelMetrics(modelId: string, metrics: Record<string, any>): Promise<AIModel> {
    const model = await this.getModel(modelId);
    model.metrics = metrics;
    return this.modelRepository.save(model);
  }

  // ============ Inference ============

  async createInference(dto: CreateInferenceDto): Promise<AIInference> {
    const model = await this.getModel(dto.modelId);

    if (model.status !== ModelStatus.ACTIVE) {
      throw new BadRequestException(`Model ${dto.modelId} is not active (status: ${model.status})`);
    }

    const inference = this.inferenceRepository.create({
      modelId: dto.modelId,
      userId: dto.userId || null,
      status: InferenceStatus.PENDING,
      input: dto.input,
      metadata: dto.metadata || null,
    });

    const savedInference = await this.inferenceRepository.save(inference);

    // Process inference asynchronously
    this.processInference(savedInference.id).catch((err: Error) =>
      this.logger.error(`Background inference ${savedInference.id} failed: ${err.message}`, err.stack),
    );

    return savedInference;
  }

  private async processInference(inferenceId: string): Promise<void> {
    const inference = await this.inferenceRepository.findOne({ where: { id: inferenceId } });
    if (!inference) return;

    const startTime = Date.now();

    try {
      inference.status = InferenceStatus.PROCESSING;
      await this.inferenceRepository.save(inference);

      const model = await this.modelRepository.findOne({ where: { id: inference.modelId } });
      const apiKey = this.configService.get<string>('AI_API_KEY');
      const baseUrl = this.configService.get<string>('AI_BASE_URL') || 'https://api.openai.com/v1';
      const aiModel = this.configService.get<string>('AI_MODEL') || 'gpt-4-turbo';
      const maxTokens = this.configService.get<number>('AI_MAX_TOKENS') || 2000;

      let output: Record<string, any>;

      if (apiKey && !apiKey.startsWith('YOUR_')) {
        const prompt =
          typeof inference.input === 'string' ? inference.input : JSON.stringify(inference.input);

        const systemPrompt = model?.config?.systemPrompt || 'You are a helpful assistant.';

        const response = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/chat/completions`,
            {
              model: aiModel,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
              ],
              max_tokens: maxTokens,
              temperature: this.configService.get<number>('AI_TEMPERATURE') || 0.7,
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: this.configService.get<number>('AI_REQUEST_TIMEOUT') || 30000,
            },
          ),
        );

        const choice = response.data.choices?.[0];
        output = {
          content: choice?.message?.content || '',
          finishReason: choice?.finish_reason || 'stop',
          usage: response.data.usage || {},
          model: response.data.model,
        };
      } else {
        // No external API key — route to local TF.js / NLP models
        output = await this.runLocalInference(inference, model);
      }

      inference.status = InferenceStatus.COMPLETED;
      inference.output = output;
      inference.confidence = 1.0;
      inference.processingTimeMs = Date.now() - startTime;

      await this.inferenceRepository.save(inference);

      await this.modelRepository.increment({ id: inference.modelId }, 'inferenceCount', 1);
      await this.modelRepository.update({ id: inference.modelId }, { lastInferenceAt: new Date() });
    } catch (error) {
      this.logger.error(`Inference ${inferenceId} failed: ${error.message}`, error.stack);
      inference.status = InferenceStatus.FAILED;
      inference.error = error.message;
      inference.processingTimeMs = Date.now() - startTime;
      await this.inferenceRepository.save(inference);
    }
  }

  /**
   * Runs inference locally using TF.js models or NLP service.
   * Called when no external AI_API_KEY is configured.
   *
   * Routing priority:
   *   1. Named TF models: fraud, pricing, discount, churn, recommendations
   *   2. NLP-typed models: sentiment, intent, keyword, summary
   *   3. Default: composite NLP analysis
   */
  private async runLocalInference(
    inference: AIInference,
    model: AIModel | null,
  ): Promise<Record<string, any>> {
    const TF_MODEL_NAMES = ['fraud', 'pricing', 'discount', 'churn', 'recommendations'];
    const modelName = (model?.name ?? '').toLowerCase();
    const modelType = model?.modelType as string | undefined;

    // ── Extract raw input ──────────────────────────────────────────────────
    const rawInput = inference.input;
    const text: string =
      typeof rawInput === 'string'
        ? rawInput
        : (rawInput as any)?.text ?? (rawInput as any)?.prompt ?? (rawInput as any)?.content ?? '';

    const features: number[] | undefined =
      Array.isArray((rawInput as any)?.features)
        ? (rawInput as any).features
        : Array.isArray(rawInput)
        ? rawInput
        : undefined;

    // ── TF model routing ───────────────────────────────────────────────────
    const tfMatch = TF_MODEL_NAMES.find((n) => modelName.includes(n));
    if (tfMatch && this.tfService.isEnabled() && this.tfService.hasModel(tfMatch)) {
      if (!features || features.length === 0) {
        return {
          content: `TF model "${tfMatch}" requires a features array in the input.`,
          model: `local/tf/${tfMatch}`,
          error: 'missing_features',
        };
      }
      const tfResult = await this.tfService.predict(tfMatch, [features]);
      return {
        prediction: tfResult.values[0],
        modelName: tfMatch,
        inferenceMs: tfResult.inferenceMs,
        model: `local/tf/${tfMatch}`,
        source: 'tensorflow',
      };
    }

    // ── NLP routing ────────────────────────────────────────────────────────
    const isNlpType = modelType === ModelType?.NLP || modelType === 'nlp';
    const isSentiment = modelName.includes('sentiment');
    const isIntent = modelName.includes('intent');
    const isKeyword = modelName.includes('keyword');
    const isSummary = modelName.includes('summary') || modelName.includes('summar');

    if (text) {
      if (isSentiment || isNlpType) {
        const sentiment = this.nlpService.analyzeSentiment(text);
        return { ...sentiment, model: 'local/nlp/sentiment', source: 'nlp' };
      }
      if (isIntent) {
        const intent = this.nlpService.detectIntent(text);
        return { ...intent, model: 'local/nlp/intent', source: 'nlp' };
      }
      if (isKeyword) {
        const keywords = this.nlpService.extractKeywords(text, 10);
        return { keywords, model: 'local/nlp/keywords', source: 'nlp' };
      }
      if (isSummary) {
        const summary = this.nlpService.summariseText(text);
        return { summary, model: 'local/nlp/summary', source: 'nlp' };
      }

      // ── Default: composite NLP analysis ──────────────────────────────────
      const sentiment = this.nlpService.analyzeSentiment(text);
      const intent = this.nlpService.detectIntent(text);
      const keywords = this.nlpService.extractKeywords(text, 5);
      return {
        sentiment,
        intent,
        keywords,
        model: 'local/nlp/composite',
        source: 'nlp',
      };
    }

    // ── No usable input ────────────────────────────────────────────────────
    this.logger.warn(`runLocalInference: no text or features found for model "${modelName}"`);
    return {
      content: 'Provide either a text string or a numeric features array to run local inference.',
      model: 'local/fallback',
      source: 'fallback',
    };
  }

  async getInference(inferenceId: string): Promise<AIInference> {
    const inference = await this.inferenceRepository.findOne({ where: { id: inferenceId } });
    if (!inference) {
      throw new NotFoundException('Inference not found');
    }
    return inference;
  }

  async getUserInferences(userId: string, limit = 50): Promise<AIInference[]> {
    return this.inferenceRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ============ Feature Store ============

  async createFeature(
    entityType: string,
    entityId: string,
    featureName: string,
    featureType: FeatureType,
    featureValue: any,
  ): Promise<AIFeature> {
    const feature = this.featureRepository.create({
      entityType,
      entityId,
      featureName,
      featureType,
      featureValue,
      computedAt: new Date(),
    });

    return this.featureRepository.save(feature);
  }

  async getFeatures(entityType: string, entityId: string): Promise<AIFeature[]> {
    return this.featureRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async getFeatureByName(
    entityType: string,
    entityId: string,
    featureName: string,
  ): Promise<AIFeature | null> {
    return this.featureRepository.findOne({
      where: { entityType, entityId, featureName },
    });
  }

  // ============ Recommendations ============

  async generateRecommendations(dto: GetRecommendationsDto): Promise<AIRecommendation[]> {
    const limit = dto.limit || 10;

    // Check for existing recent recommendations
    const existingRecs = await this.recommendationRepository.find({
      where: {
        userId: dto.userId,
        recommendationType: dto.recommendationType,
      },
      order: { score: 'DESC' },
      take: limit,
    });

    // Serving from persistent store – return what we have even if below limit
    if (existingRecs.length > 0) {
      return existingRecs;
    }

    // No stored recommendations; return empty so callers know there's no data yet
    // New recommendations are created via createEvent() → scheduled ML pipeline
    return [];
  }

  async trackRecommendationView(recommendationId: string): Promise<void> {
    await this.recommendationRepository.update(recommendationId, {
      viewed: true,
      viewedAt: new Date(),
    });
  }

  async trackRecommendationClick(recommendationId: string): Promise<void> {
    await this.recommendationRepository.update(recommendationId, {
      clicked: true,
      clickedAt: new Date(),
    });
  }

  async trackRecommendationConversion(recommendationId: string): Promise<void> {
    await this.recommendationRepository.update(recommendationId, {
      converted: true,
      convertedAt: new Date(),
    });
  }

  // ============ Workflows ============

  async createWorkflow(dto: CreateWorkflowDto, triggeredBy?: string): Promise<AIWorkflow> {
    const workflow = this.workflowRepository.create({
      workflowName: dto.workflowName,
      workflowType: dto.workflowType,
      config: dto.config,
      status: WorkflowStatus.PENDING,
      triggeredBy: triggeredBy || null,
      totalSteps: dto.config.steps?.length || 0,
    });

    const savedWorkflow = await this.workflowRepository.save(workflow);

    // Execute workflow asynchronously
    this.executeWorkflow(savedWorkflow.id).catch((err: Error) =>
      this.logger.error(`Background workflow ${savedWorkflow.id} failed: ${err.message}`, err.stack),
    );

    return savedWorkflow;
  }

  private async executeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowId } });
    if (!workflow) return;

    try {
      workflow.status = WorkflowStatus.RUNNING;
      workflow.startedAt = new Date();
      await this.workflowRepository.save(workflow);

      const steps: Array<{ name: string; type: string; config?: Record<string, any> }> =
        workflow.config.steps || [];
      const stepResults: Record<string, any>[] = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        workflow.currentStep = step.name;
        workflow.completedSteps = i;
        await this.workflowRepository.save(workflow);

        let stepResult: Record<string, any> = { step: step.name, status: 'completed' };

        switch (step.type) {
          case 'inference': {
            const inference = await this.createInference({
              modelId: step.config?.modelId || workflow.config.modelId,
              input: step.config?.input || workflow.config.input,
              userId: workflow.triggeredBy || undefined,
            } as CreateInferenceDto);
            stepResult = { step: step.name, inferenceId: inference.id, status: 'completed' };
            break;
          }
          case 'recommendation': {
            const recs = await this.generateRecommendations({
              userId: step.config?.userId || workflow.triggeredBy || '',
              recommendationType: step.config?.recommendationType || RecommendationType.PRODUCT,
              limit: step.config?.limit || 10,
            });
            stepResult = { step: step.name, recommendationCount: recs.length, status: 'completed' };
            break;
          }
          case 'event': {
            await this.createEvent({
              eventType: step.config?.eventType || 'workflow_step',
              eventName: step.name,
              entityType: step.config?.entityType || 'workflow',
              entityId: workflowId,
              userId: workflow.triggeredBy || undefined,
              payload: step.config?.payload || {},
            } as CreateAIEventDto);
            stepResult = { step: step.name, status: 'completed' };
            break;
          }
          default: {
            this.logger.log(
              `Workflow ${workflowId}: executing step '${step.name}' (type: ${step.type})`,
            );
            stepResult = { step: step.name, type: step.type, status: 'completed' };
          }
        }

        stepResults.push(stepResult);
      }

      workflow.status = WorkflowStatus.COMPLETED;
      workflow.completedSteps = steps.length;
      workflow.completedAt = new Date();
      workflow.results = { success: true, stepsCompleted: steps.length, stepResults };
      await this.workflowRepository.save(workflow);
    } catch (error) {
      this.logger.error(`Workflow ${workflowId} failed: ${error.message}`, error.stack);
      workflow.status = WorkflowStatus.FAILED;
      workflow.error = error.message;
      workflow.completedAt = new Date();
      await this.workflowRepository.save(workflow);
    }
  }

  async getWorkflow(workflowId: string): Promise<AIWorkflow> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowId } });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    return workflow;
  }

  async getWorkflows(limit = 50): Promise<AIWorkflow[]> {
    return this.workflowRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ============ Events ============

  async createEvent(dto: CreateAIEventDto): Promise<AIEvent> {
    const event = this.eventRepository.create({
      eventType: dto.eventType,
      eventName: dto.eventName,
      entityType: dto.entityType,
      entityId: dto.entityId,
      userId: dto.userId || null,
      payload: dto.payload,
      metadata: dto.metadata || null,
    });

    return this.eventRepository.save(event);
  }

  async getUnprocessedEvents(limit = 100): Promise<AIEvent[]> {
    return this.eventRepository.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markEventProcessed(eventId: string): Promise<void> {
    await this.eventRepository.update(eventId, {
      processed: true,
      processedAt: new Date(),
    });
  }

  async getUserEvents(userId: string, limit = 100): Promise<AIEvent[]> {
    return this.eventRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ============ Analytics ============

  async getModelStats(modelId: string): Promise<any> {
    const model = await this.getModel(modelId);

    const totalInferences = await this.inferenceRepository.count({
      where: { modelId },
    });

    const successfulInferences = await this.inferenceRepository.count({
      where: { modelId, status: InferenceStatus.COMPLETED },
    });

    const avgProcessingTime = await this.inferenceRepository
      .createQueryBuilder('inference')
      .select('AVG(inference.processingTimeMs)', 'avg')
      .where('inference.modelId = :modelId', { modelId })
      .andWhere('inference.status = :status', { status: InferenceStatus.COMPLETED })
      .getRawOne();

    return {
      model: {
        id: model.id,
        name: model.name,
        version: model.version,
        status: model.status,
      },
      stats: {
        totalInferences,
        successfulInferences,
        failedInferences: totalInferences - successfulInferences,
        successRate: totalInferences > 0 ? successfulInferences / totalInferences : 0,
        avgProcessingTimeMs: parseFloat(avgProcessingTime?.avg || '0'),
      },
      metrics: model.metrics,
    };
  }

  async getRecommendationStats(userId: string): Promise<any> {
    const totalRecs = await this.recommendationRepository.count({
      where: { userId },
    });

    const viewedRecs = await this.recommendationRepository.count({
      where: { userId, viewed: true },
    });

    const clickedRecs = await this.recommendationRepository.count({
      where: { userId, clicked: true },
    });

    const convertedRecs = await this.recommendationRepository.count({
      where: { userId, converted: true },
    });

    return {
      total: totalRecs,
      viewed: viewedRecs,
      clicked: clickedRecs,
      converted: convertedRecs,
      viewRate: totalRecs > 0 ? viewedRecs / totalRecs : 0,
      clickThroughRate: viewedRecs > 0 ? clickedRecs / viewedRecs : 0,
      conversionRate: clickedRecs > 0 ? convertedRecs / clickedRecs : 0,
    };
  }

  // === Additional methods for frontend parity ===

  async getInferences(limit = 50): Promise<AIInference[]> {
    return await this.inferenceRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getRecommendations(limit = 50): Promise<AIRecommendation[]> {
    return await this.recommendationRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async updateModel(modelId: string, data: Partial<AIModel>): Promise<AIModel> {
    const model = await this.getModel(modelId);
    Object.assign(model, data);
    return await this.modelRepository.save(model);
  }

  async getInferencesByModel(modelId: string, limit = 50): Promise<AIInference[]> {
    return await this.inferenceRepository.find({
      where: { modelId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getInferencesByEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<AIInference[]> {
    return await this.inferenceRepository.find({
      where: { input: { entityType, entityId } as any },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getRecommendationsForEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<AIRecommendation[]> {
    return await this.recommendationRepository.find({
      where: { userId: entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getEventsByEntity(entityType: string, entityId: string, limit = 100): Promise<AIEvent[]> {
    return await this.eventRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
