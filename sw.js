// First Stone service worker — offline-first, cache-first for our own files.
// Bump CACHE on ANY asset change (tests/sw.test.js checks the list matches disk).
const CACHE = 'firststone-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './css/app.css',
  './fonts/fraunces-latin.woff2',
  './fonts/gowun-batang-400.woff2',
  './fonts/gowun-batang-700.woff2',
  './js/app.js',
  './js/engine.js',
  './js/i18n.js',
  './js/store.js',
  './js/backup.js',
  './data/evidence.json',
  './data/rules.json',
  './locales/en.json',
  './locales/ko.json',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
    ),
  );
});
