import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('v1'),
  APP_NAME: Joi.string().default('genie help'),

  // Domains (required in production; defaults serve development)
  API_DOMAIN: Joi.string().hostname().default('api.genieinprompt.app'),
  FRONTEND_DOMAIN: Joi.string().hostname().default('app.genieinprompt.app'),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_SSL: Joi.boolean().default(false),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // Security
  BCRYPT_ROUNDS: Joi.number().default(12),
  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  PIN_ENCRYPTION_KEY: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow(''),
  REDIS_DB: Joi.number().default(0),

  // Email - SendGrid
  // Allow empty so the app can start without SendGrid configured.
  // Email sending will be skipped/warned when the key is absent.
  SENDGRID_API_KEY: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().email().default('noreply@genieinprompt.app'),
  EMAIL_FROM_NAME: Joi.string().default('genie help'),

  // SMS
  // Allow empty so the app can start without Twilio configured.
  // SMS sending will be skipped/warned when credentials are absent.
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),
  TWILIO_PHONE_NUMBER: Joi.string().allow('').default(''),

  // File Upload
  MAX_FILE_SIZE: Joi.number().default(10485760),
  UPLOAD_DESTINATION: Joi.string().default('./uploads'),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  // CORS
  CORS_ORIGIN: Joi.string().default('*'),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),
  LOG_FILE_PATH: Joi.string().default('./logs'),

  // AI Services
  AI_ENABLED: Joi.boolean().default(true),
  TENSORFLOW_ENABLED: Joi.boolean().default(false),
  AI_API_KEY: Joi.string().allow(''),
  AI_BASE_URL: Joi.string().allow('').default('https://api.openai.com/v1'),
  AI_MODEL: Joi.string().default('gpt-4o-mini'),
  AI_MAX_TOKENS: Joi.number().default(2048),
  AI_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),
  AI_TOP_P: Joi.number().min(0).max(1).default(0.9),
  AI_REQUEST_TIMEOUT: Joi.number().default(30000),
  AI_FRAUD_BLOCK_THRESHOLD: Joi.number().min(0).max(1).default(0.85),
  AI_FRAUD_REVIEW_THRESHOLD: Joi.number().min(0).max(1).default(0.55),
  AI_SURGE_MAX_MULTIPLIER: Joi.number().default(3.5),
  AI_PLATFORM_FEE_PCT: Joi.number().default(8),
  ML_MODEL_PATH: Joi.string().default('./ml-models'),
  ML_MODEL_SIGNING_SECRET: Joi.string().min(32).required(),
  FEATURE_STORE_UPDATE_INTERVAL: Joi.number().default(300000),

  // Google Maps
  GOOGLE_MAPS_API_KEY: Joi.string().allow(''),

  // Monitoring
  HEALTH_CHECK_TIMEOUT: Joi.number().default(30000),
  METRICS_ENABLED: Joi.boolean().default(true),

  // Payment Facilitator
  PAYMENT_FACILITATOR_PROVIDER: Joi.string()
    .valid('mock', 'flutterwave', 'paystack')
    .default('mock'),
  PAYMENT_FACILITATOR_SECRET_KEY: Joi.string().allow('').default('mock_key'),
  PAYMENT_FACILITATOR_PUBLIC_KEY: Joi.string().allow('').default(''),
  PAYMENT_FACILITATOR_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  PAYMENT_FACILITATOR_CURRENCY: Joi.string().default('GHS'),
  PAYMENT_FACILITATOR_WEBHOOK_URL: Joi.string().uri().allow('').default(''),

  // Q Points AI Market Maker
  AI_MARKET_ENABLED: Joi.boolean().default(false),
  AI_PARTICIPANT_USER_ID: Joi.string().uuid().default('00000000-0000-0000-0000-000000000001'),
  AI_TARGET_INVENTORY: Joi.number().default(250000000000000),
  AI_MIN_INVENTORY: Joi.number().default(50000000000000),
  AI_MAX_INVENTORY: Joi.number().default(490000000000000),
  AI_TARGET_SPREAD_PCT: Joi.number().min(0).max(100).default(2.0),
  AI_ORDER_BASE_QTY: Joi.number().default(500),
  AI_MAX_ORDER_QTY: Joi.number().default(2500),
  AI_MAX_OPEN_ORDERS: Joi.number().integer().default(10),
  AI_ORDER_TTL_SECONDS: Joi.number().integer().default(300),
  AI_RUN_INTERVAL_SECONDS: Joi.number().integer().default(30),
  AI_MIN_CASH_RESERVE_USD: Joi.number().default(5000),

  // Cross-facilitator bridge
  AI_BRIDGE_MIN_RESERVE_USD: Joi.number().min(0).default(10000),
  AI_BRIDGE_REBALANCING_THRESHOLD_USD: Joi.number().min(0).default(5000),

  // On-Ramp / Off-Ramp
  DEPOSIT_DAILY_LIMIT_USD: Joi.number().min(0).default(10000),
  WITHDRAW_DAILY_LIMIT_USD: Joi.number().min(0).default(5000),
  MIN_DEPOSIT_AMOUNT_USD: Joi.number().min(0).default(1),
  MIN_WITHDRAW_AMOUNT_USD: Joi.number().min(0).default(5),
  DEPOSIT_RETURN_URL: Joi.string().uri().allow('').default('https://app.genieinprompt.app/deposit'),
  STRIPE_SECRET_KEY: Joi.string().allow('').default(''),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  FLUTTERWAVE_WEBHOOK_HASH: Joi.string().allow('').default(''),
  MPESA_CONSUMER_KEY: Joi.string().allow('').default(''),
  MPESA_CONSUMER_SECRET: Joi.string().allow('').default(''),
  MPESA_SHORTCODE: Joi.string().allow('').default(''),
  MPESA_PASSKEY: Joi.string().allow('').default(''),
  MPESA_CALLBACK_URL: Joi.string().uri().allow('').default(''),
  MPESA_B2C_INITIATOR: Joi.string().allow('').default(''),
  MPESA_B2C_CREDENTIAL: Joi.string().allow('').default(''),
  MTN_MOMO_API_KEY: Joi.string().allow('').default(''),
  MTN_MOMO_USER_ID: Joi.string().allow('').default(''),
  MTN_MOMO_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  WISE_API_KEY: Joi.string().allow('').default(''),
});
