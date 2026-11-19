import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorefront } from '../server/app.mjs';

let directory,
  backend,
  storefront,
  liveStorefront,
  origin,
  liveOrigin,
  apiOrigin;
let unavailable = false,
  catalogReads = 0;
const publicOrigin = 'https://shop.example';
const sampleSlug = '/product/relaxed-black-overshirt';
const retail = {
  isActive: true,
  productType: 'retail',
  name: 'Actual API product',
  slug: 'actual-api-product',
  description: 'Actual product description',
  price: 4200,
  images: ['/images/product.webp'],
  sizes: [{ size: 'M', stock: 1, reservedStock: 0 }],
};
const fabric = {
  isActive: true,
  productType: 'fabric',
  name: 'Actual fabric',
  slug: 'actual-fabric',
  description: 'Fabric description',
  price: 2500,
  pricePerYard: 2500,
  images: ['/images/fabric.webp'],
  colorVariants: [
    { color: 'Blue', rollStockHalfYards: 2, reservedHalfYards: 1 },
  ],
};
async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const get = (path, options) => fetch(origin + path, options);
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mcl-storefront-test-'));
  for (const folder of ['preview/assets', 'live/assets'])
    await mkdir(join(directory, folder), { recursive: true });
  for (const mode of ['preview', 'live']) {
    const dist = join(directory, mode);
    await writeFile(
      join(dist, 'index.html'),
      '<!doctype html><html><head><title>Old title</title><meta name="mclily-build" content="fixture"></head><body><div id="root"></div></body></html>'
    );
    await writeFile(
      join(dist, 'deployment.json'),
      JSON.stringify({ catalogMode: mode, apiBase: '/api' })
    );
    await writeFile(join(dist, 'assets/app-hash.js'), 'console.log("fixture")');
    await writeFile(join(dist, 'sw.js'), '// fixture worker');
    await writeFile(join(dist, 'manifest.webmanifest'), '{"name":"McLily"}');
  }
  backend = await listen(async (req, res) => {
    const url = new URL(req.url, 'https://api.example');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/api/products')) {
      catalogReads++;
      if (unavailable) {
        res.writeHead(503);
        return res.end(JSON.stringify({ success: false }));
      }
      const slug = url.pathname.slice('/api/products/'.length);
      if (url.pathname !== '/api/products') {
        const product = [retail, fabric].find((item) => item.slug === slug);
        res.writeHead(product ? 200 : 404);
        return res.end(
          JSON.stringify({ success: Boolean(product), data: product })
        );
      }
      // Two real pages prove sitemap gathering does not stop after the first API page.
      const data = url.searchParams.get('page') === '2' ? [fabric] : [retail];
      return res.end(JSON.stringify({ success: true, data, pages: 2 }));
    }
    if (url.pathname === '/api/auth/login') {
      res.setHeader('Set-Cookie', [
        'mcl_jwt=fixture; Path=/; HttpOnly; Secure; SameSite=Lax',
        'second=fixture; Path=/; HttpOnly; Secure; SameSite=Lax',
      ]);
      return res.end(JSON.stringify({ success: true }));
    }
    if (url.pathname === '/api/orders') {
      res.writeHead(409);
      return res.end(
        JSON.stringify({ success: false, code: 'PREVIEW_CHECKOUT_DISABLED' })
      );
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.end(
      JSON.stringify({
        method: req.method,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers,
      })
    );
  });
  apiOrigin = backend.origin;
  storefront = await listen(
    await createStorefront({
      siteOrigin: publicOrigin,
      apiOrigin,
      distDir: join(directory, 'preview'),
    })
  );
  liveStorefront = await listen(
    await createStorefront({
      siteOrigin: publicOrigin,
      apiOrigin,
      distDir: join(directory, 'live'),
    })
  );
  origin = storefront.origin;
  liveOrigin = liveStorefront.origin;
});
after(async () => {
  for (const app of [storefront, liveStorefront, backend])
    if (app) await new Promise((resolve) => app.server.close(resolve));
  // The only recursive removal is the exact fresh system-temp directory created above.
  if (directory && directory.startsWith(join(tmpdir(), 'mcl-storefront-test-')))
    await rm(directory, { recursive: true, force: true });
});

