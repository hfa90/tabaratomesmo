// Configura o login do Supabase: endereço do site, links permitidos, SMTP próprio e
// os e-mails com a cara do Tá Barato Mesmo? (pasta supabase/email-templates).
//
// No plano gratuito, o Supabase só deixa trocar os e-mails se houver um SMTP próprio.
// Por isso o script trabalha em 3 etapas independentes:
//   1. Site URL + links permitidos (sempre funciona; corrige o link que ia para localhost:3000)
//   2. SMTP próprio (se você informar as variáveis SMTP_*)
//   3. Modelos de e-mail (funciona depois que o SMTP existir)
//
// Como usar (Node 18+), no PowerShell, dentro da pasta do projeto:
//   $env:SUPABASE_ACCESS_TOKEN="sbp_..."            # https://supabase.com/dashboard/account/tokens
//   # SMTP grátis da Brevo (300 e-mails/dia, não precisa de domínio próprio):
//   $env:SMTP_HOST="smtp-relay.brevo.com"; $env:SMTP_PORT="587"
//   $env:SMTP_USER="seu-login@smtp-brevo.com"; $env:SMTP_PASS="xsmtpsib-..."
//   $env:SMTP_FROM="seu-email-verificado@gmail.com"; $env:SMTP_NAME="Tá Barato Mesmo?"
//   node supabase/configurar-auth.mjs
//
// Opcional: SITE_URL=https://seu-dominio.com.br (padrão: GitHub Pages do projeto)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF = 'lygqyliiebcxwxioxbvd';
const SITE = (process.env.SITE_URL || 'https://hfa90.github.io/tabaratomesmo').replace(/\/+$/, ''); // sem barra no fim
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Defina SUPABASE_ACCESS_TOKEN (veja as instruções no topo do arquivo).'); process.exit(1); }

const dir = join(dirname(fileURLToPath(import.meta.url)), 'email-templates');
const tpl = (f) => readFileSync(join(dir, f), 'utf8');

async function patch(label, body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (r.status === 401) { console.error('✗ Token inválido ou expirado. Gere outro em https://supabase.com/dashboard/account/tokens'); process.exit(1); }
  if (!r.ok) { console.error(`✗ ${label} (${r.status}): ${txt}`); return false; }
  console.log(`✓ ${label}`);
  return true;
}

// ---- 1. endereço do site e links permitidos
await patch(`Site URL: ${SITE} e links permitidos`, {
  site_url: SITE,
  uri_allow_list: [`${SITE}/**`, 'http://localhost:8080/**', 'http://127.0.0.1:8080/**', 'http://localhost:5500/**', 'http://127.0.0.1:5500/**'].join(','),
});

// ---- 2. SMTP próprio (opcional, mas necessário para os e-mails personalizados no plano gratuito)
const E = process.env;
let smtpOk = false;
if (E.SMTP_HOST && E.SMTP_USER && E.SMTP_PASS && E.SMTP_FROM) {
  smtpOk = await patch(`SMTP próprio (${E.SMTP_HOST}, remetente ${E.SMTP_FROM})`, {
    smtp_host: E.SMTP_HOST,
    smtp_port: String(E.SMTP_PORT || 587),
    smtp_user: E.SMTP_USER,
    smtp_pass: E.SMTP_PASS,
    smtp_admin_email: E.SMTP_FROM,
    smtp_sender_name: E.SMTP_NAME || 'Tá Barato Mesmo?',
    smtp_max_frequency: 30,          // segundos entre e-mails para o mesmo endereço
    rate_limit_email_sent: 60,       // e-mails por hora (o padrão sem SMTP é muito baixo)
  });
} else {
  console.log('• SMTP não informado (variáveis SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM): pulando.');
}

// ---- 3. modelos de e-mail
const ok = await patch('6 modelos de e-mail com a cara do site', {
  mailer_subjects_confirmation: 'Confirme seu e-mail no Tá Barato Mesmo? 🏷️',
  mailer_templates_confirmation_content: tpl('confirmar-cadastro.html'),
  mailer_subjects_recovery: 'Redefina sua senha do Tá Barato Mesmo?',
  mailer_templates_recovery_content: tpl('redefinir-senha.html'),
  mailer_subjects_magic_link: 'Seu link para entrar no Tá Barato Mesmo?',
  mailer_templates_magic_link_content: tpl('link-magico.html'),
  mailer_subjects_email_change: 'Confirme seu novo e-mail',
  mailer_templates_email_change_content: tpl('trocar-email.html'),
  mailer_subjects_invite: 'Você foi convidado para o Tá Barato Mesmo?',
  mailer_templates_invite_content: tpl('convite.html'),
  mailer_subjects_reauthentication: 'Seu código de confirmação',
  mailer_templates_reauthentication_content: tpl('codigo-reautenticacao.html'),
});
if (!ok && !smtpOk) {
  console.log('\n  No plano gratuito, os e-mails personalizados exigem um SMTP próprio.');
  console.log('  Crie uma conta grátis na Brevo (brevo.com), pegue a senha SMTP em "SMTP & API" e rode de novo');
  console.log('  com as variáveis SMTP_* (veja o topo deste arquivo).');
  console.log('  Enquanto isso, o link do e-mail padrão já abre a página nova (auth.html) do site.');
}
console.log('\nDica: depois de terminar, apague o token em https://supabase.com/dashboard/account/tokens');
