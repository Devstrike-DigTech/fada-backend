import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '@common/decorators/public.decorator';
import { PrismaService } from '@infra/database/prisma.service';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('Health')
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

  @Get('ping')
  @Public()
  @ApiOperation({ summary: 'Simple liveness probe' })
  ping(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
