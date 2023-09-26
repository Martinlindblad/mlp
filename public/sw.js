// sw.js
const CACHE_NAME = 'v1_cache';
const urlsToCache = [
  '/',
  '/_next/static/css/styles.chunk.css',
  '/images/background.webp',
  '/images/background2.webp',
  '/images/beach.webp',
  '/images/cm.webp',
  '/images/facebook.webp',
  '/images/github.webp',
  '/images/instagram.webp',
  '/images/linkedin.webp',
  '/images/movie.webp',
  '/images/porche.webp',
  '/images/profilepicture.webp',
  '/images/singapore.webp',
  '/images/socail-media.webp',
  '/images/wallpaper.webp',
  '/images/Cases/artv.webp',
  '/images/Cases/imaginecare.webp',
  '/images/Cases/libra.webp',
  '/images/Cases/mackmyra.webp',
  '/images/Cases/pactplanet.webp',
  '/images/Cases/livsstilsverktyget.webp',
  // ... any other URLs you want to cache up front
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response; // if valid response is found in cache return it
      }
      return fetch(event.request).then((res) => {
        // You may want to add dynamic caching for new content found
        let responseToCache = res.clone();
        void caches.open(CACHE_NAME).then((cache) => {
          void cache.put(event.request, responseToCache);
        });
        return res;
      });
    }),
  );
});
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
});