test('sample HTML and metadata render without reading the business API', async () => {
  const beforeReads = catalogReads;
  const response = await get(sampleSlug);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<h1>Relaxed Black Overshirt<\/h1>/);
  assert.match(html, /sample|Sample/);
  assert.match(
    html,
    /https:\/\/shop.example\/product\/relaxed-black-overshirt/
  );
  assert.doesNotMatch(html, /Actual API product|"@type":"Product"/);
  assert.equal(catalogReads, beforeReads);
});
test('root sitemap and robots use the storefront origin and actual fabric routes', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.match(
    robots,
    /Allow: \/\nSitemap: https:\/\/shop.example\/sitemap.xml/
  );
  const sitemap = await (await get('/sitemap.xml')).text();
  assert.match(sitemap, /\/fabrics\/natural-linen/);
  assert.doesNotMatch(sitemap, /\/product\/natural-linen|\/account|\/checkout/);
});
test('client metadata is local, strips private query data and reports unknown routes', async () => {
  const response = await get('/api/seo/meta?path=%2Fshop');
  const { data } = await response.json();
  assert.equal(data.canonical, publicOrigin + '/shop');
  assert.equal(data.title, 'Shop | McLily');
  assert.equal(data.body, undefined);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await get('/api/seo/meta?path=%2Fcheckout%3Ftoken%3Dsecret')).status,
    400
  );
  assert.equal(
    (await get('/api/seo/meta?path=%2Fshop&path=%2Faccount')).status,
    400
  );
  assert.equal((await get('/api/seo/meta?path=%2Funknown')).status, 404);
});
test('private routes and generic offline shell contain no catalog data', async () => {
  for (const path of [
    '/account',
    '/checkout',
    '/reset-password',
    '/index.html',
  ]) {
    const response = await get(path);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    const html = await response.text();
    assert.doesNotMatch(
      html,
      /Relaxed Black Overshirt|Actual API product|priceCurrency/
    );
    assert.match(html, /content="fixture"/);
  }
});
test('missing products/pages/assets return real 404s and canonical fabric redirects are retained', async () => {
  for (const path of [
    '/unknown',
    '/product/missing',
    '/assets/missing.js',
    '/images/missing.webp',
    '/icons/missing.png',
  ])
    assert.equal((await get(path)).status, 404);
  const response = await get('/product/natural-linen', { redirect: 'manual' });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), '/fabrics/natural-linen');
});
test('worker/manifest revalidate while hashed assets stay immutable and HEAD is bodyless', async () => {
  for (const path of ['/sw.js', '/manifest.webmanifest'])
    assert.equal((await get(path)).headers.get('cache-control'), 'no-cache');
  assert.match(
    (await get('/assets/app-hash.js')).headers.get('cache-control'),
    /immutable/
  );
  const response = await get(sampleSlug, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});
test('API proxy retains multiple HttpOnly cookies and does not cache them', async () => {
  const response = await get('/api/auth/login', {
    method: 'POST',
    headers: { Origin: publicOrigin },
  });
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(
    response.headers.getSetCookie()[0],
    /HttpOnly; Secure; SameSite=Lax/
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('proxy preserves JSON, private-order access and retry headers while removing spoofed forwarding headers', async () => {
  const body = '{"quantity":0,"halfYards":3}';
  const response = await get('/api/echo?source=customer', {
    method: 'POST',
    headers: {
      Origin: publicOrigin,
      Cookie: 'mcl_jwt=fixture',
      'Content-Type': 'application/json',
      'X-Order-Access': 'fixture-private-access',
      'Idempotency-Key': 'fixture-retry',
      'X-Forwarded-For': '1.2.3.4',
      'X-Forwarded-Host': 'evil.example',
    },
    body,
  });
  const echoed = await response.json();
  assert.equal(echoed.body, body);
  assert.equal(echoed.headers.cookie, 'mcl_jwt=fixture');
  assert.equal(echoed.headers['x-order-access'], 'fixture-private-access');
  assert.equal(echoed.headers['idempotency-key'], 'fixture-retry');
  assert.equal(echoed.headers.origin, publicOrigin);
  assert.equal(echoed.headers['x-forwarded-for'], undefined);
  assert.equal(echoed.headers['x-forwarded-host'], undefined);
});
test('multipart uploads retain their original bytes and boundary', async () => {
  const body =
    '--fixture\r\nContent-Disposition: form-data; name="image"; filename="photo.webp"\r\nContent-Type: image/webp\r\n\r\nfixture-image\r\n--fixture--\r\n';
  const response = await get('/api/media/fixture', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=fixture' },
    body,
  });
  const echoed = await response.json();
  assert.equal(echoed.body, body);
  assert.equal(
    echoed.headers['content-type'],
    'multipart/form-data; boundary=fixture'
  );
});
test('API proxy rejects a foreign browser origin and preserves authoritative API errors', async () => {
  assert.equal(
    (
      await get('/api/auth/login', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403
  );
  const response = await get('/api/orders', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PREVIEW_CHECKOUT_DISABLED');
});
test('encoded traversal never serves application source', async () => {
  const response = await get('/%2e%2e%2fpackage.json');
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /dependencies/);
});
test('live HTML uses public API data and real variant/fabric availability', async () => {
  const retailHtml = await (
    await fetch(liveOrigin + '/product/' + retail.slug)
  ).text();
  assert.match(retailHtml, /Actual API product/);
  assert.match(retailHtml, /"price":"4200.00"/);
  assert.match(retailHtml, /https:\/\/schema.org\/InStock/);
  const fabricHtml = await (
    await fetch(liveOrigin + '/fabrics/' + fabric.slug)
  ).text();
  assert.match(fabricHtml, /per yard/);
  assert.match(fabricHtml, /https:\/\/schema.org\/OutOfStock/);
  assert.match(fabricHtml, /"unitCode":"YRD"/);
});
test('live sitemap gathers multiple API pages and missing products remain 404', async () => {
  const sitemap = await (await fetch(liveOrigin + '/sitemap.xml')).text();
  assert.match(sitemap, /\/product\/actual-api-product/);
  assert.match(sitemap, /\/fabrics\/actual-fabric/);
  assert.equal((await fetch(liveOrigin + '/product/hidden')).status, 404);
});
test('live API outage returns retryable 503 rather than fake stock or missing-product data', async () => {
  unavailable = true;
  try {
    const response = await fetch(liveOrigin + '/product/' + retail.slug);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /InStock|Product not found/);
  } finally {
    unavailable = false;
  }
});
test('mixed catalog builds, direct API builds and proxy loops refuse startup', async () => {
  await assert.rejects(
    createStorefront({
      siteOrigin: publicOrigin,
      apiOrigin,
      distDir: join(directory, 'preview'),
      catalogMode: 'live',
    }),
    /Rebuild/
  );
  await assert.rejects(
    createStorefront({
      siteOrigin: publicOrigin,
      apiOrigin: publicOrigin,
      distDir: join(directory, 'preview'),
    }),
    /separate backend/
  );
  await writeFile(
    join(directory, 'preview/deployment.json'),
    JSON.stringify({
      catalogMode: 'preview',
      apiBase: 'https://api.example/api',
    })
  );
  await assert.rejects(
    createStorefront({
      siteOrigin: publicOrigin,
      apiOrigin,
      distDir: join(directory, 'preview'),
    }),
    /VITE_API_URL=\/api/
  );
});
