import { publicOrigin } from './publicUrls.mjs';

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );
export const safeJson = (value) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')
  );
export const productPath = (product) =>
  `/${product.productType === 'fabric' ? 'fabrics' : 'product'}/${encodeURIComponent(product.slug)}`;
const pages = {
  '/': [
    'McLily — Style. Quality. Convenience.',
    'Everything You Need, All in One Place.',
    'Shop fashion, shoes, electronics, home essentials, fabrics by the yard and more. Explore McLily and its WhatsApp tailoring service.',
  ],
  '/shop': [
    'Shop | McLily',
    'The Shop',
    'Discover clothing, shoes, bags, electronics, beauty and home essentials at McLily.',
  ],
  '/categories': [
    'Shop by category | McLily',
    'Find your next favourite.',
    'Explore McLily shopping categories, fabrics and custom tailoring.',
  ],
  '/fabrics': [
    'Fabrics by the yard | McLily',
    'Fabrics by the yard',
    'Explore fabric colours, patterns and materials, priced per yard.',
  ],
  '/tailoring': [
    'Custom tailoring | McLily',
    'Tailored to Your Style.',
    'Explore our style inspiration and enquire about bespoke tailoring on WhatsApp.',
  ],
};
export const publicPaths = Object.keys(pages);
const privatePath = (path) =>
  /^\/(admin|account|wishlist|checkout|login|signup|forgot-password|reset-password)(\/|$)/.test(
    path
  );
