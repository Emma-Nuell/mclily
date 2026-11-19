import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import {
  publicDocument,
  renderDocument,
  sitemapXml,
  siteOrigin,
} from './publicPageService.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';

export function assetHeaders(res, file) {
  const hashed = /[\\/]assets[\\/][^\\/]+-[\w-]+\.(js|css|svg|woff2?)$/.test(
    file
  );
  res.set(
    'Cache-Control',
    hashed ? 'public, max-age=31536000, immutable' : 'no-cache'
  );
}

export function mountWebApps(
  app,
  {
    storefrontDir = fileURLToPath(
      new URL('../../frontend/dist/', import.meta.url)
    ),
    adminDir = fileURLToPath(new URL('../../admin/dist/', import.meta.url)),
    verifyBuild = true,
  } = {}
) {
  const storefrontHtml = readFileSync(storefrontDir + '/index.html', 'utf8');
  const adminHtml = readFileSync(adminDir + '/index.html', 'utf8');
  if (verifyBuild) {
    const build = JSON.parse(
      readFileSync(storefrontDir + '/deployment.json', 'utf8')
    );
    if (
      build.catalogMode !== env.STOREFRONT_CATALOG_MODE ||
      build.adminBase !== '/admin/'
    )
      throw new Error(
        'Hosted catalog mode differs from the web build. Rebuild both apps before starting.'
      );
  }
  app.get('/robots.txt', (req, res) =>
    res
      .set('Cache-Control', 'no-cache')
      .type('text')
      .send(`User-agent: *\nAllow: /\nSitemap: ${siteOrigin()}/sitemap.xml\n`)
  );
  app.get(
    '/sitemap.xml',
    asyncHandler(async (req, res) =>
      res
        .set('Cache-Control', 'no-cache')
        .type('xml')
        .send(await sitemapXml())
    )
  );
  // The offline app shell contains no stock, prices, account data or request-specific metadata.
  app.get(
    '/index.html',
    asyncHandler(async (req, res) => {
      const document = await publicDocument('/account');
      res
        .set('Cache-Control', 'no-cache')
        .type('html')
        .send(
          renderDocument(storefrontHtml, {
            ...document,
            title: 'McLily — Style. Quality. Convenience.',
            canonical: siteOrigin() + '/',
            body: '',
          })
        );
    })
  );
  app.use(
    '/admin',
    (req, res, next) => {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
    },
    express.static(adminDir, { index: false, setHeaders: assetHeaders })
  );
  app.get(
    ['/admin', '/admin/{*path}'],
    asyncHandler(async (req, res) => {
      if (/\.(js|css|svg|png|woff2?)$/.test(req.path))
        return res.status(404).end();
      const document = await publicDocument('/admin');
      res
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(renderDocument(adminHtml, document));
    })
  );
  app.use(
    express.static(storefrontDir, { index: false, setHeaders: assetHeaders })
  );
  app.get(
    '/{*path}',
    asyncHandler(async (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (
        /^\/(assets|images|icons)(\/|$)/.test(req.path) ||
        ['/sw.js', '/manifest.webmanifest', '/favicon.ico'].includes(req.path)
      )
        return res.status(404).end();
      const document = await publicDocument(req.path);
      if (document.redirect) return res.redirect(301, document.redirect);
      res.set('Cache-Control', 'no-store');
      if (document.robots.startsWith('noindex'))
        res.set('X-Robots-Tag', document.robots);
      res
        .status(document.status)
        .type('html')
        .send(renderDocument(storefrontHtml, document));
    })
  );
}
