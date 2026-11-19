import { randomUUID } from 'node:crypto';

const apiGroups = new Set([
  'auth',
  'products',
  'orders',
  'payments',
  'pos',
  'customers',
  'email',
  'delivery',
  'reports',
  'media',
  'telegram',
  'seo',
]);
const publicSegments = new Set([
  'api',
  'health',
  ...apiGroups,
  'admin',
  'register',
  'login',
  'logout',
  'me',
  'forgot-password',
  'reset-password',
  'my-orders',
  'manage',
  'featured',
  'search',
  'stock-history',
  'status',
  'confirm',
  'resolution',
  'sale',
  'sales',
  'installment',
  'lookup',
  'entries',
  'upload',
  'verify',
  'test',
  'options',
  'webhook',
  'bachs',
  'paystack',
  'active-gateway',
  'meta',
  'og',
  'sitemap.xml',
]);

function pathOnly(req) {
  try {
    return new URL(req.originalUrl || req.url || '/', 'http://request.local')
      .pathname;
  } catch {
    return '/:invalid-path';
  }
}

export function requestRoute(req) {
  const path = pathOnly(req);
  const group = path.split('/')[2];
  if (typeof req.route?.path === 'string') {
    const prefix =
      path.startsWith('/api/') && apiGroups.has(group) ? '/api/' + group : '';
    const route = req.route.path.startsWith('/api/')
      ? req.route.path
      : prefix + req.route.path;
    return route === '/' ? route : route.replace(/\/$/, '');
  }
  // Unmatched/early-rejected requests have no route template. Never record
  // arbitrary path values, query tokens, phones or emails.
  return path
    .split('/')
    .slice(0, 12)
    .map((segment) =>
      !segment || publicSegments.has(segment) ? segment : ':param'
    )
    .join('/');
}

const errorLabel = (value) =>
  /^[A-Za-z0-9_]{1,80}$/.test(String(value || '')) ? String(value) : undefined;

export function requestLogger({
  enabled = true,
  logHealthChecks = false,
  write = (entry) => console.log(JSON.stringify(entry)),
} = {}) {
  return (req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    if (!enabled) return next();
    const started = process.hrtime.bigint();
    let recorded = false;
    const record = (aborted) => {
      if (recorded) return;
      recorded = true;
      const status = aborted ? 499 : res.statusCode;
      if (
        !aborted &&
        !logHealthChecks &&
        pathOnly(req) === '/api/health' &&
        status < 400
      )
        return;
      const error = res.locals?.requestError;
      const entry = {
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        event: 'http_request',
        requestId: req.requestId,
        method: String(req.method || '').slice(0, 20),
        path: requestRoute(req),
        status,
        durationMs:
          Math.round(Number(process.hrtime.bigint() - started) / 10000) / 100,
        ...(aborted ? { aborted: true } : {}),
        ...(error
          ? {
              error: {
                code: errorLabel(error.code),
                name: errorLabel(error.name),
              },
            }
          : {}),
      };
      // Logging must not change an order/payment response if the output fails.
      try {
        write(entry);
      } catch {
        /* The request has already completed. */
      }
    };
    res.once('finish', () => record(false));
    res.once('close', () => {
      if (!res.writableFinished) record(true);
    });
    next();
  };
}
