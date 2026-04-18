import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface MetricPoint {
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
  timestamp: Date;
}

export interface PerformanceReport {
  timeframe: string;
  generatedAt: Date;
  requestMetrics: {
    total: number;
    avgDurationMs: number;
    p95DurationMs: number;
    errorRate: number;
  };
  systemMetrics: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    uptimeSeconds: number;
  };
  topSlowEndpoints: Array<{ endpoint: string; avgMs: number; count: number }>;
  errorSummary: Array<{ errorCode: string; count: number; lastSeenAt: Date }>;
}

export interface SystemStats {
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  nodeVersion: string;
  platform: string;
  pid: number;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // Rolling windows (cleared periodically)
  private readonly requestLog: Array<{
    endpoint: string;
    method: string;
    statusCode: number;
    durationMs: number;
    timestamp: Date;
  }> = [];

  private readonly errorLog: Array<{
    errorCode: string;
    message: string;
    endpoint?: string;
    timestamp: Date;
  }> = [];

  private readonly customMetrics: MetricPoint[] = [];

  private readonly MAX_REQUEST_LOG = 10_000;
  private readonly MAX_ERROR_LOG = 5_000;
  private readonly MAX_CUSTOM_METRICS = 50_000;

  private readonly startedAt = new Date();
  private cpuStart = process.cpuUsage();

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────
  // RECORD METHODS (called by interceptors / filters)
  // ─────────────────────────────────────────────────────

  recordRequest(endpoint: string, method: string, statusCode: number, durationMs: number): void {
    this.requestLog.push({ endpoint, method, statusCode, durationMs, timestamp: new Date() });
    if (this.requestLog.length > this.MAX_REQUEST_LOG) {
      this.requestLog.splice(0, this.requestLog.length - this.MAX_REQUEST_LOG);
    }
  }

  recordError(errorCode: string, message: string, endpoint?: string): void {
    this.errorLog.push({ errorCode, message, endpoint, timestamp: new Date() });
    if (this.errorLog.length > this.MAX_ERROR_LOG) {
      this.errorLog.splice(0, this.errorLog.length - this.MAX_ERROR_LOG);
    }
  }

  recordMetric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
    this.customMetrics.push({ name, value, unit, tags, timestamp: new Date() });
    if (this.customMetrics.length > this.MAX_CUSTOM_METRICS) {
      this.customMetrics.splice(0, this.customMetrics.length - this.MAX_CUSTOM_METRICS);
    }
  }

  // ─────────────────────────────────────────────────────
  // REPORTS
  // ─────────────────────────────────────────────────────

  getSystemStats(): SystemStats {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(this.cpuStart),
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    };
  }

  getPerformanceReport(timeframeMinutes = 60): PerformanceReport {
    const since = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const recentRequests = this.requestLog.filter((r) => r.timestamp >= since);
    const recentErrors = this.errorLog.filter((e) => e.timestamp >= since);

    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(this.cpuStart);

    // Request metrics
    const total = recentRequests.length;
    const durations = recentRequests.map((r) => r.durationMs).sort((a, b) => a - b);
    const avgDurationMs = total > 0 ? durations.reduce((s, d) => s + d, 0) / total : 0;
    const p95Index = Math.floor(durations.length * 0.95);
    const p95DurationMs = durations[p95Index] ?? 0;
    const errorCount = recentRequests.filter((r) => r.statusCode >= 500).length;
    const errorRate = total > 0 ? errorCount / total : 0;

    // Top slow endpoints
    const endpointMap = new Map<string, { total: number; count: number }>();
    for (const req of recentRequests) {
      const key = `${req.method} ${req.endpoint}`;
      const cur = endpointMap.get(key) ?? { total: 0, count: 0 };
      cur.total += req.durationMs;
      cur.count++;
      endpointMap.set(key, cur);
    }
    const topSlowEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, { total, count }]) => ({ endpoint, avgMs: Math.round(total / count), count }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 10);

    // Error summary
    const errorCodeMap = new Map<string, { count: number; lastSeenAt: Date }>();
    for (const e of recentErrors) {
      const cur = errorCodeMap.get(e.errorCode) ?? { count: 0, lastSeenAt: e.timestamp };
      cur.count++;
      if (e.timestamp > cur.lastSeenAt) cur.lastSeenAt = e.timestamp;
      errorCodeMap.set(e.errorCode, cur);
    }
    const errorSummary = Array.from(errorCodeMap.entries())
      .map(([errorCode, { count, lastSeenAt }]) => ({ errorCode, count, lastSeenAt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      timeframe: `last ${timeframeMinutes} minutes`,
      generatedAt: new Date(),
      requestMetrics: { total, avgDurationMs: Math.round(avgDurationMs), p95DurationMs, errorRate },
      systemMetrics: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        uptimeSeconds: Math.round(process.uptime()),
      },
      topSlowEndpoints,
      errorSummary,
    };
  }

  async getDatabaseStats(): Promise<Record<string, any>> {
    try {
      const [pgStats] = await this.dataSource.query(`
        SELECT 
          (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
          (SELECT COUNT(*) FROM pg_stat_activity) AS total_connections,
          pg_size_pretty(pg_database_size(current_database())) AS db_size
      `);
      return pgStats;
    } catch {
      return { error: 'Stats unavailable' };
    }
  }

  getCustomMetrics(name?: string, since?: Date): MetricPoint[] {
    let metrics = this.customMetrics;
    if (name) metrics = metrics.filter((m) => m.name === name);
    if (since) metrics = metrics.filter((m) => m.timestamp >= since);
    return metrics.slice(-1000); // last 1000 matching
  }

  getMetricSummary(name: string, timeframeMinutes = 60): { avg: number; min: number; max: number; count: number } {
    const since = new Date(Date.now() - timeframeMinutes * 60 * 1000);
    const values = this.customMetrics
      .filter((m) => m.name === name && m.timestamp >= since)
      .map((m) => m.value);

    if (values.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };

    return {
      avg: values.reduce((s, v) => s + v, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  }
}
