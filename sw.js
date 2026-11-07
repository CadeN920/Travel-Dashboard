// Wanderlog service worker: lets the app open without a connection.
//
// - App files (this site): network first, so updates show up right away;
//   the saved copy is used when offline.
// - Pinned library files (Leaflet, Supabase): saved once, then used from the cache.
// - Map tiles you've viewed: kept (up to a limit) so those areas show offline.
// - Everything else (Supabase sync, place search, guides, exchange rates)
//   goes straight to the network. Your trip data is never stored here; it
//   lives in the browser's own storage (encrypted if you turned that on).

const SHELL_CACHE = 'wanderlog-shell-v1';
const LIB_CACHE = 'wanderlog-libs-v1';
const TILE_CACHE = 'wanderlog-tiles-v1';
const MAX_TILES = 600;

const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const libs = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(async (url) => {
      if (await libs.match(url)) return;
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await libs.put(url, res);
    })).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, LIB_CACHE, TILE_CACHE];
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const isTile = (url) => url.hostname === 'server.arcgisonline.com' || url.hostname === 'tile.openstreetmap.org';
const isLib = (url) => (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (isLib(url)) {
    event.respondWith(cacheFirst(req, LIB_CACHE));
  } else if (isTile(url)) {
    event.respondWith(tile(req));
  }
  // Anything else isn't touched: sync and searches always go to the network.
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    // Save a fresh copy of the app's files (not other pages' query strings).
    if (res.ok && res.type === 'basic') await cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
    return res;
  } catch (err) {
    const hit = req.mode === 'navigate'
      ? await cache.match('index.html')
      : await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type !== 'opaque') await cache.put(req, res.clone());
  return res;
}

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Only CORS tiles are kept (opaque ones count heavily against storage).
  if (res.ok && res.type === 'cors') {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
  return res;
}
