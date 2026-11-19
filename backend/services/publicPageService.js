import { readFile } from 'node:fs/promises';
import Product from '../models/Product.js';
import env from '../config/env.js';
import { publicOrigin } from '../vendor/publicUrls.mjs';
import { createPublicPages } from '../vendor/publicPages.mjs';
export {
  escapeHtml,
  safeJson,
  productPath,
  productOffer,
  documentHead,
  renderDocument,
  publicPaths,
} from '../vendor/publicPages.mjs';
export const siteOrigin = () =>
  publicOrigin(env.PUBLIC_SITE_URL || env.FRONTEND_URL);
const previewMode = () => env.STOREFRONT_CATALOG_MODE === 'preview';
let sampleCatalog;
export async function publicCatalog({ slug, type, limit = 24 } = {}) {
  if (previewMode()) {
    sampleCatalog ??= JSON.parse(
      await readFile(
        new URL('../data/preview-catalog.json', import.meta.url),
        'utf8'
      )
    ).products;
    return sampleCatalog
      .filter(
        (product) =>
          product.isActive &&
          (!slug || product.slug === slug) &&
          (!type || product.productType === type)
      )
      .slice(0, limit);
  }
  return Product.find({
    isActive: true,
    ...(slug ? { slug } : {}),
    ...(type ? { productType: type } : {}),
  })
    .select(
      'name slug description images productType price pricePerYard brand category sizes colorVariants updatedAt'
    )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}

const pages = createPublicPages({
  getOrigin: siteOrigin,
  getCatalogMode: () => env.STOREFRONT_CATALOG_MODE,
  loadCatalog: publicCatalog,
});
export const publicDocument = (path) => pages.publicDocument(path);
export const sitemapXml = () => pages.sitemapXml();
