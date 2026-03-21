import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  url: process.env.APP_URL ?? 'http://localhost:3000',
  apiVersion: process.env.API_VERSION ?? 'v1',
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
    guestSearchDaily: parseInt(
      process.env.GUEST_SEARCH_DAILY_LIMIT ?? '3',
      10,
    ),
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
