const CACHE = 'rituel-gestion-v2';
const ASSETS = ['./', './assets/style.css?v=2', './assets/app.js?v=2', './manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api.php')) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
