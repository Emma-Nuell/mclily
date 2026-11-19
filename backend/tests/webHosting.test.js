import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import app from '../server.js';
import env from '../config/env.js';
import connectDatabase from '../config/database.js';
import Product, { RetailProduct, FabricProduct } from '../models/Product.js';
import User from '../models/User.js';
import EmailOutbox from '../models/EmailOutbox.js';
import { openEmail } from '../utils/emailPayload.js';
import {
  publicDocument,
  productOffer,
  renderDocument,
  escapeHtml,
  safeJson,
} from '../services/publicPageService.js';
import { mountWebApps } from '../services/webHostingService.js';
import { appUrl, publicOrigin } from '../vendor/publicUrls.mjs';

const origin = 'https://mclily.example';
const fixture = fileURLToPath(
  new URL('../../.test-data/hosting-fixture/', import.meta.url)
);
const template =
  '<!doctype html><html><head><title>Old title</title><meta name="description" content="old"><meta name="mclily-build" content="fixture"></head><body><div id="root"></div><script type="module" src="/assets/app-test.js"></script></body></html>';
const saved = { ...env };
let hosted;
const product = (overrides) =>
  RetailProduct.create({
    name: 'Actual shop item',
    slug: 'actual-shop-item',
    description: 'Real catalogue description',
    price: 1000,
    images: ['https://res.cloudinary.com/test/image/upload/item.jpg'],
    category: 'Clothing',
    sizes: [{ size: 'M', stock: 2 }],
    ...overrides,
  });
