// Service worker: o app abre e funciona sem internet dentro do mercado.
//  - arquivos do site: rede primeiro, cópia salva quando não há sinal
//  - bibliotecas de CDN e fontes (Supabase, leitor de código, mapa): cópia salva primeiro (endereços com versão fixa)
//  - API do Supabase: sempre ao vivo (o app guarda o catálogo no aparelho e enfileira os envios)
const CACHE = 'tb-v18';
const CDN = 'tb-cdn-v1';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/config.js', 'js/chart.js', 'js/core.js', 'js/rancho.js',
  'js/fiscal.js', 'js/account.js', 'js/track.js', 'js/carrinho.js', 'js/voice.js', 'js/fila.js', 'js/ads.js', 'js/presence.js',
  'js/ajudantes.js', 'js/scanner.js', 'js/unitprice.js', 'js/offline.js', 'js/deals.js', 'js/cupom.js', 'js/demo-data.js', 'js/notas.js', 'js/fotopreco.js', 'js/ia.js', 'js/calc.js', 'js/refeicoes.js', 'js/receitas-data.js', 'js/inicio.js', 'js/icons.js', 'js/fx.js', 'js/alerts.js', 'js/resumo.js', 'js/familia.js', 'js/zerar.js',
  'assets/icon.svg', 'assets/icon-192.png', 'assets/apple-touch-icon.png', 'manifest.webmanifest'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// toque na notificação de preço: abre (ou traz para frente) o site nas ofertas
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#ofertas', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(self.registration.scope));
    if (c) { c.navigate?.(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== CDN).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CDN).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // Supabase e outros serviços: sempre ao vivo
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })
    .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
