/**
 * sw.js - Service Worker for Three-Year Diary PWA
 */

const CACHE_NAME = 'three-year-diary-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/utils.js',
  '/db.js',
  '/crypto-service.js',
  '/app.js',
  '/export-service.js',
  '/apple-touch-icon.png',
  '/logo_pattern.png',
  '/logo_pattern_transparent.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching static assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || (response.type !== 'basic' && !event.request.url.includes('unpkg.com') && !event.request.url.includes('fonts.gstatic.com') && !event.request.url.includes('fonts.googleapis.com'))) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return response;
        }).catch(() => {
          if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html') || caches.match('/');
          }
        });
      })
  );
});
