import http from 'node:http';
import https from 'node:https';
import { publicOrigin } from '../vendor/publicUrls.mjs';

const requestHeaders = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'content-length',
  'cookie',
  'user-agent',
  'origin',
  'idempotency-key',
  'x-idempotency-key',
  'x-order-access',
  'x-request-id',
]);
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createApiProxy({ apiOrigin, siteOrigin, timeoutMs = 75000 }) {
  const targetOrigin = publicOrigin(apiOrigin);
  const browserOrigin = publicOrigin(siteOrigin);
  if (targetOrigin === browserOrigin)
    throw new Error('API_ORIGIN must point to the separate backend.');
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (
      !req.url.startsWith('/api/') ||
      (req.headers.origin && req.headers.origin !== browserOrigin)
    ) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'This request is not allowed.',
        })
      );
      return;
    }
    // Never forward browser-supplied Host/Forwarded/X-Forwarded-* or compression headers.
    // Identity remains in the existing host-only HttpOnly cookie or explicit API authorization.
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => requestHeaders.has(name))
    );
    const target = new URL(targetOrigin);
    const upstream = (target.protocol === 'https:' ? https : http).request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        const blocked = new Set([
          ...hopHeaders,
          ...String(response.headers.connection || '')
            .toLowerCase()
            .split(',')
            .map((value) => value.trim()),
        ]);
        for (const [name, value] of Object.entries(response.headers))
          if (!blocked.has(name) && value !== undefined)
            res.setHeader(name, value);
        // A proxied API response, including an error or cookie, must never enter a CDN cache.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex');
        res.writeHead(response.statusCode || 502);
        response.on('error', () => res.destroy());
        response.pipe(res);
      }
    );
    upstream.setTimeout(timeoutMs, () =>
      upstream.destroy(new Error('Upstream timeout'))
    );
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          code: 'API_UNAVAILABLE',
          message:
            'The store connection is unavailable. Please try again shortly.',
        })
      );
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
}
