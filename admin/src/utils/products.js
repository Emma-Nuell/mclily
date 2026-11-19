import { resolveLocalStorefront } from '../../vendor/localApi.mjs';

export function available(variant, fabric = false) {
  return fabric
    ? (variant.availableHalfYards ??
        Math.max(
          0,
          variant.rollStockHalfYards - (variant.reservedHalfYards || 0)
        )) / 2
    : (variant.availableStock ??
        Math.max(0, variant.stock - (variant.reservedStock || 0)));
}
export function variantsOf(product) {
  return product.productType === 'fabric'
    ? product.colorVariants || []
    : product.sizes || [];
}
export function variantLabel(variant, fabric = false) {
  return fabric
    ? variant.colorName
    : [variant.size, variant.color].filter(Boolean).join(' · ') || 'Standard';
}
export function productPrice(product) {
  return product.productType === 'fabric'
    ? product.pricePerYard
    : product.price;
}
export function stockLabel(product) {
  const fabric = product.productType === 'fabric';
  const total = variantsOf(product).reduce(
    (sum, v) => sum + available(v, fabric),
    0
  );
  return `${total} ${fabric ? 'yd available' : 'available'}`;
}
export const storefrontUrl = resolveLocalStorefront(
  import.meta.env.VITE_STOREFRONT_URL || 'http://localhost:5173',
  window.location
).replace(/\/$/, '');
