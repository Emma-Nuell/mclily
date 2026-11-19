import rateLimit from 'express-rate-limit';

/**
 * General API Rate Limiter: 120 requests per minute per IP (Checklist 5.6)
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again shortly.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Strict Auth Limiter: 10 attempts per 15 minutes per IP (Checklist 1.3.3)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
});
export const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many recovery attempts. Please try again after 15 minutes.', code: 'RECOVERY_RATE_LIMITED' } });
