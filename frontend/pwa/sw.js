/* global __BUILD_ID__, __PRECACHE_URLS__ */
const BUILD = __BUILD_ID__;
const PRECACHE = __PRECACHE_URLS__;
const SHELL = `mclily-shell-${BUILD}`;
const IMAGES = 'mclily-public-images-v1';
const customerClient = (client) =>
  !/^\/admin(?:\/|$)/.test(new URL(client.url).pathname);
const MAX_IMAGES = 40,
  MAX_IMAGE_BYTES = 1024 * 1024,
  MAX_IMAGE_TOTAL = 20 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        for (const url of PRECACHE) {
          const response = await fetch(url, {
            cache: 'reload',
            credentials: 'omit',
          });
          if (!response.ok) throw new Error('Incomplete storefront release');
          if (
            url === '/index.html' &&
            !(await response.clone().text()).includes(`content="${BUILD}"`)
          )
            throw new Error('Mismatched storefront release');
          await cache.put(url, response);
        }
      } catch (error) {
        await caches.delete(SHELL);
        throw error;
      }
      // A replacement waits for an explicit, safe activation request. No unconditional skipWaiting.
    })()
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const shells = (await caches.keys()).filter((name) =>
        name.startsWith('mclily-shell-')
      );
      const windows = (
        await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        })
      ).filter(customerClient);
      const reports = await Promise.all(windows.map(safeClient));
      const keep = new Set([
        ...shells.slice(-2),
        SHELL,
        ...reports
          .filter((report) => report.build)
          .map((report) => `mclily-shell-${report.build}`),
      ]);
      // A never-activated waiting release need not be the one an old tab is still using.
      // Keep all reported client releases; if a client cannot answer, postpone pruning.
      if (reports.every((report) => report.build))
        for (const name of shells)
          if (!keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  );
});

const shoppingRoute = (pathname) =>
  pathname === '/' ||
  [
    '/shop',
    '/categories',
    '/fabrics',
    '/product',
    '/tailoring',
    '/wishlist',
    '/checkout',
    '/account',
    '/forgot-password',
    '/reset-password',
    '/login',
    '/signup',
  ].some((path) => pathname === path || pathname.startsWith(path + '/'));
const imageAllowed = (url) =>
  (url.origin === self.location.origin &&
    url.pathname.startsWith('/images/')) ||
  (url.hostname === 'res.cloudinary.com' &&
    !url.search &&
    /^\/[^/]+\/image\/upload\//.test(url.pathname) &&
    !url.pathname.includes('/s--'));
async function saveImage(request, response) {
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('image/')
  )
    return;
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return;
  const reader = response.clone().body.getReader(),
    chunks = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAX_IMAGE_BYTES) {
      void reader.cancel().catch(() => {});
      return;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers({
    'Content-Type': response.headers.get('content-type'),
    'X-McLily-Bytes': String(bytes.byteLength),
    'X-McLily-Saved': String(Date.now()),
  });
  const cache = await caches.open(IMAGES);
  await cache.delete(request.url);
  await cache.put(request.url, new Response(bytes, { headers }));
  const keys = await cache.keys();
  let total = 0;
  for (const key of [...keys].reverse()) {
    const saved = await cache.match(key);
    total += Number(saved.headers.get('X-McLily-Bytes') || 0);
    if (total > MAX_IMAGE_TOTAL || keys.indexOf(key) < keys.length - MAX_IMAGES)
      await cache.delete(key);
  }
}
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  // Never intercept writes, auth, delivery, orders, payment callbacks or other APIs.
  if (
    request.method !== 'GET' ||
    /^\/admin(?:\/|$)/.test(url.pathname) ||
    url.pathname.startsWith('/api/') ||
    request.headers.has('authorization')
  )
    return;
  if (
    request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    shoppingRoute(url.pathname)
  ) {
    // One generic app shell, never a cached private URL, order response or reset token.
    event.respondWith(
      caches
        .open(SHELL)
        .then((cache) => cache.match('/index.html'))
        .then((response) => response || fetch(request))
    );
  } else if (
    url.origin === self.location.origin &&
    PRECACHE.includes(url.pathname) &&
    !url.search
  ) {
    event.respondWith(
      caches
        .open(SHELL)
        .then((cache) => cache.match(url.pathname))
        .then((response) => response || fetch(request))
    );
  } else if (request.destination === 'image' && imageAllowed(url)) {
    event.respondWith(
      (async () => {
        const client = event.clientId
          ? await self.clients.get(event.clientId)
          : null;
        if (!client || !shoppingRoute(new URL(client.url).pathname))
          return fetch(request);
        const cache = await caches.open(IMAGES),
          saved = await cache.match(url.href);
        try {
          const response = await fetch(url.href, {
            mode: 'cors',
            credentials: 'omit',
            signal: AbortSignal.timeout(6000),
          });
          await saveImage(request, response).catch(() => {});
          return response;
        } catch {
          if (
            saved &&
            Date.now() - Number(saved.headers.get('X-McLily-Saved')) <
              7 * 86400000
          )
            return saved;
          return (await caches.open(SHELL)).match('/offline-image.svg');
        }
      })()
    );
  }
});

async function safeClient(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve({ safe: false, build: null });
    }, 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve({
        safe: event.data?.safe === true,
        build: /^[a-f0-9]{20}$/.test(event.data?.build || '')
          ? event.data.build
          : null,
      });
    };
    client.postMessage({ type: 'MCL_CHECK_UPDATE' }, [channel.port2]);
  });
}
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'MCL_ACTIVATE_UPDATE' || !event.ports[0]) return;
  event.waitUntil(
    (async () => {
      const windows = (
        await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        })
      ).filter(customerClient);
      const safe =
        windows.length > 0 &&
        (await Promise.all(windows.map(safeClient))).every(
          (report) => report.safe
        );
      event.ports[0].postMessage({ accepted: safe });
      if (safe) await self.skipWaiting();
    })()
  );
});
