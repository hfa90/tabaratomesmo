// Service worker simples: cache do "casco" do app para abrir rápido e offline.
const CACHE = 'tb-v2';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/chart.js', 'js/core.js', 'js/rancho.js', 'js/fiscal.js', 'assets/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API do Supabase sempre ao vivo
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
