export function isPrivateIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
export function resolveLocalStorefront(configured, page) {
  try {
    const store = new URL(configured);
    if (
      page.protocol === 'http:' &&
      isPrivateIpv4(page.hostname) &&
      page.port === '5174' &&
      store.protocol === 'http:' &&
      store.port === '5173' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(store.hostname)
    ) {
      store.hostname = page.hostname;
      return store.toString().replace(/\/$/, '');
    }
  } catch {
    /* Preserve the configured destination. */
  }
  return configured;
}
export function resolveLocalApi(configured, page) {
  try {
    const api = new URL(configured, page.origin);
    if (
      page.protocol === 'http:' &&
      isPrivateIpv4(page.hostname) &&
      ['5173', '5174', '4173'].includes(page.port) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    )
      return '/api';
  } catch {
    /* Relative production API paths are already same-origin. */
  }
  return configured;
}
