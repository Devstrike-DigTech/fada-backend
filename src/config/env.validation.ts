import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  ALLOWED_ORIGINS: Joi.string().allow('').optional(),
  SUPPORT_INBOX_EMAIL: Joi.string().email().allow('').optional(),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_SECRET_PREVIOUS: Joi.string().min(32).allow('').optional(),
  JWT_REFRESH_SECRET_PREVIOUS: Joi.string().min(32).allow('').optional(),
  TRUST_PROXY: Joi.number().integer().min(0).max(5).optional(),
  BODY_LIMIT: Joi.string()
    .pattern(/^\d+(kb|mb)$/)
    .allow('')
    .optional(),
  RATE_LIMIT_ENABLED: Joi.string().valid('true', 'false').allow('').optional(),
  REQUEST_LOGGING: Joi.string().valid('true', 'false').allow('').optional(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  PAYSTACK_SECRET_KEY: Joi.string().allow('').optional(),
  PAYSTACK_PUBLIC_KEY: Joi.string().allow('').optional(),
  FLUTTERWAVE_SECRET_KEY: Joi.string().allow('').optional(),
  FLUTTERWAVE_PUBLIC_KEY: Joi.string().allow('').optional(),
  FLUTTERWAVE_HASH: Joi.string().allow('').optional(),
  PAYMENT_DEFAULT_PROVIDER: Joi.string()
    .valid('paystack', 'flutterwave')
    .default('paystack'),
  PAYMENT_CALLBACK_URL: Joi.string().uri().allow('').optional(),
  PAYMENT_SUCCESS_REDIRECT_URL: Joi.string().uri().allow('').optional(),
  SUBSCRIPTION_GRACE_PERIOD_DAYS: Joi.number().integer().min(0).default(7),
  SUBSCRIPTION_PLAN_CHANGE_COOLDOWN_DAYS: Joi.number()
    .integer()
    .min(0)
    .default(30),
  SUBSCRIPTION_IMMEDIATE_CHANGE_THRESHOLD_DAYS: Joi.number()
    .integer()
    .min(0)
    .default(10),
  SUBSCRIPTION_PENDING_PAYMENT_TTL_HOURS: Joi.number()
    .integer()
    .min(1)
    .default(24),

  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),

  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),

  TERMII_API_KEY: Joi.string().allow('').optional(),
  TERMII_CHANNEL: Joi.string().valid('generic', 'dnd').default('generic'),
  NOTIFICATIONS_DEFAULT_COUNTRY_CODE: Joi.string().default('234'),
  APP_DEEP_LINK_SCHEME: Joi.string().default('fada://'),
  RESEND_API_KEY: Joi.string().allow('').optional(),
}).options({ allowUnknown: true });
