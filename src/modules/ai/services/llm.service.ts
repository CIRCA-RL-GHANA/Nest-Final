import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;
  private readonly requestTimeout: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('ai.apiKey');
    this.baseUrl = this.config.get<string>('ai.baseUrl') ?? 'https://api.openai.com/v1';
    this.model = this.config.get<string>('ai.model') ?? 'gpt-4o-mini';
    this.defaultMaxTokens = this.config.get<number>('ai.maxTokens') ?? 1024;
    this.defaultTemperature = this.config.get<number>('ai.temperature') ?? 0.7;
    this.requestTimeout = this.config.get<number>('ai.requestTimeout') ?? 30000;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async complete(options: LlmCompletionOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('AI_API_KEY is not configured');
    }

    const body = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      temperature: options.temperature ?? this.defaultTemperature,
    };

    const response = await firstValueFrom(
      this.http
        .post<{ choices: { message: { content: string } }[] }>(
          `${this.baseUrl}/chat/completions`,
          body,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        )
        .pipe(timeout(this.requestTimeout)),
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty response');
    return content.trim();
  }
}