describe('Hosted public HTML, metadata and deployment contracts', () => {
  beforeAll(async () => {
    env.STOREFRONT_CATALOG_MODE = 'preview';
    await connectDatabase();
    await Promise.all([User.init(), Product.init(), EmailOutbox.init()]);
    for (const directory of ['store/assets', 'admin/assets'])
      await mkdir(fixture + directory, { recursive: true });
    await writeFile(fixture + 'store/index.html', template);
    await writeFile(
      fixture + 'admin/index.html',
      template.replace('Old title', 'Old admin')
    );
    await writeFile(fixture + 'store/sw.js', '// worker');
    await writeFile(fixture + 'store/manifest.webmanifest', '{}');
    await writeFile(fixture + 'store/assets/app-test.js', '// asset');
    await writeFile(fixture + 'admin/assets/app-test.js', '// admin asset');
    await writeFile(
      fixture + 'store/deployment.json',
      JSON.stringify({ catalogMode: 'preview', adminBase: '/admin/' })
    );
    hosted = express();
    hosted.use((req, res, next) =>
      req.path.startsWith('/api/') ? app(req, res, next) : next()
    );
    mountWebApps(hosted, {
      storefrontDir: fixture + 'store',
      adminDir: fixture + 'admin',
    });
  });
  beforeEach(async () => {
    for (const model of [Product, User, EmailOutbox])
      await model.deleteMany({});
    Object.assign(env, saved, {
      PUBLIC_SITE_URL: origin,
      FRONTEND_URL: origin,
      ADMIN_URL: origin + '/admin/',
      STOREFRONT_CATALOG_MODE: 'preview',
      EMAIL_PAYLOAD_KEY: 'b'.repeat(64),
    });
  });
  afterAll(async () => {
    for (const model of [Product, User, EmailOutbox])
      await model.deleteMany({});
    Object.assign(env, saved);
    await mongoose.disconnect();
  });
  it('serves readable public product HTML and share tags before JavaScript runs', async () => {
    const response = await request(hosted).get(
      '/product/relaxed-black-overshirt'
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1>Relaxed Black Overshirt</h1>');
    expect(response.text).toContain('property="og:title"');
    expect(response.text).toContain('Sample: Relaxed Black Overshirt');
    expect(response.text).toContain(
      origin + '/product/relaxed-black-overshirt'
    );
    expect(response.text).not.toContain('localhost');
    expect(response.text).not.toContain('"@type":"Product"');
  });
  it('keeps sample SEO and sitemap separate from the actual business catalog', async () => {
    await product();
    const response = await request(hosted).get('/sitemap.xml');
    expect(response.text).toContain(origin + '/fabrics/natural-linen');
    expect(response.text).not.toContain('/product/natural-linen');
    expect(response.text).not.toContain('actual-shop-item');
    expect(response.text).not.toMatch(/checkout|admin|account/);
    expect(response.text).toContain(origin + '/categories');
  });
  it('keeps public review pages indexable and provides the actual origin in robots', async () => {
    expect((await request(hosted).get('/robots.txt')).text).toContain(
      'Allow: /'
    );
    expect((await request(hosted).get('/robots.txt')).text).toContain(
      origin + '/sitemap.xml'
    );
    expect((await request(hosted).get('/')).text).toContain(
      'content="index,follow"'
    );
  });
  it('does not serve private or price-bearing content in the precached shell', async () => {
    const response = await request(hosted).get('/index.html');
    expect(response.text).toContain('content="fixture"');
    expect(response.text).not.toContain('Overshirt');
    expect(response.text).not.toContain('28,000');
    expect(response.text).toContain('noindex');
    expect(response.headers['cache-control']).toBe('no-cache');
  });
  it('serves admin deep links with admin HTML and noindex, keeping missing assets out of SPA fallback', async () => {
    const response = await request(hosted).get('/admin/orders');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>McLily Admin</title>');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await request(hosted).get('/admin/assets/missing.js')).status).toBe(
      404
    );
    expect((await request(hosted).get('/assets/missing.js')).status).toBe(404);
  });
  it('uses immutable hashed assets and fresh worker/manifest/private HTML', async () => {
    expect(
      (await request(hosted).get('/assets/app-test.js')).headers[
        'cache-control'
      ]
    ).toContain('immutable');
    for (const path of ['/sw.js', '/manifest.webmanifest'])
      expect((await request(hosted).get(path)).headers['cache-control']).toBe(
        'no-cache'
      );
    const account = await request(hosted).get('/account');
    expect(account.headers['x-robots-tag']).toContain('noindex');
    expect(account.headers['cache-control']).toBe('no-store');
    expect(account.text).not.toContain('Overshirt');
  });
  it('returns real HTTP 404s for missing/hidden live products and unknown pages', async () => {
    env.STOREFRONT_CATALOG_MODE = 'live';
    await product({ isActive: false });
    expect(
      (await request(hosted).get('/product/actual-shop-item')).status
    ).toBe(404);
    expect((await request(hosted).get('/product/missing')).status).toBe(404);
    expect((await request(hosted).get('/missing-page')).status).toBe(404);
  });
  it('uses fabric canonical URLs, per-yard prices and the one-yard availability minimum', async () => {
    env.STOREFRONT_CATALOG_MODE = 'live';
    const fabric = await FabricProduct.create({
      name: 'QA Linen',
      slug: 'qa-linen',
      description: 'By the yard',
      category: 'Fabric',
      price: 1,
      pricePerYard: 2500,
      material: 'Linen',
      images: ['/images/fabric.jpg'],
      colorVariants: [
        { colorName: 'Blue', colorCode: '#0000ff', rollStockHalfYards: 1 },
      ],
    });
    let doc = await publicDocument('/fabrics/qa-linen');
    expect(doc.structuredData.offers.price).toBe('2500.00');
    expect(doc.structuredData.offers.availability).toContain('OutOfStock');
    expect(doc.canonical).toBe(origin + '/fabrics/qa-linen');
    expect(
      doc.structuredData.offers.priceSpecification.referenceQuantity.unitCode
    ).toBe('YRD');
    fabric.colorVariants[0].rollStockHalfYards = 2;
    await fabric.save();
    doc = await publicDocument('/fabrics/qa-linen');
    expect(doc.structuredData.offers.availability).toContain('InStock');
    expect(
      (await request(hosted).get('/product/qa-linen')).headers.location
    ).toBe('/fabrics/qa-linen');
  });
  it('advertises available variant prices without inventing stock or losing zero overrides', () => {
    const data = {
      slug: 'variant',
      productType: 'retail',
      price: 100,
      sizes: [
        { stock: 2, reservedStock: 2, priceOverride: 1 },
        { stock: 1, priceOverride: 0 },
        { stock: 1, priceOverride: 50 },
      ],
    };
    expect(productOffer(data, origin)).toMatchObject({
      lowPrice: '0.00',
      highPrice: '50.00',
      availability: 'https://schema.org/InStock',
    });
    data.sizes.forEach((variant) => {
      variant.stock = 0;
    });
    expect(productOffer(data, origin).availability).toContain('OutOfStock');
  });
  it('escapes text, HTML attributes and JSON-LD script boundaries without replacement-string expansion', async () => {
    env.STOREFRONT_CATALOG_MODE = 'live';
    await product({
      name: '$& " </script><script>bad()</script>',
      description: '$` <img src=x onerror=bad()>',
      images: ['javascript:bad()'],
    });
    const doc = await publicDocument('/product/actual-shop-item');
    const html = renderDocument(template, doc);
    expect(html).not.toContain('<script>bad()');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('$&amp;');
    expect(doc.image).toBeNull();
    expect(JSON.parse(safeJson(doc.structuredData)).name).toBe(
      doc.structuredData.name
    );
    expect(escapeHtml('"&<>')).toBe('&quot;&amp;&lt;&gt;');
  });
  it('keeps APIs JSON-only/no-store and rejects metadata URLs carrying private query data', async () => {
    expect((await request(hosted).get('/api/not-a-route')).body.code).toBe(
      'ROUTE_NOT_FOUND'
    );
    expect(
      (await request(hosted).get('/api/health')).headers['cache-control']
    ).toBe('no-store');
    for (const path of [
      '//evil.test',
      '/checkout?token=secret',
      'https://evil.test',
      '/account#secret',
    ])
      expect(
        (await request(hosted).get('/api/seo/meta').query({ path })).status
      ).toBe(400);
  });
  it('keeps the legacy share endpoint canonical and removes the old localhost redirect', async () => {
    const response = await request(hosted).get('/api/seo/og/natural-linen');
    expect(response.status).toBe(200);
    expect(response.text).toContain(origin + '/fabrics/natural-linen');
    expect(response.text).not.toContain('http-equiv="refresh"');
  });
  it('rejects a web build whose catalog mode differs from server metadata', () => {
    env.STOREFRONT_CATALOG_MODE = 'live';
    expect(() =>
      mountWebApps(express(), {
        storefrontDir: fixture + 'store',
        adminDir: fixture + 'admin',
      })
    ).toThrow('Rebuild');
  });
  it.each([
    {
      adminUrl: origin + '/admin/',
      resetPath: '/admin/reset-password',
      loginPath: '/admin/login',
    },
    {
      adminUrl: 'https://admin.mclily.example',
      resetPath: '/reset-password',
      loginPath: '/login',
    },
  ])(
    'uses configured admin base $adminUrl in recovery and changed-password email links',
    async ({ adminUrl, resetPath, loginPath }) => {
      env.ADMIN_URL = adminUrl;
      const user = await User.create({
        fullName: 'Hosting QA',
        email: 'hosting@example.com',
        password: 'qa_original_password',
        role: 'admin',
      });
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: user.email });
      let job = await EmailOutbox.findOne({ kind: 'password_reset' }).select(
        '+payload'
      );
      const url = new URL(openEmail(job.payload).resetUrl);
      expect(url.origin).toBe(new URL(adminUrl).origin);
      expect(url.pathname).toBe(resetPath);
      const token = new URLSearchParams(url.hash.slice(1)).get('token');
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'qa_changed_password' });
      expect(response.status).toBe(200);
      job = await EmailOutbox.findOne({ kind: 'password_changed' }).select(
        '+payload'
      );
      expect(new URL(openEmail(job.payload).loginUrl).pathname).toBe(loginPath);
    }
  );
  it('builds trusted base-path URLs and rejects credential/path-bearing public origins', () => {
    expect(appUrl(origin + '/admin/', '/orders')).toBe(
      origin + '/admin/orders'
    );
    expect(appUrl(origin, '/account')).toBe(origin + '/account');
    expect(publicOrigin(origin + '/')).toBe(origin);
    for (const value of [
      'javascript:bad()',
      'https://user:pass@example.com',
      'https://example.com/subpath',
      'https://example.com?tracking=1',
    ])
      expect(() => publicOrigin(value)).toThrow();
  });
  it('blocks direct online order creation in a hosted sample storefront before stock or money writes', async () => {
    env.HOST_WEB_APPS = true;
    const item = await product();
    const before = await mongoose.connection.db
      .collection('orders')
      .countDocuments();
    const response = await request(app).post('/api/orders').send({});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PREVIEW_CHECKOUT_DISABLED');
    expect(
      await mongoose.connection.db.collection('orders').countDocuments()
    ).toBe(before);
    expect((await Product.findById(item._id)).sizes[0].stock).toBe(2);
  });
  it('keeps the same preview order guard with combined hosting disabled', async () => {
    env.HOST_WEB_APPS = false;
    const before = await mongoose.connection.db
      .collection('orders')
      .countDocuments();
    const response = await request(app).post('/api/orders').send({});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PREVIEW_CHECKOUT_DISABLED');
    expect(
      await mongoose.connection.db.collection('orders').countDocuments()
    ).toBe(before);
  });
});
