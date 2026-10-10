import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter that shares rooms across server instances through Redis
 * pub/sub, so a reservation update raised on instance A reaches a pharmacist
 * connected to instance B. Falls back to the in-memory adapter (single
 * instance) when Redis is unreachable at boot, rather than failing to start.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string,
  ) {
    super(app);
  }

  async connectToRedis(url: string, timeoutMs = 5000): Promise<boolean> {
    const pub = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    const sub = pub.duplicate();
    try {
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs),
        ),
      ]);
      this.adapterConstructor = createAdapter(pub, sub);
      this.clients = [pub, sub];
      this.logger.log(
        'Socket.IO Redis adapter connected (multi-instance rooms enabled)',
      );
      return true;
    } catch (err) {
      pub.disconnect();
      sub.disconnect();
      this.logger.warn(
        `Socket.IO Redis adapter unavailable (${(err as Error).message}); using in-memory rooms (single instance only)`,
      );
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const origins =
      !this.allowedOrigins || this.allowedOrigins === '*'
        ? true
        : this.allowedOrigins.split(',').map((o) => o.trim());
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: origins, credentials: true },
      // Clients only send small subscribe messages
      maxHttpBufferSize: 64 * 1024,
      pingInterval: 25_000,
      pingTimeout: 20_000,
    }) as { adapter: (a: unknown) => void };
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
