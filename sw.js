/**
 * PixelTap Service Worker — offline support for PWA.
 * Caches app shell; network-first for everything else.
 */
const CACHE_NAME = 'pixeltap-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/PixelCanvas.js',
  '/js/history.js',
  '/js/tools.js',
  '/js/icons.js',
  '/js/templates.js',
  '/js/gif-encoder.js',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

// Install — cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for app shell, network-first for API/external
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and external requests
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful responses for same-origin
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (e.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
