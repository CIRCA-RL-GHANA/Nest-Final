export const configuration = () => ({
  // Application
  appName: process.env.APP_NAME || 'genie help',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  apiVersion: process.env.API_VERSION || 'v1',

  // Domains (used by nginx templates, CORS, and outbound links)
  domain: {
    api: process.env.API_DOMAIN || 'api.genieinprompt.app',
    frontend: process.env.FRONTEND_DOMAIN || 'app.genieinprompt.app',
  },

  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME || 'promptgenie_dev',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  // Security
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10),
    pinEncryptionKey: process.env.PIN_ENCRYPTION_KEY,
  },

  // Redis — prefer REDIS_URL (Upstash / Railway), fall back to individual vars
  redis: (() => {
    const url = process.env.REDIS_URL;
    if (url) {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port, 10),
        password: parsed.password || undefined,
        db: parseInt(parsed.pathname.slice(1) || '0', 10),
        tls: parsed.protocol === 'rediss:',
      };
    }
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      tls: process.env.REDIS_TLS === 'true',
    };
  })(),

  // Email - SendGrid
  email: {
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    from: process.env.EMAIL_FROM || 'noreply@genieinprompt.app',
    fromName: process.env.EMAIL_FROM_NAME || 'genie help',
  },

  // SMS
  sms: {
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
    destination: process.env.UPLOAD_DESTINATION || './uploads',
  },

  // Rate Limiting
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || './logs',
  },

  // AI Services
  ai: {
    enabled: process.env.AI_ENABLED !== 'false',
    tensorflowEnabled: process.env.TENSORFLOW_ENABLED === 'true',
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048', 10),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    topP: parseFloat(process.env.AI_TOP_P || '0.9'),
    requestTimeout: parseInt(process.env.AI_REQUEST_TIMEOUT || '30000', 10),
    fraudBlockThreshold: parseFloat(process.env.AI_FRAUD_BLOCK_THRESHOLD || '0.85'),
    fraudReviewThreshold: parseFloat(process.env.AI_FRAUD_REVIEW_THRESHOLD || '0.55'),
    surgeMaxMultiplier: parseFloat(process.env.AI_SURGE_MAX_MULTIPLIER || '3.5'),
    platformFeePct: parseFloat(process.env.AI_PLATFORM_FEE_PCT || '8'),
    modelPath: process.env.ML_MODEL_PATH || './ml-models',
    featureStoreUpdateInterval: parseInt(process.env.FEATURE_STORE_UPDATE_INTERVAL || '300000', 10),
    // Q Points market liquidity AI
    market: {
      enabled: process.env.AI_MARKET_ENABLED === 'true',
      participantUserId:
        process.env.AI_PARTICIPANT_USER_ID ?? '00000000-0000-0000-0000-000000000001',
      targetInventory: parseFloat(process.env.AI_TARGET_INVENTORY ?? '250000000000000'),
      minInventory: parseFloat(process.env.AI_MIN_INVENTORY ?? '50000000000000'),
      maxInventory: parseFloat(process.env.AI_MAX_INVENTORY ?? '490000000000000'),
      targetSpreadPct: parseFloat(process.env.AI_TARGET_SPREAD_PCT ?? '2.0'),
      orderBaseQty: parseFloat(process.env.AI_ORDER_BASE_QTY ?? '500'),
      maxOrderQty: parseFloat(process.env.AI_MAX_ORDER_QTY ?? '2500'),
      maxOpenOrders: parseInt(process.env.AI_MAX_OPEN_ORDERS ?? '10', 10),
      orderTtlSeconds: parseInt(process.env.AI_ORDER_TTL_SECONDS ?? '300', 10),
      runIntervalSeconds: parseInt(process.env.AI_RUN_INTERVAL_SECONDS ?? '30', 10),
      minCashReserveUsd: parseFloat(process.env.AI_MIN_CASH_RESERVE_USD ?? '5000'),
    },
    // Cross-facilitator bridge (matched principal)
    bridge: {
      minReserveUsd: parseFloat(process.env.AI_BRIDGE_MIN_RESERVE_USD ?? '10000'),
      rebalancingThresholdUsd: parseFloat(process.env.AI_BRIDGE_REBALANCING_THRESHOLD_USD ?? '5000'),
    },
  },

  // Google Maps
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },

  // Cloudinary (file / image storage — replaces S3)
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  // Error Tracking (Sentry)
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },

  // Monitoring
  monitoring: {
    healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '30000', 10),
    metricsEnabled: process.env.METRICS_ENABLED === 'true',
  },

  // Payment facilitator (Flutterwave / Paystack / mock)
  payments: {
    facilitatorProvider: process.env.PAYMENT_FACILITATOR_PROVIDER ?? 'mock',
    facilitatorSecretKey: process.env.PAYMENT_FACILITATOR_SECRET_KEY ?? 'mock_key',
    facilitatorPublicKey: process.env.PAYMENT_FACILITATOR_PUBLIC_KEY ?? '',
    webhookSecret: process.env.PAYMENT_FACILITATOR_WEBHOOK_SECRET ?? '',
    facilitatorCurrency: process.env.PAYMENT_FACILITATOR_CURRENCY ?? 'GHS',
    facilitatorWebhookUrl: process.env.PAYMENT_FACILITATOR_WEBHOOK_URL ?? '',

    // On-Ramp / Off-Ramp limits & keys
    dailyDepositLimit: +(process.env.DEPOSIT_DAILY_LIMIT_USD ?? 10000),
    dailyWithdrawLimit: +(process.env.WITHDRAW_DAILY_LIMIT_USD ?? 5000),
    minDepositAmount: +(process.env.MIN_DEPOSIT_AMOUNT_USD ?? 1),
    minWithdrawAmount: +(process.env.MIN_WITHDRAW_AMOUNT_USD ?? 5),
    depositReturnUrl: process.env.DEPOSIT_RETURN_URL ?? 'https://app.genieinprompt.app/deposit',

    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    },
    flutterwave: {
      secretKey: process.env.PAYMENT_FACILITATOR_SECRET_KEY ?? '',
      webhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH ?? '',
    },
    paystack: {
      secretKey: process.env.PAYMENT_FACILITATOR_SECRET_KEY ?? '',
    },
    mpesa: {
      consumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
      consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
      shortcode: process.env.MPESA_SHORTCODE ?? '',
      passkey: process.env.MPESA_PASSKEY ?? '',
      callbackUrl: process.env.MPESA_CALLBACK_URL ?? '',
      b2cInitiator: process.env.MPESA_B2C_INITIATOR ?? '',
      b2cCredential: process.env.MPESA_B2C_CREDENTIAL ?? '',
    },
    mtnMomo: {
      apiKey: process.env.MTN_MOMO_API_KEY ?? '',
      userId: process.env.MTN_MOMO_USER_ID ?? '',
      webhookSecret: process.env.MTN_MOMO_WEBHOOK_SECRET ?? '',
    },
    wise: {
      apiKey: process.env.WISE_API_KEY ?? '',
    },
  },
});
