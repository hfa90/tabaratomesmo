// Página de conta (auth.html): para onde apontam os links dos e-mails.
//  • confirmar o e-mail do cadastro          ?token_hash=…&type=signup
//  • redefinir a senha                       ?token_hash=…&type=recovery
//  • confirmar a troca de e-mail             ?token_hash=…&type=email_change
//  • convite / link mágico                   ?token_hash=…&type=invite|magiclink
// Também entende os formatos antigos do Supabase (#access_token=…&type=… e ?code=…)
// e mostra uma tela clara quando o link expirou, com a opção de pedir outro.
import { CONFIG } from './config.js';

const card = document.getElementById('auCard');
const link = window.__authLink || { search: location.search, hash: location.hash };
const Q = new URLSearchParams(link.search);
const H = new URLSearchParams((link.hash || '').replace(/^#/, ''));
const get = (k) => Q.get(k) || H.get(k);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const home = new URL('./', location.href).href;
const here = new URL('auth.html', location.href).href;
let sb;

async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  // detectSessionInUrl desligado: esta página trata o link ela mesma
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' } });
  return sb;
}

function show(html, mood = '') {
  card.className = `au-card ${mood ? 'is-' + mood : ''}`;
  card.innerHTML = html;
  card.querySelector('input:not([type=hidden])')?.focus({ preventScroll: true });
  // limpa o token do endereço (não fica no histórico nem é compartilhado sem querer)
  history.replaceState(null, '', location.pathname + (get('flow') ? `?flow=${encodeURIComponent(get('flow'))}` : ''));
}

const firstName = (u) => (u?.user_metadata?.full_name || '').trim().split(/\s+/)[0] || '';

const ptError = (e) => {
  const m = `${e?.code || ''} ${e?.message || ''}`.toLowerCase();
  if (/same_password|different from the old/.test(m)) return 'A nova senha precisa ser diferente da senha atual.';
  if (/weak_password|weak|at least/.test(m)) return 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.';
  if (/rate|too many|security purposes/.test(m)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  if (/expired|invalid|otp/.test(m)) return 'Este link expirou ou já foi usado.';
  if (/session|jwt|not authenticated/.test(m)) return 'Sua sessão expirou. Peça um novo link.';
  if (/fetch|network|failed to/.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return e?.message || 'Algo deu errado. Tente de novo.';
};

// ---------------------------------------------------------------- telas
function screenPassword(user, invite = false) {
  show(`
    <span class="au-tag" aria-hidden="true">🔑</span>
    <h1 class="au-h">${invite ? 'Crie sua senha' : 'Escolha uma nova senha'}</h1>
    <p class="muted">${user?.email ? `Para a conta <b>${esc(user.email)}</b>.` : ''} Depois disso você já entra direto no site.</p>
    <form class="form au-form" id="pwForm" novalidate>
      <label>Nova senha<span class="pw"><input name="p1" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo 8 caracteres" /><button type="button" class="pw__t" aria-label="Mostrar senha">Mostrar</button></span></label>
      <div class="au-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <ul class="au-rules" id="pwRules">
        <li data-r="len">8 caracteres ou mais</li>
        <li data-r="mix">Letras e números</li>
        <li data-r="eq">As duas senhas iguais</li>
      </ul>
      <label>Repita a nova senha<span class="pw"><input name="p2" type="password" autocomplete="new-password" required /><button type="button" class="pw__t" aria-label="Mostrar senha">Mostrar</button></span></label>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block btn--xl" type="submit">Salvar nova senha</button>
    </form>`);
  const f = document.getElementById('pwForm');
  f.querySelectorAll('.pw__t').forEach((b) => b.addEventListener('click', () => {
    const i = b.previousElementSibling; const on = i.type === 'password';
    i.type = on ? 'text' : 'password'; b.textContent = on ? 'Ocultar' : 'Mostrar';
  }));
  const rules = () => {
    const a = f.p1.value, b = f.p2.value;
    const r = { len: a.length >= 8, mix: /[a-z]/i.test(a) && /\d/.test(a), eq: !!a && a === b };
    for (const [k, ok] of Object.entries(r)) f.querySelector(`[data-r=${k}]`).classList.toggle('is-ok', ok);
    const score = (a.length >= 8) + (/[a-z]/i.test(a) && /\d/.test(a)) + (a.length >= 12) + /[^a-z0-9]/i.test(a);
    f.querySelector('.au-meter').dataset.s = a ? score : 0;
    return r;
  };
  f.addEventListener('input', rules);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = f.querySelector('.form__err'); err.textContent = '';
    const r = rules();
    if (!r.len) return (err.textContent = 'A senha precisa ter pelo menos 8 caracteres.');
    if (!r.mix) return (err.textContent = 'Misture letras e números para a senha ficar segura.');
    if (!r.eq) return (err.textContent = 'As duas senhas não são iguais.');
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const c = await client();
      const { error } = await c.auth.updateUser({ password: f.p1.value });
      if (error) throw error;
      screenPasswordDone(user);
    } catch (ex) { err.textContent = ptError(ex); btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
  });
}

function screenPasswordDone(user) {
  show(`
    <div class="au-burst" aria-hidden="true"><span>✓</span></div>
    <h1 class="au-h">Senha alterada!</h1>
    <p>Pronto${firstName(user) ? `, ${esc(firstName(user))}` : ''}. Você já está conectado neste aparelho.</p>
    <p class="muted small">Nos outros aparelhos, entre de novo com a senha nova.</p>
    <a class="btn btn--primary btn--block btn--xl" href="${home}#ofertas">Ver os preços de hoje</a>
    <p class="au-count muted small" id="auCount"></p>`, 'ok');
  countdown(`${home}#ofertas`);
}

function screenConfirmed(user, kind = 'signup') {
  const name = firstName(user);
  if (kind === 'email_change') {
    show(`
      <div class="au-burst" aria-hidden="true"><span>✓</span></div>
      <h1 class="au-h">Novo e-mail confirmado</h1>
      <p>A partir de agora, entre com <b>${esc(user?.email || 'o novo e-mail')}</b>.</p>
      <a class="btn btn--primary btn--block btn--xl" href="${home}#conta">Ir para a minha conta</a>`, 'ok');
    return;
  }
  show(`
    <div class="au-burst" aria-hidden="true"><span>✓</span></div>
    <p class="au-kicker">E-mail confirmado</p>
    <h1 class="au-h">Bem-vindo${name ? `, ${esc(name)}` : ''}!</h1>
    <p>Sua conta no <b>Tá Barato Mesmo?</b> está ativa. Veja o que já é seu:</p>
    <ul class="au-perks">
      <li><span aria-hidden="true">🔎</span><span><b>${CONFIG.QUICK_COMPARISONS} comparações</b> de preço liberadas agora</span></li>
      <li><span aria-hidden="true">♾️</span><span><b>Sem limite</b> quando completar o cadastro (1 minuto)</span></li>
      <li><span aria-hidden="true">🧾</span><span>Mande a <b>nota fiscal</b> da compra e ganhe pontos e comparações extras</span></li>
      <li><span aria-hidden="true">🛒</span><span>Monte o <b>rancho do mês</b> e descubra onde ele sai mais barato</span></li>
    </ul>
    <a class="btn btn--primary btn--block btn--xl" href="${home}#completar">Completar cadastro agora</a>
    <a class="btn btn--ghost btn--block" href="${home}#ofertas">Depois, quero ver os preços</a>`, 'ok');
}

function screenSignedIn(user) {
  show(`
    <div class="au-burst" aria-hidden="true"><span>✓</span></div>
    <h1 class="au-h">Você entrou${firstName(user) ? `, ${esc(firstName(user))}` : ''}!</h1>
    <a class="btn btn--primary btn--block btn--xl" href="${home}#ofertas">Continuar</a>
    <p class="au-count muted small" id="auCount"></p>`, 'ok');
  countdown(`${home}#ofertas`);
}

function screenExpired(kind, why = '') {
  const isSignup = kind === 'signup' || kind === 'email' || kind === 'invite';
  show(`
    <span class="au-tag au-tag--sad" aria-hidden="true">⌛</span>
    <h1 class="au-h">Este link expirou</h1>
    <p class="muted">${esc(why || 'Por segurança, os links valem por pouco tempo e só podem ser usados uma vez.')} Peça outro abaixo, chega em segundos.</p>
    <form class="form au-form" id="reForm" novalidate>
      <fieldset class="au-seg" aria-label="O que você quer fazer?">
        <label><input type="radio" name="k" value="recovery" ${isSignup ? '' : 'checked'} /><span>Redefinir senha</span></label>
        <label><input type="radio" name="k" value="signup" ${isSignup ? 'checked' : ''} /><span>Confirmar cadastro</span></label>
      </fieldset>
      <label>Seu e-mail<input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="voce@email.com" /></label>
      <p class="form__err" role="alert"></p>
      <button class="btn btn--primary btn--block btn--xl" type="submit">Enviar novo link</button>
    </form>
    <a class="btn btn--text btn--block" href="${home}">Voltar para o site</a>`, 'warn');
  const f = document.getElementById('reForm');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = f.querySelector('.form__err'); err.textContent = '';
    const email = f.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'Informe um e-mail válido.');
    const k = f.k.value; const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const c = await client();
      const { error } = k === 'signup'
        ? await c.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${here}?flow=signup` } })
        : await c.auth.resetPasswordForEmail(email, { redirectTo: `${here}?flow=recovery` });
      if (error) throw error;
      show(`
        <span class="au-tag" aria-hidden="true">📬</span>
        <h1 class="au-h">Confira seu e-mail</h1>
        <p>Se houver uma conta com <b>${esc(email)}</b>, o novo link chega em instantes.</p>
        <p class="muted small">Não achou? Olhe também em <b>Spam</b> e <b>Promoções</b>.</p>
        <a class="btn btn--ghost btn--block" href="${home}">Voltar para o site</a>`);
    } catch (ex) { err.textContent = ptError(ex); btn.disabled = false; btn.textContent = 'Enviar novo link'; }
  });
}

function screenNothing(user) {
  show(`
    <span class="au-tag" aria-hidden="true">🏷️</span>
    <h1 class="au-h">${user ? 'Tudo certo com a sua conta' : 'Link incompleto'}</h1>
    <p class="muted">${user ? `Você está conectado como <b>${esc(user.email)}</b>.` : 'Abra o link direto do e-mail que você recebeu. Se ele não funcionar, peça outro.'}</p>
    ${user ? `<button class="btn btn--ghost btn--block" id="chgPw">Trocar minha senha</button>` : `<button class="btn btn--primary btn--block btn--xl" id="newLink">Pedir um novo link</button>`}
    <a class="btn btn--text btn--block" href="${home}">Voltar para o site</a>`);
  document.getElementById('chgPw')?.addEventListener('click', () => screenPassword(user));
  document.getElementById('newLink')?.addEventListener('click', () => screenExpired(get('flow') || 'recovery', 'Vamos mandar um link novinho.'));
}

function countdown(url, s = 6) {
  const el = document.getElementById('auCount'); if (!el) return;
  let n = s; const tick = () => { el.textContent = `Indo para o site em ${n}s…`; if (n-- <= 0) location.href = url; else setTimeout(tick, 1000); };
  tick();
  card.addEventListener('click', () => { n = 1e9; el.textContent = ''; }, { once: true });
}

// ---------------------------------------------------------------- início
async function run() {
  const type = (get('type') || get('flow') || '').toLowerCase();
  const errCode = get('error_code') || get('error');
  if (errCode) return screenExpired(type || get('flow'), /expired|otp/i.test(errCode + get('error_description')) ? '' : (get('error_description') || '').replace(/\+/g, ' '));

  let c;
  try { c = await client(); } catch { return show(`<span class="au-tag au-tag--sad">📴</span><h1 class="au-h">Sem conexão</h1><p class="muted">Confira a internet e abra o link de novo.</p>`, 'warn'); }

  let user = null;
  try {
    const tokenHash = get('token_hash');
    const code = get('code');
    const at = H.get('access_token'), rt = H.get('refresh_token');
    if (tokenHash) {
      const t = type === 'signup' ? 'email' : (type || 'email');
      let { data, error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: t });
      if (error && type === 'signup') ({ data, error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' }));
      if (error) throw error;
      user = data.user || data.session?.user;
    } else if (code) {
      const { data, error } = await c.auth.exchangeCodeForSession(code);
      if (error) throw error;
      user = data.user;
    } else if (at && rt) {
      const { data, error } = await c.auth.setSession({ access_token: at, refresh_token: rt });
      if (error) throw error;
      user = data.user;
    } else {
      const { data } = await c.auth.getSession();
      return screenNothing(data.session?.user || null);
    }
  } catch (e) {
    return screenExpired(type, /expired|invalid|otp|used/i.test(`${e.code} ${e.message}`) ? '' : ptError(e));
  }

  if (type === 'recovery') return screenPassword(user);
  if (type === 'invite') return screenPassword(user, true);
  if (type === 'email_change') return screenConfirmed(user, 'email_change');
  if (type === 'magiclink') return screenSignedIn(user);
  return screenConfirmed(user, 'signup');
}

run();
