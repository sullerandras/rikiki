/* Service worker for the hosted site. `npm run build` fills in VERSION, FILES and FONTS_CSS.
 * It serves the game from a cache so it starts offline. Each deploy changes VERSION, so the browser
 * installs the new worker, which takes over at once; the page reloads itself on the start screen. */
const VERSION = 'dev';
const FILES = ['./'];
const FONTS_CSS = '';

const APP = 'rikiki-' + VERSION;
const FONTS = 'rikiki-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(APP);
      // 'reload' skips the HTTP cache, so a fresh deploy never gets cached next to stale files.
      await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
      await cacheFonts().catch(() => {}); // nice to have offline, not required
      await self.skipWaiting();
    })(),
  );
});

/** Fetch the Google Fonts stylesheet and its latin font files, so the first offline start has them. */
async function cacheFonts() {
  if (!FONTS_CSS) return;
  const cache = await caches.open(FONTS);
  if (await cache.match(FONTS_CSS)) return;
  const res = await fetch(FONTS_CSS);
  if (!res.ok) return;
  const parts = (await res.clone().text()).split(/\/\* ([\w-]+) \*\//);
  const urls = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] !== 'latin' && parts[i] !== 'latin-ext') continue;
    for (const m of parts[i + 1].matchAll(/url\((https:[^)]+)\)/g)) urls.push(m[1]);
  }
  await cache.addAll([...new Set(urls)]);
  await cache.put(FONTS_CSS, res);
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Other sites on the same github.io origin share this cache storage, so only touch ours.
      for (const key of await caches.keys()) {
        if (key.startsWith('rikiki-') && key !== APP && key !== FONTS) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches
        .open(APP)
        .then((c) => c.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true }))
        .then((hit) => hit || fetch(req)),
    );
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }),
    );
  }
});
