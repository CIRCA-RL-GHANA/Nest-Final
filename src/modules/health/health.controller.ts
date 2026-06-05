import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator';
import { MonitoringService } from './monitoring.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private readonly monitoring: MonitoringService,
  ) {}

  // Liveness probes are intentionally public — consumed by Docker, nginx, and
  // load-balancer health checks that do not carry a Bearer token.
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check application health' })
  @ApiResponse({ status: 200, description: 'Application is healthy' })
  @ApiResponse({ status: 503, description: 'Application is unhealthy' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Check if application is ready' })
  @ApiResponse({ status: 200, description: 'Application is ready' })
  ready() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Check if application is alive' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // ─────────────────────────────────────────────────────
  // MONITORING ENDPOINTS — authenticated (JwtAuthGuard via global APP_GUARD)
  // ─────────────────────────────────────────────────────

  @Get('metrics/system')
  @ApiOperation({ summary: 'Get current system stats (memory, CPU, uptime)' })
  getSystemStats() {
    return this.monitoring.getSystemStats();
  }

  @Get('metrics/performance')
  @ApiOperation({ summary: 'Get performance report for the given timeframe' })
  @ApiQuery({ name: 'minutes', required: false, type: Number, description: 'Timeframe in minutes (default 60)' })
  getPerformanceReport(@Query('minutes') minutes?: number) {
    return this.monitoring.getPerformanceReport(minutes ? Number(minutes) : 60);
  }

  @Get('metrics/database')
  @ApiOperation({ summary: 'Get database connection and size statistics' })
  getDatabaseStats() {
    return this.monitoring.getDatabaseStats();
  }

  @Get('metrics/custom')
  @ApiOperation({ summary: 'Get custom recorded metrics' })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'since', required: false, type: String, description: 'ISO 8601 date string' })
  getCustomMetrics(@Query('name') name?: string, @Query('since') since?: string) {
    return this.monitoring.getCustomMetrics(name, since ? new Date(since) : undefined);
  }

  @Get('metrics/summary/:name')
  @ApiOperation({ summary: 'Get aggregated summary for a custom metric' })
  @ApiQuery({ name: 'minutes', required: false, type: Number })
  getMetricSummary(@Param('name') name: string, @Query('minutes') minutes?: number) {
    return this.monitoring.getMetricSummary(name, minutes ? Number(minutes) : 60);
  }
}
