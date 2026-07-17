// ============================================================
// Service worker — installable PWA with offline play.
// Same-origin assets: stale-while-revalidate (instant loads,
// silent background updates). Firebase/Google traffic: network
// only (never cache realtime data or auth).
// ============================================================

const CACHE = 'starshards-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './icon-192.png',
  './icon-512.png',
  './js/main.js', './js/config.js', './js/i18n.js', './js/util.js',
  './js/audio.js', './js/fb.js', './js/profile.js', './js/input.js',
  './js/world.js', './js/chars.js', './js/weapons.js', './js/game.js',
  './js/bots.js', './js/net.js', './js/ui.js',
  './js/vendor/three.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
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
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never intercept firebase / google traffic
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    }),
  );
});
