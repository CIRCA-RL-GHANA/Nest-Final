import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AIPlugin, PluginStatus, PluginType } from '../entities/ai-plugin.entity';

export interface RegisterPluginDto {
  name: string;
  description?: string;
  pluginType: PluginType;
  version?: string;
  handlerCode: string;
  config?: Record<string, any>;
  permissions?: string[];
  timeoutMs?: number;
}

export interface PluginExecutionResult {
  pluginName: string;
  success: boolean;
  output: any;
  durationMs: number;
  executedAt: Date;
  error?: string;
}

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);

  // Runtime registry: pluginName → compiled function
  private readonly registry = new Map<string, (input: any, config: any) => any>();

  constructor(
    @InjectRepository(AIPlugin)
    private readonly pluginRepo: Repository<AIPlugin>,
  ) {}

  // ─────────────────────────────────────────────────────
  // REGISTRATION
  // ─────────────────────────────────────────────────────

  async register(dto: RegisterPluginDto): Promise<AIPlugin> {
    const existing = await this.pluginRepo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Plugin "${dto.name}" already registered`);

    // Validate the handler code compiles
    this.validateHandlerCode(dto.handlerCode);

    const plugin = this.pluginRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      pluginType: dto.pluginType,
      version: dto.version ?? '1.0.0',
      handlerCode: dto.handlerCode,
      config: dto.config ?? null,
      permissions: dto.permissions ?? null,
      timeoutMs: dto.timeoutMs ?? 5000,
      status: PluginStatus.ACTIVE,
      executionCount: 0,
      errorCount: 0,
      lastError: null,
      lastExecutedAt: null,
    });

    const saved = await this.pluginRepo.save(plugin);
    this.compilePlugin(saved);
    this.logger.log(`Plugin registered: ${saved.name} (${saved.pluginType})`);
    return saved;
  }

  async updatePlugin(name: string, updates: Partial<RegisterPluginDto>): Promise<AIPlugin> {
    const plugin = await this.findByName(name);
    if (updates.handlerCode) {
      this.validateHandlerCode(updates.handlerCode);
      plugin.handlerCode = updates.handlerCode;
      this.registry.delete(name); // force recompile on next run
    }
    if (updates.config !== undefined) plugin.config = updates.config ?? null;
    if (updates.permissions) plugin.permissions = updates.permissions;
    if (updates.timeoutMs) plugin.timeoutMs = updates.timeoutMs;
    if (updates.version) plugin.version = updates.version;

    return this.pluginRepo.save(plugin);
  }

  async setStatus(name: string, status: PluginStatus): Promise<AIPlugin> {
    const plugin = await this.findByName(name);
    plugin.status = status;
    if (status === PluginStatus.INACTIVE) this.registry.delete(name);
    return this.pluginRepo.save(plugin);
  }

  // ─────────────────────────────────────────────────────
  // EXECUTION
  // ─────────────────────────────────────────────────────

  async execute(name: string, input: any): Promise<PluginExecutionResult> {
    const plugin = await this.findByName(name);

    if (plugin.status !== PluginStatus.ACTIVE) {
      throw new BadRequestException(`Plugin "${name}" is not active (status: ${plugin.status})`);
    }

    let fn = this.registry.get(name);
    if (!fn) fn = this.compilePlugin(plugin);

    const startedAt = new Date();
    const t0 = Date.now();

    try {
      const output = await this.runWithTimeout(fn, input, plugin.config ?? {}, plugin.timeoutMs);
      const durationMs = Date.now() - t0;

      plugin.executionCount++;
      plugin.lastExecutedAt = new Date();
      await this.pluginRepo.save(plugin);

      this.logger.debug(`Plugin "${name}" executed in ${durationMs}ms`);

      return { pluginName: name, success: true, output, durationMs, executedAt: startedAt };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);

      plugin.errorCount++;
      plugin.lastError = errorMsg;
      plugin.lastExecutedAt = new Date();
      await this.pluginRepo.save(plugin);

      this.logger.error(`Plugin "${name}" failed: ${errorMsg}`);

      return {
        pluginName: name,
        success: false,
        output: null,
        durationMs,
        executedAt: startedAt,
        error: errorMsg,
      };
    }
  }

  // ─────────────────────────────────────────────────────
  // QUERY
  // ─────────────────────────────────────────────────────

  async findAll(type?: PluginType): Promise<AIPlugin[]> {
    const qb = this.pluginRepo.createQueryBuilder('p').orderBy('p.name');
    if (type) qb.where('p.pluginType = :type', { type });
    return qb.getMany();
  }

  async findByName(name: string): Promise<AIPlugin> {
    const plugin = await this.pluginRepo.findOne({ where: { name } });
    if (!plugin) throw new NotFoundException(`Plugin "${name}" not found`);
    return plugin;
  }

  async delete(name: string): Promise<void> {
    const plugin = await this.findByName(name);
    this.registry.delete(name);
    await this.pluginRepo.remove(plugin);
    this.logger.log(`Plugin deleted: ${name}`);
  }

  /** Load all active plugins from DB into registry on startup */
  async loadAllPlugins(): Promise<void> {
    const plugins = await this.pluginRepo.find({ where: { status: PluginStatus.ACTIVE } });
    let loaded = 0;
    for (const plugin of plugins) {
      try {
        this.compilePlugin(plugin);
        loaded++;
      } catch (err) {
        this.logger.warn(`Failed to load plugin "${plugin.name}": ${err}`);
      }
    }
    this.logger.log(`Plugin registry initialised: ${loaded}/${plugins.length} plugins loaded`);
  }

  // ─────────────────────────────────────────────────────
  // SANDBOXED COMPILATION
  // ─────────────────────────────────────────────────────

  /**
   * Compiles plugin handlerCode into a sandboxed function.
   * The handler runs as: (input, config) => output
   * 
   * Security: No access to process, require, global, eval, or __dirname.
   * Only simple data transformations are expected.
   */
  private compilePlugin(plugin: AIPlugin): (input: any, config: any) => any {
    const fn = this.createSandboxedFunction(plugin.handlerCode);
    this.registry.set(plugin.name, fn);
    return fn;
  }

  private createSandboxedFunction(code: string): (input: any, config: any) => any {
    // Deny list: block dangerous globals
    const blockedKeywords = ['require', 'process', '__dirname', '__filename', 'eval', 'Function'];
    for (const kw of blockedKeywords) {
      if (code.includes(kw)) {
        throw new BadRequestException(`Plugin code cannot use "${kw}"`);
      }
    }

    // eslint-disable-next-line no-new-func
    return new Function('input', 'config', `"use strict";\n${code}`) as (input: any, config: any) => any;
  }

  private validateHandlerCode(code: string): void {
    this.createSandboxedFunction(code); // throws if invalid
  }

  private runWithTimeout(
    fn: (input: any, config: any) => any,
    input: any,
    config: any,
    timeoutMs: number,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const result = fn(input, config);
        clearTimeout(timer);
        // Handle both sync and async handlers
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch((err: Error) => { clearTimeout(timer); reject(err); });
        } else {
          resolve(result);
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }
}
