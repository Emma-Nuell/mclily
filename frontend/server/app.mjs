import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicPages, renderDocument } from '../vendor/publicPages.mjs';
import { publicOrigin } from '../vendor/publicUrls.mjs';
import { createApiProxy } from './apiProxy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const privatePath = (path) =>
  /^\/(admin|account|wishlist|checkout|login|signup|forgot-password|reset-password)(\/|$)/.test(
    path
  );
function reply(req, res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function seoPath(value) {
  return (
    typeof value === 'string' &&
    value.length <= 600 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[?#\\]/.test(value)
  );
}

export async function createStorefront({
  siteOrigin,
  apiOrigin,
  catalogMode,
  distDir = resolve(root, 'dist'),
  loadCatalog: customCatalog,
  fetchCatalog = fetch,
} = {}) {
  const origin = publicOrigin(siteOrigin);
  const backend = publicOrigin(apiOrigin);
  const deployment = JSON.parse(
    await readFile(resolve(distDir, 'deployment.json'), 'utf8')
  );
  const mode = catalogMode || deployment.catalogMode;
  if (deployment.apiBase !== '/api')
    throw new Error(
      'Standalone storefront builds use VITE_API_URL=/api. Rebuild before starting.'
    );
  if (!['preview', 'live'].includes(mode) || mode !== deployment.catalogMode)
    throw new Error(
      'Storefront catalog mode differs from its build. Rebuild before starting.'
    );
  const template = await readFile(resolve(distDir, 'index.html'), 'utf8');
  const preview = JSON.parse(
    await readFile(
      new URL('../src/data/preview-catalog.json', import.meta.url),
      'utf8'
    )
  ).products;
  async function publicRequest(path) {
    const response = await fetchCatalog(backend + '/api' + path, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Public catalog is unavailable.');
    const body = await response.json();
    if (!body.success) throw new Error('Public catalog is unavailable.');
    return body;
  }
  async function loadCatalog({ slug, type, limit = 24 } = {}) {
    if (mode === 'preview')
      return preview
        .filter(
          (product) =>
            product.isActive &&
            (!slug || product.slug === slug) &&
            (!type || product.productType === type)
        )
        .slice(0, limit);
    if (slug) {
      const response = await publicRequest(
        '/products/' + encodeURIComponent(slug)
      );
      return response?.data?.isActive ? [response.data] : [];
    }
    const products = [];
    for (let page = 1; products.length < Math.min(limit, 50000); page++) {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(Math.min(100, limit - products.length)),
        sort: 'newest',
      });
      if (type) query.set('productType', type);
      const response = await publicRequest('/products?' + query);
      if (!response || !Array.isArray(response.data))
        throw new Error('Public catalog is unavailable.');
      products.push(...response.data);
      if (!response.data.length || page >= (response.pages || 1)) break;
    }
    return products.slice(0, limit);
  }
  const pages = createPublicPages({
    getOrigin: () => origin,
    getCatalogMode: () => mode,
    loadCatalog: customCatalog || loadCatalog,
  });
  const proxy = createApiProxy({ apiOrigin: backend, siteOrigin: origin });
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' https: 'unsafe-inline'; font-src 'self' https: data:; img-src 'self' data: https://res.cloudinary.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin)
        return reply(req, res, 400, 'Invalid request URL.', 'text/plain');
      const path = url.pathname;
      if (path === '/healthz')
        return reply(
          req,
          res,
          200,
          JSON.stringify({ status: 'ok', service: 'storefront' }),
          'application/json'
        );
      // Metadata follows this storefront's own build/mode/origin, even while the API sleeps.
      if (path === '/api/seo/meta' && ['GET', 'HEAD'].includes(req.method)) {
        const requested = url.searchParams.get('path');
        if (!seoPath(requested) || url.searchParams.getAll('path').length !== 1)
          return reply(
            req,
            res,
            400,
            JSON.stringify({
              success: false,
              message: 'Choose a public page path.',
            }),
            'application/json'
          );
        const { body, redirect, ...metadata } =
          await pages.publicDocument(requested);
        void body;
        void redirect;
        res.setHeader('X-Robots-Tag', 'noindex');
        return reply(
          req,
          res,
          metadata.status,
          JSON.stringify({ success: true, data: metadata }),
          'application/json'
        );
      }
      if (path.startsWith('/api/')) return proxy(req, res);
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(req, res, 405, 'Method not allowed.', 'text/plain');
      }
      if (path === '/robots.txt') {
        res.setHeader('Cache-Control', 'no-cache');
        return reply(
          req,
          res,
          200,
          `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
          'text/plain'
        );
      }
      if (path === '/sitemap.xml') {
        res.setHeader('Cache-Control', 'no-cache');
        return reply(
          req,
          res,
          200,
          await pages.sitemapXml(),
          'application/xml'
        );
      }
      if (path === '/index.html') {
        const document = await pages.publicDocument('/account');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Robots-Tag', 'noindex');
        return reply(
          req,
          res,
          200,
          renderDocument(template, {
            ...document,
            title: 'McLily — Style. Quality. Convenience.',
            canonical: origin + '/',
            body: '',
          })
        );
      }
      let decoded;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return reply(req, res, 400, 'Invalid path.', 'text/plain');
      }
      const file = resolve(distDir, '.' + decoded);
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        !file.startsWith(resolve(distDir) + sep)
      ) {
        if (path !== '/')
          return reply(req, res, 404, 'Not found.', 'text/plain');
      } else {
        const info = await stat(file).catch((error) => {
          if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
          throw error;
        });
        if (info?.isFile() && !decoded.startsWith('/.')) {
          res.setHeader(
            'Cache-Control',
            /^\/assets\/[^/]+-[\w-]+\.(js|css|svg|woff2?)$/.test(path)
              ? 'public, max-age=31536000, immutable'
              : 'no-cache'
          );
          res.writeHead(200, {
            'Content-Type': mime[extname(file)] || 'application/octet-stream',
            'Content-Length': info.size,
          });
          if (req.method === 'HEAD') return res.end();
          createReadStream(file)
            .on('error', () => res.destroy())
            .pipe(res);
          return;
        }
      }
      if (
        /^\/(assets|images|icons)(\/|$)/.test(path) ||
        ['/sw.js', '/manifest.webmanifest', '/favicon.ico'].includes(path)
      )
        return reply(req, res, 404, 'Not found.', 'text/plain');
      const document = await pages.publicDocument(path);
      if (document.redirect) {
        res.writeHead(301, { Location: document.redirect });
        return res.end();
      }
      if (privatePath(path) || document.robots.startsWith('noindex'))
        res.setHeader('X-Robots-Tag', document.robots);
      return reply(
        req,
        res,
        document.status,
        renderDocument(template, document)
      );
    } catch {
      if (res.headersSent) return res.destroy();
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Retry-After', '30');
      if (req.url.startsWith('/api/'))
        return reply(
          req,
          res,
          503,
          JSON.stringify({
            success: false,
            code: 'CATALOG_UNAVAILABLE',
            message: 'The collection is unavailable. Please try again shortly.',
          }),
          'application/json'
        );
      return reply(
        req,
        res,
        503,
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>McLily — temporarily unavailable</title></head><body><h1>The collection is temporarily unavailable.</h1><p>Please try again shortly.</p></body></html>'
      );
    }
  };
}
