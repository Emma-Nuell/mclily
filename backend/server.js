import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import env from './config/env.js';
import connectDatabase from './config/database.js';
import { startPaymentWorker } from './services/paymentWorker.js';
import { startEmailWorker } from './services/emailWorker.js';
import { startTelegramWorker } from './services/telegramWorker.js';
import { startTelegramPolling } from './services/telegramPollingService.js';
import { mountWebApps } from './services/webHostingService.js';
import { captureRawBody } from './middlewares/rawBodyMiddleware.js';
import { generalLimiter } from './middlewares/rateLimitMiddleware.js';
import { errorHandler, notFoundHandler } from './middlewares/errorMiddleware.js';

// Route Imports
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import posRoutes from './routes/posRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import telegramRoutes from './routes/telegramRoutes.js';
import seoRoutes from './routes/seoRoutes.js';
import creditRoutes from './routes/creditRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import deliveryRoutes from './routes/deliveryRoutes.js';
import reportRoutes from './routes/reportRoutes.js';

const app = express();

// 1. Security Headers (Checklist 1.3.9)
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'], upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null } } }));
if (env.TRUST_PROXY_HOPS) app.set('trust proxy', env.TRUST_PROXY_HOPS);

// 2. Restrictive CORS (Checklist 1.3.8)
const allowedOrigins = [...new Set([env.FRONTEND_URL, env.ADMIN_URL].map(value => new URL(value).origin))];
if (env.NODE_ENV !== 'production') allowedOrigins.push('http://localhost:5173', 'http://localhost:5174');
// Production-build PWA testing uses a separate origin so its worker cannot shadow Vite development.
if (env.NODE_ENV !== 'production') allowedOrigins.push('http://localhost:4173', 'http://127.0.0.1:4173');
if (env.NODE_ENV !== 'production' && env.DEV_LAN_HOST) for (const port of [5173, 5174, 4173]) allowedOrigins.push(`http://${env.DEV_LAN_HOST}:${port}`);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman) in dev
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS request blocked by McLily security policy'));
      }
    },
    credentials: true,
  })
);

// 3. Body Parsing with Raw Buffer capture for Webhooks (Checklist 1.2.1)
app.use(
  express.json({
    verify: captureRawBody,
    limit: '5mb',
  })
);
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// 4. Global Rate Limiter (Checklist 5.6)
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex'); next(); }, generalLimiter);

// 5. Health Check Endpoint - Clean, no internal leaks (Checklist 1.4.6)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 6. Mount Feature Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/customers', creditRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/seo', seoRoutes);
if (env.HOST_WEB_APPS) mountWebApps(app);

// 7. Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

// 8. Start Server (if not running in Vitest/test runner)
if (process.env.NODE_ENV !== 'test') {
  connectDatabase().then(() => {
    startPaymentWorker();
    startEmailWorker();
    startTelegramWorker();
    startTelegramPolling();
    app.listen(env.PORT, () => {
      console.log(`🚀 McLily API Server running in [${env.NODE_ENV}] mode on port ${env.PORT}`);
      console.log(`💳 Active Payment Gateway: [${env.ACTIVE_PAYMENT_GATEWAY.toUpperCase()}]`);
    });
  });
}

export default app;
