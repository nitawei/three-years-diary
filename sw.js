/**
 * sw.js - Cache Buster Service Worker
 * Completely clears cache and bypasses caching to ensure the latest static files are loaded.
 */

self.addEventListener('install', event => {
  self.skipWaiting();
  console.log("[Service Worker] Installed and skipping waiting.");
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          console.log("[Service Worker] Deleting cache bucket:", key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      console.log("[Service Worker] All caches cleared, worker active.");
    })
  );
});

self.addEventListener('fetch', event => {
  // Let browser make standard network requests without any caching interception
  return;
});
