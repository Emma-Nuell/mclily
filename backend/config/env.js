import dotenv from "dotenv";
import { z } from "zod";
import { isPrivateIpv4 } from '../vendor/localApi.mjs';
import { publicOrigin, appUrl } from '../vendor/publicUrls.mjs';

// Tests must receive an explicit isolated configuration, never developer credentials.
if (process.env.NODE_ENV !== 'test') dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  REQUEST_LOG_ENABLED: z.enum(['true', 'false']).default(process.env.NODE_ENV === 'test' ? 'false' : 'true').transform(value => value === 'true'),
  REQUEST_LOG_HEALTH_CHECKS: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/mclily"),
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must be at least 16 characters")
    .default("development_jwt_secret_mclily_key_minimum_length_required"),
  JWT_EXPIRES_IN: z.string().default("14d"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  ADMIN_URL: z.string().default("http://localhost:5174"),
  HOST_WEB_APPS: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  PUBLIC_SITE_URL: z.string().optional(),
  STOREFRONT_CATALOG_MODE: z.enum(['preview', 'live']).default(process.env.NODE_ENV === 'test' ? 'live' : 'preview'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(process.env.RENDER === 'true' ? 1 : 0),
  DEV_LAN_HOST: z.string().default('').refine(value => !value || isPrivateIpv4(value), 'Use the laptop’s private Wi-Fi IPv4 address.'),
  // Optional deployment override; otherwise use config/delivery.json. Sample zones stay disabled.
  DELIVERY_CONFIG_JSON: z.string().optional(),

  // Dynamic Payment Switch
  ACTIVE_PAYMENT_GATEWAY: z.enum(["paystack", "bachs"]).default("bachs"),

  // Paystack Keys
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),

  // Bachs.io Keys
  BACHS_SECRET_KEY: z.string().optional(),
  BACHS_PUBLIC_KEY: z.string().optional(),
  BACHS_WEBHOOK_SECRET: z.string().optional(),
  BACHS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  BACHS_REFUNDS_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),

  // Media (Cloudinary)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("McLily <orders@mclily.com>"),
  SMTP_REPLY_TO: z.string().optional(),
  EMAIL_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  EMAIL_PAYLOAD_KEY: z.string().optional(),
  EMAIL_OPERATIONS_TO: z.string().default(''),
  EMAIL_TECHNICAL_TO: z.string().default(''),
  EMAIL_FINANCIAL_TO: z.string().default(''),
  EMAIL_MAX_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(50),
  EMAIL_MAX_PER_DAY: z.coerce.number().int().min(1).max(100000).default(200),
  FINANCIAL_SUMMARY_FIRST_AT: z.string().datetime().optional(),

  // Telegram AI Bot
  TELEGRAM_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  TELEGRAM_TRANSPORT: z.enum(['webhook', 'polling']).default('webhook'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OWNER_ID: z.string().optional(),
  TELEGRAM_SECRET_TOKEN: z.string().optional(),
  TELEGRAM_PAYLOAD_KEY: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),

  // Google Gemini AI for Multimodal Voice/Photo Product Parsing
  GEMINI_API_KEY: z.string().optional(),
  AI_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  GEMINI_MODEL: z.string().default(''),
  AI_MONTHLY_REQUEST_LIMIT: z.coerce.number().int().min(0).max(100000).default(0),
  AI_MONTHLY_BUDGET_NAIRA: z.coerce.number().min(0).default(0),
  AI_REQUEST_RESERVE_NAIRA: z.coerce.number().min(0).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables at startup:",
    parsed.error.format(),
  );
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
if (env.HOST_WEB_APPS) {
  env.FRONTEND_URL = publicOrigin(env.PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL || env.FRONTEND_URL);
  env.ADMIN_URL = process.env.ADMIN_URL || appUrl(env.FRONTEND_URL, 'admin/');
}
if (env.NODE_ENV === 'production') {
  if (!process.env.MONGODB_URI) throw new Error('Production requires an explicit MONGODB_URI.');
  if (env.JWT_SECRET === 'development_jwt_secret_mclily_key_minimum_length_required' || env.JWT_SECRET.length < 32) throw new Error('Production requires a private JWT_SECRET of at least 32 characters.');
  for (const value of [env.FRONTEND_URL, env.ADMIN_URL]) if (new URL(value).protocol !== 'https:') throw new Error('Production frontend/admin URLs must use HTTPS.');
}
if (env.NODE_ENV === 'production' && env.TELEGRAM_ENABLED && env.TELEGRAM_TRANSPORT === 'polling') throw new Error('Production Telegram uses HTTPS webhooks. Polling is for local development.');
if (env.TELEGRAM_PAYLOAD_KEY && !/^[a-f0-9]{64}$/i.test(env.TELEGRAM_PAYLOAD_KEY)) throw new Error('TELEGRAM_PAYLOAD_KEY must contain 64 hexadecimal characters.');
if (env.EMAIL_PAYLOAD_KEY && !/^[a-f0-9]{64}$/i.test(env.EMAIL_PAYLOAD_KEY)) throw new Error('EMAIL_PAYLOAD_KEY must contain 64 hexadecimal characters.');
if (env.NODE_ENV === 'production' && env.EMAIL_ENABLED && !env.EMAIL_PAYLOAD_KEY) throw new Error('Set EMAIL_PAYLOAD_KEY before enabling production email.');
export default env;
