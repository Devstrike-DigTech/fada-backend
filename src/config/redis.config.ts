import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  ttlSeconds: parseInt(process.env.REDIS_TTL_SECONDS ?? '86400', 10),
}));
