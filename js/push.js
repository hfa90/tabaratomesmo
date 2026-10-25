// Avisos no celular com o site FECHADO (Web Push).
// O navegador cria uma "inscrição" (endereço do serviço de push + chaves). Ela vai para o banco junto com
// o que acompanhar: favoritos e itens já comprados, mercados preferidos, a lista da família e a posição
// arredondada (~1 km, só se a pessoa liberou a localização). A função "notificar" do Supabase confere a cada
// 15 minutos e manda o aviso. Sem a função publicada, os avisos continuam funcionando com o site aberto.
import * as api from './api.js';
import { CONFIG } from './config.js';
import { S } from './core.js';

const PREFS_DEFAULT = { precos: true, familia: true, campanhas: true };
export const prefs = () => ({ ...PREFS_DEFAULT, ...(api.store.get('tb.pushPrefs', {}) || {}) });

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** o navegador entrega avisos com o site fechado? */
export const supported = () => !!(CONFIG.VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
/** no iPhone só funciona com o site adicionado à tela de início */
export const needsInstall = () => isIOS() && !standalone();

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const device = () => { try { return localStorage.getItem('tb.dev'); } catch { return null; } };

async function boughtIds() { try { return (await import('./alerts.js')).boughtIds(); } catch { return []; } }

async function payload(sub) {
  const j = sub.toJSON();
  const markets = (S.profile?.preferred_markets?.length ? S.profile.preferred_markets : [...S.enabled]).slice(0, 20);
  const watch = [...new Set([...S.favs, ...(await boughtIds())])].slice(0, 120);
  const real = S.pos && S.pos.label !== CONFIG.DEFAULT_POS.label;
  return {
    endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, device: device(),
    prefs: prefs(), markets, watch_ids: watch,
    lat: real ? Math.round(S.pos.lat * 100) / 100 : null, lng: real ? Math.round(S.pos.lng * 100) / 100 : null,
    family_code: api.store.get('tb.family', null), family_by: (S.profile?.full_name || S.user?.user_metadata?.full_name || api.store.get('tb.famName', '') || '').split(' ')[0] || null,
  };
}

async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** liga os avisos com o site fechado (a permissão do navegador já tem que estar concedida) */
export async function subscribe() {
  if (!supported() || Notification.permission !== 'granted' || api.MODE !== 'live') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CONFIG.VAPID_PUBLIC_KEY) });
    const p = await payload(sub);
    await api.pushSubscribe(p);
    api.store.set('tb.pushHash', hash(p)); api.store.set('tb.pushAt', Date.now());
    if (!api.store.get('tb.pushOnce')) { api.store.set('tb.pushOnce', true); (await import('./track.js')).track('push_on'); }
    return true;
  } catch (e) { console.warn('push', e.message); return false; }
}

export async function unsubscribe() {
  try {
    const sub = await current(); if (!sub) return;
    const ep = sub.endpoint; await sub.unsubscribe();
    await api.pushUnsubscribe(ep).catch(() => {});
  } catch {}
  api.store.set('tb.pushHash', null);
}

const hash = (p) => JSON.stringify([p.endpoint, p.prefs, p.markets, p.watch_ids, p.lat, p.lng, p.family_code, p.family_by]);

/** mantém o que o servidor acompanha em dia (favoritos novos, lista da família, mudou de bairro…) */
let t = null;
export function refresh(delay = 3000) {
  clearTimeout(t);
  t = setTimeout(async () => {
    if (!supported() || Notification.permission !== 'granted' || api.MODE !== 'live') return;
    if (api.store.get('tb.notify', true) === false) return;
    try {
      const sub = await current(); if (!sub) { subscribe(); return; }
      const p = await payload(sub);
      if (hash(p) === api.store.get('tb.pushHash', null) && Date.now() - (api.store.get('tb.pushAt', 0) || 0) < 7 * 864e5) return;
      await api.pushSubscribe(p);
      api.store.set('tb.pushHash', hash(p)); api.store.set('tb.pushAt', Date.now());
    } catch {}
  }, delay);
}

export function setPref(k, on) {
  const p = prefs(); p[k] = !!on; api.store.set('tb.pushPrefs', p); refresh(200);
}

// ao sair do app (trocar de aba, bloquear a tela) confere se algo mudou
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') refresh(0); });
