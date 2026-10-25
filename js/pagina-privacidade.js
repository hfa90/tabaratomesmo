// privacidade.html: "baixar meus dados" (js/privacidade.js) e o contato definido pela administração.
import { CONFIG } from './config.js';
import { esc } from './core.js';
import { initAccount } from './pagina.js';
import './privacidade.js';

initAccount();
fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_settings?key=eq.privacy_contact&select=value`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` } })
  .then((r) => r.json()).then((rows) => {
    const v = typeof rows?.[0]?.value === 'string' ? rows[0].value.trim() : '';
    if (!v) return;
    const link = /@/.test(v) ? `<a class="linkish" href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v);
    document.getElementById('pgContact').innerHTML = `Para qualquer pedido sobre dados pessoais, fale com o responsável pela privacidade: <b>${link}</b>. Respondemos em até 15 dias.`;
  }).catch(() => {});
