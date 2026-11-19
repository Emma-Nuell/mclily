import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';

function applyMetadata(data) {
  document.title = data.title;
  const meta = (key, value, property = false) => {
    const attribute = property ? 'property' : 'name';
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!value) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = value;
  };
  meta('description', data.description);
  meta('robots', data.robots);
  for (const [key, value] of Object.entries({
    'og:site_name': 'McLily',
    'og:title': data.title,
    'og:description': data.description,
    'og:type': data.type,
    'og:url': data.canonical,
    'og:image': data.image,
  }))
    meta(key, value, true);
  for (const [key, value] of Object.entries({
    'twitter:card': data.image ? 'summary_large_image' : 'summary',
    'twitter:title': data.title,
    'twitter:description': data.description,
    'twitter:image': data.image,
  }))
    meta(key, value);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = data.canonical;
  document.getElementById('mclily-jsonld')?.remove();
  if (data.structuredData) {
    const element = document.createElement('script');
    element.id = 'mclily-jsonld';
    element.type = 'application/ld+json';
    element.textContent = JSON.stringify(data.structuredData);
    document.head.append(element);
  }
}

export default function PageMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const controller = new AbortController();
    const privatePage =
      /^\/(account|wishlist|checkout|login|signup|forgot-password|reset-password)(\/|$)/.test(
        pathname
      );
    const fallback = {
      title: 'McLily — Style. Quality. Convenience.',
      description:
        'Explore McLily fashion, everyday essentials, fabrics and bespoke tailoring.',
      robots: privatePage ? 'noindex,nofollow' : 'index,follow',
      canonical: location.origin + pathname,
      type: 'website',
    };
    if (privatePage) {
      applyMetadata(fallback);
      return;
    }
    api
      .get('/seo/meta', {
        params: { path: pathname },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!controller.signal.aborted && data.success)
          applyMetadata(data.data);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          applyMetadata(error.response?.data?.data || fallback);
      });
    return () => controller.abort();
  }, [pathname]);
  return null;
}
