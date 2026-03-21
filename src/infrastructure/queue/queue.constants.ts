export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  INVENTORY_BATCH_UPLOAD: 'inventory.batch-upload',
  RESERVATION_EXPIRY: 'reservation.expiry',
  NAFDAC_CACHE_REFRESH: 'nafdac.cache-refresh',
  ANALYTICS_SNAPSHOT: 'analytics.snapshot',
  VERIFICATION_PCN: 'verification.pcn',
  VERIFICATION_CAC: 'verification.cac',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
