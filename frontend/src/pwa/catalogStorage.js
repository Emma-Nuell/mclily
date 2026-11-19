const NAME = 'mclily-public-catalog-v1',
  STORE = 'responses',
  MAX_BYTES = 6 * 1024 * 1024,
  MAX_ENTRIES = 40,
  MAX_AGE = 7 * 86400000;
let opening;
function database() {
  if (!('indexedDB' in window))
    return Promise.reject(new Error('Storage unavailable'));
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
      request.onsuccess = () => resolve(request.result);
    });
  return opening;
}
export function publicCatalogKey(path, base) {
  const absolute = new URL(base, window.location.origin).href;
  const url = new URL(
    path.replace(/^\//, ''),
    absolute.endsWith('/') ? absolute : absolute + '/'
  );
  if (
    decodeURIComponent(path.split('?')[0]).toLowerCase() === '/products/manage'
  )
    return null;
  const allowed = new Set([
    'productType',
    'category',
    'material',
    'brand',
    'featured',
    'search',
    'minPrice',
    'maxPrice',
    'sort',
    'page',
    'limit',
  ]);
  if (
    !/^\/products(?:\/[^/]+)?$/.test(path.split('?')[0]) ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key))
  )
    return null;
  url.searchParams.sort();
  return 'live:' + url.href;
}
export async function savePublicCatalog(key, data) {
  if (
    !key ||
    !data?.success ||
    !(Array.isArray(data.data) || (data.data && typeof data.data === 'object'))
  )
    return;
  const bytes = new Blob([JSON.stringify(data)]).size;
  if (bytes > MAX_BYTES / 2) return;
  try {
    const db = await database();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'),
        store = transaction.objectStore(STORE);
      store.put({ key, data, bytes, savedAt: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = all.result.sort((a, b) => b.savedAt - a.savedAt);
        let total = 0;
        for (const [index, row] of rows.entries()) {
          total += row.bytes;
          if (
            index >= MAX_ENTRIES ||
            total > MAX_BYTES ||
            Date.now() - row.savedAt > MAX_AGE
          )
            store.delete(row.key);
        }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    /* A full/private browser store must not block live catalog requests. */
  }
}
export async function loadPublicCatalog(key) {
  if (!key) return null;
  try {
    const db = await database();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () =>
        resolve(
          request.result && Date.now() - request.result.savedAt <= MAX_AGE
            ? request.result
            : null
        );
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
