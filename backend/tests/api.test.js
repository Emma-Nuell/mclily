import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../server.js';
import connectDatabase from '../config/database.js';

describe('Server Health & Security Endpoints', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });
  it('GET /api/health should return 200 with { status: "ok" } and no leaks', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.body.version).toBeUndefined();
    expect(res.body.db).toBeUndefined();
  });

  it('GET /api/payments/active-gateway should return active payment processor', async () => {
    const res = await request(app).get('/api/payments/active-gateway');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(['paystack', 'bachs']).toContain(res.body.activeGateway);
  });

  it('GET /api/non-existent-route should return structured 404 error', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });

  it('GET /api/seo/sitemap.xml should return valid XML and exclude admin/checkout (Checklist 1.4.5)', async () => {
    const res = await request(app).get('/api/seo/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    expect(res.text).toContain('<urlset');
    expect(res.text).toContain('/shop');
    expect(res.text).toContain('/fabrics');
    expect(res.text).toContain('/tailoring');
    expect(res.text).not.toContain('/admin');
    expect(res.text).not.toContain('/checkout');
  });
});
