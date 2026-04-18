import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AIWorkflow, WorkflowStatus } from '../entities/ai-workflow.entity';
import { AIEvent, EventType } from '../entities/ai-event.entity';
import { AINlpService } from './ai-nlp.service';
import { AIFraudService, TransactionContext } from './ai-fraud.service';
import { AIRecommendationsService } from './ai-recommendations.service';
import { AITensorflowService } from './ai-tensorflow.service';

export interface WorkflowStep {
  type: string;
  name: string;
  config?: Record<string, any>;
}

export interface WorkflowDefinition {
  workflowName: string;
  workflowType: string;
  steps: WorkflowStep[];
  config?: Record<string, any>;
  triggeredBy?: string;
}

export interface StepResult {
  stepName: string;
  stepType: string;
  output: Record<string, any>;
  executedAt: Date;
  durationMs: number;
}

@Injectable()
export class WorkflowOrchestratorService {
  private readonly logger = new Logger(WorkflowOrchestratorService.name);

  constructor(
    @InjectRepository(AIWorkflow)
    private readonly workflowRepo: Repository<AIWorkflow>,
    @InjectRepository(AIEvent)
    private readonly eventRepo: Repository<AIEvent>,
    private readonly nlpService: AINlpService,
    private readonly fraudService: AIFraudService,
    private readonly recommendationsService: AIRecommendationsService,
    private readonly tensorflowService: AITensorflowService,
  ) {}

  // ─────────────────────────────────────────────────────
  // CREATE + TRIGGER
  // ─────────────────────────────────────────────────────

  async createWorkflow(definition: WorkflowDefinition): Promise<AIWorkflow> {
    const workflow = this.workflowRepo.create({
      workflowName: definition.workflowName,
      workflowType: definition.workflowType,
      config: { ...definition.config, steps: definition.steps },
      totalSteps: definition.steps.length,
      completedSteps: 0,
      status: WorkflowStatus.PENDING,
      triggeredBy: definition.triggeredBy ?? null,
    });
    return this.workflowRepo.save(workflow);
  }

  async executeWorkflow(workflowId: string, inputData: Record<string, any> = {}): Promise<AIWorkflow> {
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    if (workflow.status === WorkflowStatus.RUNNING) {
      throw new BadRequestException('Workflow is already running');
    }
    if (workflow.status === WorkflowStatus.COMPLETED) {
      throw new BadRequestException('Workflow already completed');
    }

    const steps: WorkflowStep[] = workflow.config?.steps ?? [];
    if (steps.length === 0) {
      throw new BadRequestException('Workflow has no steps defined');
    }

    // Mark as running
    workflow.status = WorkflowStatus.RUNNING;
    workflow.startedAt = new Date();
    await this.workflowRepo.save(workflow);

    const stepResults: StepResult[] = [];
    let context: Record<string, any> = { ...inputData };

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        workflow.currentStep = step.name;
        await this.workflowRepo.save(workflow);

        this.logger.log(`Workflow ${workflowId} — executing step ${i + 1}/${steps.length}: ${step.type}`);

        const t0 = Date.now();
        const output = await this.executeStep(step, context, workflow);
        const durationMs = Date.now() - t0;

        stepResults.push({
          stepName: step.name,
          stepType: step.type,
          output,
          executedAt: new Date(),
          durationMs,
        });

        // Carry forward step outputs so subsequent steps can reference them
        context = { ...context, [step.name]: output };

        workflow.completedSteps = i + 1;
        await this.workflowRepo.save(workflow);
      }

      // Mark completed
      workflow.status = WorkflowStatus.COMPLETED;
      workflow.completedAt = new Date();
      workflow.currentStep = null;
      workflow.results = { steps: stepResults, finalContext: context };
      await this.workflowRepo.save(workflow);

      await this.emitWorkflowEvent('workflow.completed', workflow, { stepCount: steps.length });

