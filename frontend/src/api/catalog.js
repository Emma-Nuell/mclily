import api from './client';
import preview from '../data/preview-catalog.json';
import {
  publicCatalogKey,
  savePublicCatalog,
  loadPublicCatalog,
} from '../pwa/catalogStorage';
import { markSavedCatalog, markFreshCatalog } from '../pwa/client';

// Temporary, explicit sample catalog. Switch to `live` when the API is ready.
export const CATALOG_MODE = import.meta.env.VITE_CATALOG_MODE || 'preview';
export const IS_PREVIEW_CATALOG = CATALOG_MODE === 'preview';

export function queryPreviewCatalog(path) {
  const url = new URL(path, 'https://preview.mclily.local');
  const slug = url.pathname.match(/^\/products\/([^/]+)$/)?.[1];
  if (slug) {
    const product = preview.products.find(
      (item) => item.slug === decodeURIComponent(slug) || item._id === slug
    );
    if (!product)
      throw new Error('Product not found in the preview collection.');
    return { success: true, data: product };
  }
  const params = url.searchParams;
  let products = preview.products.filter((item) => item.isActive);
  for (const key of ['productType', 'material', 'brand']) {
    if (params.get(key))
      products = products.filter(
        (item) => item[key]?.toLowerCase() === params.get(key).toLowerCase()
      );
  }
  const category = params.get('category')?.toLowerCase();
  if (category)
    products = products.filter(
      (item) =>
        item.category.toLowerCase() === category ||
        item.tags?.some((tag) => tag.toLowerCase() === category)
    );
  const search = params.get('search')?.trim().toLowerCase();
  if (search)
    products = products.filter((item) =>
      `${item.name} ${item.category} ${item.material || ''} ${item.tags?.join(' ')} ${item.description}`
        .toLowerCase()
        .includes(search)
    );
  if (params.has('minPrice'))
    products = products.filter(
      (item) => item.price >= Number(params.get('minPrice'))
    );
  if (params.has('maxPrice'))
    products = products.filter(
      (item) => item.price <= Number(params.get('maxPrice'))
    );
  if (params.get('inStock') === 'true')
    products = products.filter((item) =>
      item.productType === 'fabric'
        ? item.colorVariants?.some(
            (variant) =>
              variant.rollStockHalfYards - (variant.reservedHalfYards || 0) >= 2
          )
        : item.sizes?.some(
            (variant) => variant.stock - (variant.reservedStock || 0) > 0
          )
    );
  if (params.get('onSale') === 'true')
    products = products.filter((item) => item.originalPrice > item.price);
  const sorts = {
    price_low: (a, b) => a.price - b.price,
    price_high: (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating,
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  };
  products.sort(sorts[params.get('sort')] || sorts.newest);
  const total = products.length;
  const limit = Math.max(1, Math.min(100, Number(params.get('limit')) || 24));
  const page = Math.max(1, Number(params.get('page')) || 1);
  return {
    success: true,
    data: products.slice((page - 1) * limit, page * limit),
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  };
}

const catalog = {
  async get(path) {
    if (!IS_PREVIEW_CATALOG) {
      const key = publicCatalogKey(path, api.defaults.baseURL);
      try {
        const response = await api.get(path);
        await savePublicCatalog(key, response.data);
        markFreshCatalog(key);
        return response;
      } catch (error) {
        if (!error.response) {
          const saved = await loadPublicCatalog(key);
          if (saved) {
            markSavedCatalog(key, saved.savedAt);
            return { data: saved.data, savedAt: saved.savedAt };
          }
        }
        throw error;
      }
    }
    return { data: queryPreviewCatalog(path) };
  },
};
export default catalog;
