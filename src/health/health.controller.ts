import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { SKIP_ALL_THROTTLERS } from '@common/security/throttle.constants';
import { Public } from '@common/decorators/public.decorator';
import { PrismaService } from '@infra/database/prisma.service';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('Health')
@SkipThrottle(SKIP_ALL_THROTTLERS)
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Check overall service health' })
  check() {
    return this.health.check([
      // Database
      () =>
        this.prismaHealth.pingCheck('database', this.prismaService as never),

      // Redis
      () => this.redisHealth.isHealthy('redis'),

      // Memory — heap should not exceed 512 MB
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),

      // Disk — free space on root should be > 10%
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  /** Liveness: the process is up and the event loop answers. No dependencies, so a DB blip never restarts the app. */
  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Liveness probe (process only)' })
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: dependencies needed to serve traffic. Load balancers route only when this is 200. */
  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (database + Redis)' })
  ready() {
    return this.health.check([
      () =>
        this.prismaHealth.pingCheck('database', this.prismaService as never),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }

  @Get('ping')
  @Public()
  @ApiOperation({ summary: 'Simple liveness probe (alias of /health/live)' })
  ping(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
