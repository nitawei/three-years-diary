/**
 * sw.js - Service Worker (Phase 2A Lifecycle & Update Manager)
 * Manages Service Worker update lifecycle without caching static assets.
 */

self.addEventListener('install', event => {
  console.log("[Service Worker] Installed, waiting for user confirmation to skipWaiting.");
  // DO NOT call self.skipWaiting() automatically. Wait for postMessage signal.
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          console.log("[Service Worker] Deleting legacy cache bucket:", key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      console.log("[Service Worker] Service Worker activated.");
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log("[Service Worker] Received SKIP_WAITING signal from user action.");
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  // Pass-through: Let browser make standard network requests without caching interception
  return;
});
