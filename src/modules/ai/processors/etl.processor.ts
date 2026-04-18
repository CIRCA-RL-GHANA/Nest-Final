import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EtlService } from '../services/etl.service';

@Processor('etl-pipeline')
export class EtlProcessor {
  private readonly logger = new Logger(EtlProcessor.name);

  constructor(private readonly etlService: EtlService) {}

  @Process('run-pipeline')
  async handleRunPipeline(job: Job<{ pipelineName: string; options: Record<string, any> }>): Promise<void> {
    const { pipelineName, options } = job.data;
    this.logger.log(`Processing ETL pipeline job: ${pipelineName} (jobId=${job.id})`);
    await this.etlService.runPipeline(pipelineName, options ?? {});
  }
}
