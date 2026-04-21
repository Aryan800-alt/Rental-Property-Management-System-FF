// sw.js — FlatFinder Service Worker (Production Grade)
// Strategy:
//   • Static assets — Cache-first (fallback to network)
//   • API GET requests — Network-first (fallback to cache)
//   • API POST/PATCH/DELETE — Never cached (always network)
// Bump CACHE_VERSION whenever you deploy new static files.

const CACHE_VERSION  = 'v3';
const CACHE_NAME     = `flatfinder-${CACHE_VERSION}`;
const STATIC_ASSETS  = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/ff-core.js',
  '/ff-auth.js',
  '/ff-tenant.js',
  '/ff-owner.js',
  '/ff-admin.js',
];

// ── INSTALL — pre-cache static shell ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// ── ACTIVATE — purge old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // Take control of open pages immediately
  );
});

// ── FETCH — routing strategy ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // NEVER intercept non-GET API mutations — they must always hit the server
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (Cloudinary, Google Fonts CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // API GET: Network-first, then cache fallback (fresh data preferred)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request)) // Offline fallback
    );
    return;
  }

  // Static assets: Cache-first, then network fallback
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// ── MESSAGE — force update from app ───────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
