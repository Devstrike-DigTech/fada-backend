import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  url: process.env.APP_URL ?? 'http://localhost:3000',
  /** Comma-separated browser origins allowed by CORS (HTTP + WebSocket); '*' = any */
  allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
  /** Proxy hops in front of the app (Railway / load balancer) so req.ip is the client, not the proxy */
  trustProxy: parseInt(
    process.env.TRUST_PROXY ??
      (process.env.NODE_ENV === 'production' ? '1' : '0'),
    10,
  ),
  /** Max JSON / form body size */
  bodyLimit: process.env.BODY_LIMIT || '1mb',
  rateLimitEnabled: (process.env.RATE_LIMIT_ENABLED ?? 'true') !== 'false',
  requestLogging: (process.env.REQUEST_LOGGING ?? 'true') !== 'false',
  apiVersion: process.env.API_VERSION ?? 'v1',
  adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET,
  /** Team inbox that receives a copy of every new support ticket (optional) */
  supportInboxEmail: process.env.SUPPORT_INBOX_EMAIL || undefined,
  geoRadiusTiers: (process.env.GEO_RADIUS_TIERS_KM ?? '2,5,10,20,50')
    .split(',')
    .map(Number),
  reservationExpiryHours: parseInt(
    process.env.RESERVATION_EXPIRY_HOURS ?? '2',
    10,
  ),
  defaultLowStockThreshold: parseInt(
    process.env.DEFAULT_LOW_STOCK_THRESHOLD ?? '5',
    10,
  ),
  rateLimits: {
    guestSearchDaily: parseInt(process.env.GUEST_SEARCH_DAILY_LIMIT ?? '3', 10),
    guestReservationDaily: parseInt(
      process.env.GUEST_RESERVATION_DAILY_LIMIT ?? '1',
      10,
    ),
    otpHourly: parseInt(process.env.OTP_HOURLY_LIMIT ?? '3', 10),
    globalPerMinute: parseInt(
      process.env.GLOBAL_RATE_LIMIT_PER_MINUTE ?? '100',
      10,
    ),
  },
}));