      this.logger.log(`Workflow ${workflowId} completed successfully`);
      return workflow;
    } catch (err) {
      workflow.status = WorkflowStatus.FAILED;
      workflow.error = err instanceof Error ? err.message : String(err);
      workflow.results = { steps: stepResults, failedAt: workflow.currentStep };
      await this.workflowRepo.save(workflow);

      await this.emitWorkflowEvent('workflow.failed', workflow, { error: workflow.error });

      this.logger.error(`Workflow ${workflowId} failed: ${workflow.error}`);
      throw err;
    }
  }

  async cancelWorkflow(workflowId: string): Promise<AIWorkflow> {
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    if (workflow.status !== WorkflowStatus.RUNNING && workflow.status !== WorkflowStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel workflow in status: ${workflow.status}`);
    }

    workflow.status = WorkflowStatus.CANCELLED;
    workflow.completedAt = new Date();
    return this.workflowRepo.save(workflow);
  }

  async getWorkflow(workflowId: string): Promise<AIWorkflow> {
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);
    return workflow;
  }

  async listWorkflows(status?: WorkflowStatus, limit = 50): Promise<AIWorkflow[]> {
    const qb = this.workflowRepo.createQueryBuilder('w').orderBy('w.createdAt', 'DESC').take(limit);
    if (status) qb.where('w.status = :status', { status });
    return qb.getMany();
  }

  // ─────────────────────────────────────────────────────
  // STEP HANDLERS
  // ─────────────────────────────────────────────────────

  private async executeStep(
    step: WorkflowStep,
    context: Record<string, any>,
    workflow: AIWorkflow,
  ): Promise<Record<string, any>> {
    switch (step.type) {
      case 'nlp_parse':
        return this.stepNlpParse(step, context);

      case 'fraud_check':
        return this.stepFraudCheck(step, context);

      case 'get_recommendations':
        return this.stepGetRecommendations(step, context);      case 'predict_outcome':
        return this.stepPredictOutcome(step, context, workflow);

      case 'condition':
        return this.stepCondition(step, context);

      case 'transform':
        return this.stepTransform(step, context);

      case 'log':
        return this.stepLog(step, context);

      default:
        this.logger.warn(`Unknown step type "${step.type}" — skipping`);
        return { skipped: true, reason: `Unknown step type: ${step.type}` };
    }
  }

  private async stepNlpParse(step: WorkflowStep, context: Record<string, any>): Promise<Record<string, any>> {
    const text: string = this.resolveContextValue(step.config?.textField, context) ?? '';
    if (!text) return { sentiment: null, intent: null, entities: [] };

    const [sentiment, intentResult] = await Promise.all([
      this.nlpService.analyzeSentiment(text),
      this.nlpService.detectIntent(text),
    ]);

    return { sentiment, intent: intentResult.intent, entities: intentResult.entities, intentResult };
  }

  private async stepFraudCheck(step: WorkflowStep, context: Record<string, any>): Promise<Record<string, any>> {
    const txnCtx: TransactionContext = {
      userId: this.resolveContextValue(step.config?.userIdField, context) ?? context.userId ?? '',
      amount: Number(this.resolveContextValue(step.config?.amountField, context) ?? context.amount ?? 0),
      currency: this.resolveContextValue(step.config?.currencyField, context) ?? context.currency ?? 'USD',
      paymentMethod: this.resolveContextValue(step.config?.paymentMethodField, context) ?? context.paymentMethod ?? 'unknown',
      ipAddress: context.ipAddress,
      deviceId: context.deviceId,
      recentAmounts: context.recentAmounts,
      recentCountInHour: context.recentCountInHour,
      avgHistoricAmount: context.avgHistoricAmount,
    };

    const result = this.fraudService.scoreTransaction(txnCtx);
    return { fraudResult: result, blocked: result.blocked, riskScore: result.riskScore };
  }

  private stepGetRecommendations(step: WorkflowStep, context: Record<string, any>): Record<string, any> {
    const interestText: string =
      this.resolveContextValue(step.config?.interestTextField, context) ?? context.interestText ?? '';
    const items: Array<{ id: string; type: string; text: string }> =
      this.resolveContextValue(step.config?.itemsField, context) ?? context.feedItems ?? [];
    const limit: number = step.config?.limit ?? 10;

    const recommendations = this.recommendationsService.getPersonalizedFeed(interestText, items, limit);
    return { recommendations };
  }

  private async stepPredictOutcome(
    step: WorkflowStep,
    context: Record<string, any>,
    workflow: AIWorkflow,
  ): Promise<Record<string, any>> {
    const modelName: string = step.config?.modelName ?? 'default';
    const features: number[] = this.resolveContextValue(step.config?.featuresField, context) ?? context.features ?? [];

    try {
      const prediction = await this.tensorflowService.predict(modelName, [features]);
      return { prediction, modelName };
    } catch {
      this.logger.warn(`TF predict failed for model "${modelName}" in workflow ${workflow.id}`);
      return { prediction: null, modelName, error: 'Model unavailable' };
    }
  }

  private stepCondition(step: WorkflowStep, context: Record<string, any>): Record<string, any> {
    const field = step.config?.field ?? '';
    const operator = step.config?.operator ?? 'eq';
    const value = step.config?.value;

    const actualValue = this.resolveContextValue(field, context);
    let passed = false;

    switch (operator) {
      case 'eq': passed = actualValue === value; break;
      case 'neq': passed = actualValue !== value; break;
      case 'gt': passed = Number(actualValue) > Number(value); break;
      case 'lt': passed = Number(actualValue) < Number(value); break;
      case 'gte': passed = Number(actualValue) >= Number(value); break;
      case 'lte': passed = Number(actualValue) <= Number(value); break;
      case 'contains': passed = String(actualValue ?? '').includes(String(value)); break;
      case 'exists': passed = actualValue !== null && actualValue !== undefined; break;
      default: passed = false;
    }

    return { conditionPassed: passed, field, operator, actualValue, expectedValue: value };
  }

  private stepTransform(step: WorkflowStep, context: Record<string, any>): Record<string, any> {
    const mappings: Array<{ from: string; to: string; transform?: string }> = step.config?.mappings ?? [];
    const output: Record<string, any> = {};

    for (const mapping of mappings) {
      let val = this.resolveContextValue(mapping.from, context);
      if (mapping.transform === 'uppercase') val = String(val ?? '').toUpperCase();
      else if (mapping.transform === 'lowercase') val = String(val ?? '').toLowerCase();
      else if (mapping.transform === 'number') val = Number(val);
      else if (mapping.transform === 'boolean') val = Boolean(val);
      output[mapping.to] = val;
    }

    return output;
  }

  private stepLog(step: WorkflowStep, context: Record<string, any>): Record<string, any> {
    const message = step.config?.message ?? 'Workflow step executed';
    const fields = step.config?.fields ?? [];
    const logData: Record<string, any> = { message };
    for (const field of fields) {
      logData[field] = this.resolveContextValue(field, context);
    }
    this.logger.log(`[WorkflowLog] ${JSON.stringify(logData)}`);
    return { logged: true, ...logData };
  }

  // ─────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────

  /** Resolve dot-path references like "stepName.fieldName" from context */
  private resolveContextValue(path: string | undefined, context: Record<string, any>): any {
    if (!path) return undefined;
    const parts = path.split('.');
    let cursor: any = context;
    for (const part of parts) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }

  private async emitWorkflowEvent(
    eventName: string,
    workflow: AIWorkflow,
    extraPayload: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.eventRepo.save(
        this.eventRepo.create({
          eventType: EventType.WORKFLOW_EVENT,
          eventName,
          entityType: 'workflow',
          entityId: workflow.id,
          userId: workflow.triggeredBy ?? null,
          payload: {
            workflowId: workflow.id,
            workflowType: workflow.workflowType,
            status: workflow.status,
            ...extraPayload,
          },
          metadata: null,
          processed: false,
          processedAt: null,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to emit workflow event: ${err}`);
    }
  }
}
