const CACHE_NAME = 'mlp-shell-v2';
const PRECACHE_MANIFEST = '/sw-manifest.json';

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifestResponse = await fetch(PRECACHE_MANIFEST, {
        cache: 'no-store',
      });
      if (manifestResponse.status !== 200) {
        throw new Error('service-worker manifest unavailable');
      }
      const manifestForCache = manifestResponse.clone();
      const urls = await manifestResponse.json();
      if (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string')) {
        throw new Error('service-worker manifest invalid');
      }

      const resources = [];
      for (const url of urls) {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.status !== 200) {
          throw new Error('service-worker precache resource unavailable');
        }
        resources.push([url, response]);
      }

      const cache = await caches.open(CACHE_NAME);
      await cache.put(PRECACHE_MANIFEST, manifestForCache);
      for (const [url, response] of resources) {
        await cache.put(url, response);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    request.headers.get('Range') !== null
  ) {
    return;
  }

  const isNextData =
    url.pathname === '/_next/data' || url.pathname.startsWith('/_next/data/');
  if (request.mode === 'navigate' || isNextData) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
