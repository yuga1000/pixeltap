/**
 * PixelTap Service Worker — offline support for PWA.
 * Network-first strategy: always tries network, falls back to cache.
 * Bump CACHE_NAME on each deploy to force update.
 */
const CACHE_NAME = 'pixeltap-v5';

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

// Fetch — network-first, cache as fallback
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and external requests
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then(response => {
      // Update cache with fresh response
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => {
      // Network failed — try cache
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
