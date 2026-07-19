// ============================================================
// Service worker — installable PWA with offline play.
//   • HTML + JS + CSS  → network-first (online players always get the
//     freshest code; falls back to cache only when truly offline).
//     This prevents a stale/broken cached bundle from bricking boot.
//   • other same-origin assets → cache-first (fast, offline-friendly).
//   • Firebase / Google traffic → never intercepted.
// Bump CACHE on every meaningful change to evict old bundles.
// ============================================================

const CACHE = 'starshards-v4';
const CORE = [
  './', './index.html', './manifest.json', './css/style.css',
  './icon-192.png', './icon-512.png',
  './js/main.js', './js/config.js', './js/i18n.js', './js/util.js',
  './js/audio.js', './js/fb.js', './js/profile.js', './js/input.js',
  './js/world.js', './js/chars.js', './js/weapons.js', './js/game.js',
  './js/bots.js', './js/net.js', './js/rtc.js', './js/ui.js', './js/icons.js',
  './js/vendor/three.module.js',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isCode = (url) => /\.(?:html|js|css)$/.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/');

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (e.request.mode === 'navigate' || isCode(url)) {
    // network-first: fresh code online, cached code offline
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then((cc) => cc.put(e.request, c)); }
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // other assets: cache-first with background refresh
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((res) => {
        if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then((cc) => cc.put(e.request, c)); }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    }),
  );
});
