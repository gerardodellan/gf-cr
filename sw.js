// Caché del cascarón de la app. La API (script.google.com) nunca se cachea.
const CACHE = 'gf-cr-v8';
const ARCHIVOS = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'datos/indice.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // red primero: una versión nueva se ve al instante; sin red, la copia guardada
  // no-cache: revalida con el servidor; sin esto la caché HTTP de Pages (10 min) sirve una versión vieja
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
    }
    return r;
  }).catch(() => caches.match(e.request)));
});