function imageUrl(value, origin) {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function productOffer(product, origin) {
  const fabric = product.productType === 'fabric';
  const variants = fabric ? product.colorVariants || [] : product.sizes || [];
  const inStock = variants.filter((variant) =>
    fabric
      ? variant.rollStockHalfYards - (variant.reservedHalfYards || 0) >= 2
      : variant.stock - (variant.reservedStock || 0) > 0
  );
  const available = inStock.length > 0;
  const pricedVariants = available ? inStock : variants;
  const prices = fabric
    ? [product.pricePerYard]
    : pricedVariants.length
      ? pricedVariants.map((variant) => variant.priceOverride ?? product.price)
      : [product.price];
  const valid = prices.filter(
    (price) => typeof price === 'number' && Number.isFinite(price) && price >= 0
  );
  if (!valid.length) return null;
  const low = Math.min(...valid),
    high = Math.max(...valid);
  return {
    '@type': low === high ? 'Offer' : 'AggregateOffer',
    url: origin + productPath(product),
    priceCurrency: 'NGN',
    ...(low === high
      ? { price: low.toFixed(2) }
      : {
          lowPrice: low.toFixed(2),
          highPrice: high.toFixed(2),
          offerCount: pricedVariants.length,
        }),
    availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`,
    ...(fabric
      ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: low.toFixed(2),
            priceCurrency: 'NGN',
            referenceQuantity: {
              '@type': 'QuantitativeValue',
              value: 1,
              unitCode: 'YRD',
              unitText: 'yard',
            },
          },
        }
      : {}),
  };
}
const money = (amount) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    Number(amount)
  );
function listing(products, origin, preview) {
  return (
    '<ul>' +
    products
      .map(
        (product) =>
          `<li><a href="${escapeHtml(productPath(product))}">${escapeHtml(product.name)}</a>${imageUrl(product.images?.[0], origin) ? `<img src="${escapeHtml(imageUrl(product.images[0], origin))}" alt="${escapeHtml(product.name)}" width="180" loading="lazy">` : ''}<p>${preview ? 'Sample price: ' : 'From: '}${escapeHtml(money(product.productType === 'fabric' ? product.pricePerYard : product.price))}${product.productType === 'fabric' ? ' per yard' : ''}</p></li>`
      )
      .join('') +
    '</ul>'
  );
}
export function documentHead(document) {
  const meta = (key, value, property = false) =>
    value
      ? `<meta ${property ? 'property' : 'name'}="${key}" content="${escapeHtml(value)}">`
      : '';
  return `<title>${escapeHtml(document.title)}</title>${meta('description', document.description)}${meta('robots', document.robots)}<link rel="canonical" href="${escapeHtml(document.canonical)}">${meta('og:site_name', 'McLily', true)}${meta('og:title', document.title, true)}${meta('og:description', document.description, true)}${meta('og:type', document.type, true)}${meta('og:url', document.canonical, true)}${meta('og:image', document.image, true)}${meta('twitter:card', document.image ? 'summary_large_image' : 'summary')}${meta('twitter:title', document.title)}${meta('twitter:description', document.description)}${meta('twitter:image', document.image)}${document.structuredData ? `<script id="mclily-jsonld" type="application/ld+json">${safeJson(document.structuredData)}</script>` : ''}`;
}
export function renderDocument(template, document) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\b[^>]*name=["']description["'][^>]*>/i, '')
    .replace('</head>', () => documentHead(document) + '</head>')
    .replace(
      /<div id=["']root["']><\/div>/,
      () => `<div id="root"><main>${document.body}</main></div>`
    );
}

export function createPublicPages({ getOrigin, getCatalogMode, loadCatalog }) {
  const siteOrigin = () => publicOrigin(getOrigin());
  const previewMode = () => getCatalogMode() === 'preview';
  const publicCatalog = loadCatalog;
  async function publicDocument(pathname) {
    const origin = siteOrigin();
    const path = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
    const base = {
      status: 200,
      canonical: origin + path,
      image: origin + '/images/mclily-shopping-campaign-v3-1536.webp',
      robots: 'index,follow',
      type: 'website',
      structuredData: null,
      body: '',
    };
    if (privatePath(path))
      return {
        ...base,
        title: path.startsWith('/admin')
          ? 'McLily Admin'
          : 'Your account and shopping | McLily',
        description: 'Private McLily account and shopping tools.',
        robots: 'noindex,nofollow',
      };
    const match = path.match(/^\/(product|fabrics)\/([^/]+)$/);
    if (match) {
      let slug;
      try {
        slug = decodeURIComponent(match[2]);
      } catch {
        slug = '';
      }
      const [product] =
        slug && slug.length <= 240
          ? await publicCatalog({ slug, limit: 1 })
          : [];
      if (!product)
        return {
          ...base,
          status: 404,
          title: 'Product not found | McLily',
          description: 'This item is unavailable.',
          robots: 'noindex,follow',
          body: '<h1>Product not found</h1><a href="/shop">Browse the shop</a>',
        };
      const canonical = origin + productPath(product),
        sample = previewMode();
      const image = imageUrl(product.images?.[0], origin);
      const offer = productOffer(product, origin);
      const description = String(product.description || product.name)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      return {
        ...base,
        canonical,
        redirect: path !== productPath(product) ? productPath(product) : null,
        title: `${sample ? 'Sample: ' : ''}${product.name} | McLily`,
        description,
        image,
        type: 'product',
        structuredData: sample
          ? null
          : {
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: product.name,
              description,
              image: (product.images || [])
                .map((value) => imageUrl(value, origin))
                .filter(Boolean),
              brand: { '@type': 'Brand', name: product.brand || 'McLily' },
              ...(offer ? { offers: offer } : {}),
            },
        body: `<h1>${escapeHtml(product.name)}</h1>${sample ? '<p>Preview collection. Sample photos, prices and stock; this item is not available for purchase.</p>' : ''}${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" width="400">` : ''}<p>${escapeHtml(product.description)}</p><p>${sample ? 'Sample price: ' : 'From: '}${escapeHtml(money(product.productType === 'fabric' ? product.pricePerYard : offer?.price || offer?.lowPrice || product.price))}${product.productType === 'fabric' ? ' per yard' : ''}</p>${!sample && offer ? `<p>${offer.availability.endsWith('/InStock') ? 'Available to order' : 'Out of stock'}</p>` : ''}<a href="${product.productType === 'fabric' ? '/fabrics' : '/shop'}">Browse more</a>`,
      };
    }
    const page = pages[path];
    if (!page)
      return {
        ...base,
        status: 404,
        title: 'Page not found | McLily',
        description: 'This page could not be found.',
        robots: 'noindex,follow',
        body: '<h1>Page not found</h1><a href="/">Return to McLily</a>',
      };
    const products =
      path === '/tailoring'
        ? []
        : await publicCatalog({
            type:
              path === '/fabrics'
                ? 'fabric'
                : path === '/shop'
                  ? 'retail'
                  : undefined,
          });
    const sampleNotice = previewMode()
      ? '<p>Preview collection: sample products, prices and stock. Sample checkout is unavailable.</p>'
      : '';
    const nav =
      '<nav aria-label="McLily"><a href="/shop">Shop</a> · <a href="/categories">Categories</a> · <a href="/fabrics">Fabrics</a> · <a href="/tailoring">Tailoring</a></nav>';
    return {
      ...base,
      title: page[0],
      description: page[2],
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'McLily',
        url: origin + '/',
      },
      body: `<h1>${escapeHtml(page[1])}</h1><p>${escapeHtml(page[2])}</p>${nav}${path === '/tailoring' ? '<p>Browse our inspiration gallery and contact us to discuss your style. Tailoring enquiries are handled through WhatsApp.</p><a href="https://wa.me/2348037256630">Enquire on WhatsApp</a>' : sampleNotice + listing(products, origin, previewMode())}`,
    };
  }
  async function sitemapXml() {
    const origin = siteOrigin();
    const products = await publicCatalog({ limit: 50000 });
    const urls = [
      ...publicPaths.map((path) => ({ path })),
      ...products.map((product) => ({
        path: productPath(product),
        updatedAt: product.updatedAt,
      })),
    ];
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls
        .map(
          (item) =>
            `<url><loc>${escapeHtml(origin + item.path)}</loc>${item.updatedAt && Number.isFinite(new Date(item.updatedAt).getTime()) ? `<lastmod>${new Date(item.updatedAt).toISOString()}</lastmod>` : ''}</url>`
        )
        .join('') +
      '</urlset>'
    );
  }

  return { publicDocument, sitemapXml };
}
