/* Rituel Barber — Gestion : service worker.
   Cache le "coffre" de l'app (HTML/CSS/JS) pour l'ouverture hors-ligne.
   Les appels API ne sont JAMAIS mis en cache. */

const CACHE = 'rb-gestion-v1';
const SHELL = [
  './',
  'index.html',
  'assets/styles.css?v=1',
  'assets/app.js?v=1',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.endsWith('api.php')) {
    return; // API : toujours le réseau
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(
      (hit) => hit || fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
