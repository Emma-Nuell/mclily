import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { requestLogger, requestRoute } from '../middlewares/requestLogger.js';
import {
  errorHandler,
  notFoundHandler,
} from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import app from '../server.js';

function fixture(options = {}) {
  const entries = [],
    server = express();
  server.use(
    requestLogger({ write: (entry) => entries.push(entry), ...options })
  );
  server.use(express.json());
  return { server, entries };
}

describe('Safe backend request logging', () => {
  it('prints compact successes and visible safe failure details on the appropriate console streams', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = express();
      server.use(requestLogger());
      server.get('/api/orders', (req, res) => res.json({ success: true }));
      server.get('/api/reports/sales', () => {
        throw new AppError(
          500,
          'REPORT_FAILURE',
          'private-password and mongodb://secret'
        );
      });
      server.use(notFoundHandler);
      server.use(errorHandler);
      await request(server).get('/api/orders?access=private-token');
      await request(server).get('/api/notfound');
      await request(server).get('/api/reports/sales');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(
        /^\[\d{4}-\d\d-\d\dT[^\]]+\] GET \/api\/orders$/
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        'GET /api/:param -> 404 ROUTE_NOT_FOUND'
      );
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain(
        'GET /api/reports/sales -> 500 REPORT_FAILURE'
      );
      expect(
        JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])
      ).not.toMatch(/private-password|mongodb|private-token/);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
  it('logs completed method/route/status/duration with a generated response request ID', async () => {
    const { server, entries } = fixture();
    const router = express.Router();
    router.get('/', (req, res) => res.json({ success: true }));
    server.use('/api/orders', router);
    const response = await request(server)
      .get('/api/orders?status=processing&limit=4')
      .set('X-Request-Id', 'untrusted-request-id');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      event: 'http_request',
      method: 'GET',
      path: '/api/orders',
      status: 200,
      level: 'info',
      requestId: response.headers['x-request-id'],
    });
    expect(entries[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(Date.parse(entries[0].timestamp))).toBe(true);
  });
  it('omits query/body/credentials/cookies and logs dynamic route templates instead of identifiers', async () => {
    const { server, entries } = fixture();
    const router = express.Router();
    router.post('/:id', (req, res) => res.json({ success: true }));
    server.use('/api/orders', router);
    await request(server)
      .post(
        '/api/orders/private-order-reference?access=guest-access-secret&phone=08000001111'
      )
      .set('Authorization', 'Bearer private-bearer')
      .set('Cookie', 'mcl_jwt=private-cookie')
      .send({
        password: 'private-password',
        email: 'private@example.com',
        address: 'private-address',
      });
    expect(entries[0].path).toBe('/api/orders/:id');
    const serialized = JSON.stringify(entries);
    for (const value of [
      'guest-access-secret',
      '08000001111',
      'private-bearer',
      'private-cookie',
      'private-password',
      'private@example.com',
      'private-address',
      'private-order-reference',
    ])
      expect(serialized).not.toContain(value);
  });
  it('logs warning/error statuses and safe error labels without raw exception messages or stack', async () => {
    const { server, entries } = fixture();
    server.get('/api/reports/sales', () => {
      throw new AppError(
        503,
        'REPORT_UNAVAILABLE',
        'Private URI mongodb://user:password@database/private'
      );
    });
    server.use(errorHandler);
    const response = await request(server).get('/api/reports/sales');
    expect(response.status).toBe(503);
    expect(entries[0]).toMatchObject({
      level: 'error',
      path: '/api/reports/sales',
      status: 503,
      error: { name: 'Error', code: 'REPORT_UNAVAILABLE' },
    });
    expect(JSON.stringify(entries)).not.toMatch(
      /mongodb|password|database|stack/
    );
    expect(response.headers['x-request-id']).toBe(entries[0].requestId);
  });
  it('records failures before routing while redacting unmatched paths and query values', async () => {
    const { server, entries } = fixture();
    server.use(notFoundHandler);
    await request(server).get('/api/unknown/private-token?token=other-secret');
    expect(entries[0]).toMatchObject({
      path: '/api/:param/:param',
      status: 404,
      level: 'warn',
      error: { code: 'ROUTE_NOT_FOUND' },
    });
    expect(JSON.stringify(entries)).not.toMatch(/private-token|other-secret/);
    expect(requestRoute({ url: '/auth/me' })).toBe('/auth/me');
  });
  it('includes body-parser failures without writing the invalid request body', async () => {
    const { server, entries } = fixture();
    server.post('/api/auth/login', (req, res) => res.json({ success: true }));
    server.use(errorHandler);
    const response = await request(server)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"body-parser-private-secret"');
    expect(response.status).toBe(400);
    expect(entries[0]).toMatchObject({
      status: 400,
      path: '/api/auth/login',
      error: { name: 'SyntaxError' },
    });
    expect(JSON.stringify(entries)).not.toContain('body-parser-private-secret');
  });
  it('keeps successful health checks quiet unless enabled but logs failed checks', async () => {
    const { server, entries } = fixture();
    server.get('/api/health', (req, res) =>
      res.status(req.query.fail ? 503 : 200).json({ status: 'fixture' })
    );
    await request(server).get('/api/health');
    expect(entries).toHaveLength(0);
    await request(server).get('/api/health?fail=true');
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe(503);
    const visible = fixture({ logHealthChecks: true });
    visible.server.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    await request(visible.server).get('/api/health');
    expect(visible.entries).toHaveLength(1);
  });
  it('can disable logs while keeping a request ID and cannot break responses when a writer fails', async () => {
    const silent = fixture({ enabled: false });
    silent.server.get('/api/orders', (req, res) => res.json({ success: true }));
    const response = await request(silent.server).get('/api/orders');
    expect(silent.entries).toHaveLength(0);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const broken = fixture({
      write: () => {
        throw new Error('fixture output unavailable');
      },
    });
    broken.server.get('/api/orders', (req, res) => res.json({ success: true }));
    expect((await request(broken.server).get('/api/orders')).body.success).toBe(
      true
    );
  });
  it('records a client disconnect once instead of reporting it as a successful response', () => {
    const entries = [],
      req = { method: 'GET', url: '/api/orders?access=private' },
      res = new EventEmitter();
    Object.assign(res, {
      statusCode: 200,
      locals: {},
      writableFinished: false,
      setHeader() {},
    });
    requestLogger({ write: (entry) => entries.push(entry) })(
      req,
      res,
      () => {}
    );
    res.emit('close');
    res.writableFinished = true;
    res.emit('finish');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 499, aborted: true });
    expect(JSON.stringify(entries)).not.toContain('private');
  });
  it('does not accept arbitrary error text as a log label', async () => {
    const { server, entries } = fixture();
    server.get('/api/orders', () => {
      const error = new Error('secret-message');
      error.code = 'secret@example.com';
      throw error;
    });
    server.use(errorHandler);
    await request(server).get('/api/orders');
    expect(JSON.stringify(entries)).not.toMatch(
      /secret-message|secret@example.com/
    );
  });
  it('wires request IDs before actual backend authentication and 404 handlers', async () => {
    const denied = await request(app).get('/api/auth/me');
    expect(denied.status).toBe(401);
    expect(denied.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const missing = await request(app).get('/api/not-a-route');
    expect(missing.status).toBe(404);
    expect(missing.headers['x-request-id']).not.toBe(
      denied.headers['x-request-id']
    );
  });
});
