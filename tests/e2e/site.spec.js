// Testes do site com os dados de demonstração (o banco real fica bloqueado: nada é gravado no Supabase).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

test.beforeEach(async ({ context }) => {
  await context.route(/supabase\.co/, (r) => r.abort());
});

/** abre uma página e junta os erros de JavaScript */
async function open(page, url) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return errors;
}
const ofertas = async (page) => { const errs = await open(page, '/#ofertas'); await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 }); return errs; };

test('página inicial abre sem erro para quem chega pela primeira vez', async ({ page }) => {
  const errs = await open(page, '/');
  await expect(page.locator('#view-inicio')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.brand__name').first()).toContainText('Tá Barato');
  expect(errs).toEqual([]);
});

test('ofertas mostram produtos com preço e selo de atualização', async ({ page }) => {
  const errs = await ofertas(page);
  expect(await page.locator('.card').count()).toBeGreaterThan(5);
  await expect(page.locator('.card .trust').first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('busca filtra os produtos', async ({ page }) => {
  await ofertas(page);
  const all = await page.locator('.card').count();
  await page.fill('#searchInput', 'arroz');
  await expect.poll(async () => page.locator('.card').count()).toBeLessThan(all);
  await expect(page.locator('.card h3').first()).toContainText(/arroz/i);
});

test('adicionar ao rancho atualiza o número da lista', async ({ page }) => {
  await ofertas(page);
  await page.locator('.card [data-add]').first().click();
  await expect(page.locator('[data-list-count]:visible').first()).toHaveText('1');
});

test('detalhe do produto mostra quando e de onde veio cada preço', async ({ page }) => {
  await ofertas(page);
  await page.locator('.card__hit').first().click();
  await expect(page.locator('#productSheet')).toBeVisible();
  await expect(page.locator('#productSheet .trust-line').first()).toContainText(/hoje|ontem|dias|semanas/);
});

test('"Conferir um preço" junta código, foto e nota num só lugar', async ({ page }) => {
  await ofertas(page);
  await page.locator('[data-tool="conferir"]').click();
  await expect(page.locator('#toolSheet .cf-opt')).toHaveCount(3);
  await expect(page.locator('#toolSheet')).toContainText('Ler o código de barras');
  await expect(page.locator('#toolSheet')).toContainText('Mandar a nota fiscal');
});

test('no mercado, a calculadora é o padrão e a voz é opção', async ({ page }) => {
  await open(page, '/#carrinho');
  await expect(page.locator('[data-ck-mode="calc"]')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(page.locator('[data-ck-mode="voz"]')).toBeVisible();
});

test('letra grande liga em Preferências e continua ligada ao voltar', async ({ page }) => {
  await open(page, '/#conta');
  await expect(page.locator('[data-pref="bigText"]')).toBeAttached({ timeout: 15_000 });
  await page.locator('[data-pref="bigText"]').evaluate((el) => el.click());
  await expect(page.locator('html')).toHaveClass(/big/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/big/);
});

test('no máximo uma interrupção por visita', async ({ page }) => {
  await ofertas(page);
  const r = await page.evaluate(async () => {
    sessionStorage.removeItem('tb.intr');
    const m = await import('./js/interrupt.js');
    return [m.claim('campanha'), m.claim('pedir-avisos'), m.used()];
  });
  expect(r).toEqual([true, false, 'campanha']);
});

test('trocar de tela marca a aba certa', async ({ page }) => {
  await ofertas(page);
  await page.goto('/#lista');
  await expect(page.locator('.tabbar [data-nav="lista"], .topbar [data-nav="lista"]').first()).toHaveClass(/is-active/);
});

test('privacidade: a política abre e "baixar meus dados" gera um arquivo', async ({ page }) => {
  const errs = await open(page, '/privacidade.html');
  await expect(page.locator('h1')).toContainText('Seus dados');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-priv="export"]').first().click()]);
  expect(dl.suggestedFilename()).toMatch(/^meus-dados-tabaratomesmo-.*\.json$/);
  const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(data).toHaveProperty('aparelho');
  expect(errs).toEqual([]);
});

test('página pública do supermercado tem título, lojas e dados para o Google', async ({ page }) => {
  const errs = await open(page, '/mercado.html?m=coema');
  await expect(page.locator('h1')).toHaveText('Coema', { timeout: 15_000 });
  await expect(page).toHaveTitle(/Coema em Manaus/);
  expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
  await expect(page.locator('.mk-stores li').first()).toBeVisible();
  expect(errs).toEqual([]);
});

test('lista de supermercados leva a cada página', async ({ page }) => {
  await open(page, '/mercado.html');
  await expect(page.locator('.mk-card')).toHaveCount(5, { timeout: 15_000 });
});

test('administração (demonstração): uso do site e saúde do banco', async ({ page }) => {
  const errs = await open(page, '/admin.html');
  await page.locator('[data-demo]').click({ timeout: 15_000 });
  await page.goto('/admin.html#uso');
  await expect(page.locator('#uso .kpi').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#uso')).toContainText('Quem volta');
  await page.goto('/admin.html#saude');
  await expect(page.locator('#saude')).toContainText(/Banco em dia|Falta rodar/);
  expect(errs).toEqual([]);
});

test('administração (demonstração): gerar e apagar dados fictícios, zerar com confirmação', async ({ page }) => {
  const errs = await open(page, '/admin.html');
  await page.locator('[data-demo]').click({ timeout: 15_000 });
  await page.goto('/admin.html#apresentacao');
  await expect(page.locator('#apr')).toContainText('Sem dados fictícios agora', { timeout: 15_000 });
  await page.locator('[data-fic-seed]').click();
  await expect(page.locator('#apr')).toContainText('Os dados fictícios estão no ar', { timeout: 15_000 });
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-fic-clear]').click();
  await expect(page.locator('#apr')).toContainText('Sem dados fictícios agora');
  page.once('dialog', (d) => d.accept('errado'));
  await page.locator('[data-fic-reset]').click();
  await expect(page.locator('.toast').last()).toContainText('Digite ZERAR');
  page.once('dialog', (d) => d.accept('zerar'));
  await page.locator('[data-fic-reset]').click();
  await expect(page.locator('.toast').last()).toContainText('Uso do site zerado');
  expect(errs).toEqual([]);
});

test('o service worker guarda só arquivos que existem', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const missing = list.filter((f) => f !== './' && !fs.existsSync(path.join(ROOT, f)));
  expect(missing).toEqual([]);
});

test('link de produto (?produto=ID) abre o detalhe com o aviso de que os preços podem mudar', async ({ page }) => {
  const errs = await ofertas(page);
  const pid = await page.locator('.card[data-pid]').first().getAttribute('data-pid');
  await page.goto(`/?produto=${pid}#ofertas`);
  await expect(page.locator('#productSheet')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#productSheet .pd__disclaimer')).toContainText('podem mudar sem aviso prévio');
  await expect(page.locator('#productSheet .pd__disclaimer')).toContainText('não controla os preços');
  expect(page.url()).not.toContain('produto=');
  expect(errs).toEqual([]);
});

test('admin › Mapa de unidades: mostra as unidades do OpenStreetMap e cadastra uma', async ({ page }) => {
  // OpenStreetMap simulado: uma unidade de uma rede do site (DB) e um mercado qualquer
  const osm = { elements: [
    { type: 'node', id: 1, lat: -3.0896, lon: -60.0564, tags: { shop: 'supermarket', name: 'Supermercado DB Ponta Negra', brand: 'DB' } },
    { type: 'way', id: 2, center: { lat: -3.12, lon: -60.02 }, tags: { shop: 'supermarket', name: 'Mercadinho Teste', 'addr:street': 'Rua A', 'addr:housenumber': '10', 'addr:suburb': 'Centro', opening_hours: 'Mo-Sa 07:00-21:00' } },
  ] };
  await page.route(/overpass/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(osm) }));
  await page.route(/nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"address":{}}' }));
  const errs = await open(page, '/admin.html');
  await page.click('[data-demo]');
  await page.goto('/admin.html#unidades');
  await expect(page.locator('path.um-pin--todo')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('path.um-pin--other')).toHaveCount(1);
  await page.locator('[data-um-go="node/1"]').evaluate((b) => b.click());
  const f = page.locator('#umForm');
  await expect(f.locator('input[name=name]')).toHaveValue('DB Ponta Negra');
  await expect(f.locator('input[name=neighborhood]')).toHaveValue('Ponta Negra');
  await f.locator('.btn--primary').evaluate((b) => b.click());
  await expect(page.locator('#umPanel .note')).toContainText('cadastrada');
  await expect(page.locator('path.um-pin--todo')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('portal: o mercado cadastra a própria unidade e cria promoção só nela; o site mostra em cima do produto', async ({ page }) => {
  const osm = { elements: [{ type: 'node', id: 10, lat: -3.072, lon: -60.016, tags: { shop: 'supermarket', name: 'Supermercado Coema', 'addr:suburb': 'Flores' } }] };
  await page.route(/overpass/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(osm) }));
  await page.route(/nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"address":{}}' }));
  const errs = await open(page, '/parceiros.html');
  await page.click('[data-demo]');
  await page.goto('/parceiros.html#unidades');
  await page.locator('[data-um-go="node/10"]').evaluate((b) => b.click());
  const f = page.locator('#umForm');
  await expect(f.locator('select[name=market]')).toBeDisabled(); // só a própria rede
  await expect(f.locator('input[name=name]')).toHaveValue('Coema Flores');
  await f.locator('.btn--primary').evaluate((b) => b.click());
  await expect(page.locator('#umPanel .note')).toContainText('cadastrada');
  await page.goto('/parceiros.html#promocoes');
  await page.click('[data-newpromo]');
  const pf = page.locator('#promoForm');
  await pf.locator('select[name=store_id]').selectOption({ label: 'Só na unidade Coema Flores (Flores)' });
  const pid = await pf.locator('select[name=product_id]').inputValue();
  const label = await pf.locator('select[name=product_id] option:checked').textContent();
  const price = Number(label.match(/R\$\s*([\d.,]+)/)[1].replace('.', '').replace(',', '.'));
  await pf.locator('input[name=promo_price]').fill((Math.round(price * 70) / 100).toFixed(2).replace('.', ','));
  await pf.locator('input[value=geral]').check();
  await pf.locator('.btn--primary').evaluate((b) => b.click());
  await expect(page.locator('#promoWrap .pill--unit')).toContainText('Coema Flores');
  await page.goto('/#ofertas');
  // a vitrine de ofertas muda com o dia: procura o produto pelo nome para o card aparecer
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });
  await page.fill('#searchInput', label.trim().split(/\s+/).slice(0, 2).join(' '));
  const card = page.locator(`.card[data-pid="${pid}"]`);
  await expect(card.locator('.card__unit')).toContainText('só no Coema Flores');
  await card.locator('.card__hit').click();
  await expect(page.locator('#productSheet .unit-promo')).toContainText('Nas outras unidades do Coema vale o preço normal');
  expect(errs).toEqual([]);
});

test('encarte: o que já foi lido continua lá ao sair e voltar', async ({ page }) => {
  const errs = await open(page, '/admin.html');
  await page.click('[data-demo]');
  await page.goto('/admin.html#encartes');
  // uma "foto" de encarte qualquer: na demonstração a leitura é simulada
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
  await page.setInputFiles('#enFiles', { name: 'encarte.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.en-tbl tbody tr').first()).toBeVisible({ timeout: 20_000 });
  const n = await page.locator('.en-tbl tbody tr').count();
  await page.goto('/admin.html#usuarios');
  await page.goto('/admin.html#encartes');
  await expect(page.locator('.en-saved')).toContainText('Encarte em andamento');
  await expect(page.locator('.en-tbl tbody tr')).toHaveCount(n);
  await page.click('[data-en-reset]');
  await expect(page.locator('.en-tbl tbody tr')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('o robô do Telegram usa o mesmo leitor de frases do site', async () => {
  const a = fs.readFileSync(path.join(ROOT, 'js/voice.js'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'supabase/functions/telegram/voice.js'), 'utf8');
  expect(b === a, 'copie js/voice.js para supabase/functions/telegram/voice.js e publique a função telegram').toBe(true);
});

test('nenhum segredo no código do site', async () => {
  const files = ['js', 'supabase/functions'].flatMap((d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).map((f) => path.join(ROOT, d, String(f))))
    .filter((f) => fs.statSync(f).isFile());
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    expect(s, f).not.toMatch(/service_role"|sk-ant-[a-z0-9]/i);
    expect(s, f).not.toMatch(/VAPID_PRIVATE_KEY\s*[:=]\s*['"][A-Za-z0-9_-]{30,}/);
  }
});

// ---------------------------------------------------------------- dados de uma conta não podem aparecer em outra
test('conta nova no mesmo aparelho não herda o histórico da conta anterior', async ({ page }) => {
  const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
  await page.goto('/privacidade.html');
  await page.evaluate(({ A, B }) => {
    localStorage.clear();
    localStorage.setItem('tb.history', JSON.stringify({ '2026-10': { month: '2026-10', savings: 10 } }));
    localStorage.setItem('tb.purchases', JSON.stringify([{ market: 1, total: 55.88 }]));
    localStorage.setItem('tb.haptics', 'false');
    localStorage.setItem('tb.owner', A);
    localStorage.setItem('sb-teste-auth-token', JSON.stringify({ user: { id: B } })); // sessão de outra pessoa
  }, { A, B });
  const errs = await open(page, '/#conta');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({ owner: localStorage.getItem('tb.owner'), h: localStorage.getItem('tb.history'), p: localStorage.getItem('tb.purchases'), hap: localStorage.getItem('tb.haptics') }));
  expect(st.owner).toBe(B);
  expect(st.h).toBeNull();
  expect(st.p).toBeNull();
  expect(st.hap).toBe('false'); // preferência do aparelho fica
  expect(errs).toEqual([]);
});

test('sair da conta limpa os dados dela do aparelho', async ({ page }) => {
  await page.goto('/privacidade.html');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tb.history', JSON.stringify({ '2026-10': { month: '2026-10', savings: 10 } }));
    localStorage.setItem('tb.owner', '11111111-1111-1111-1111-111111111111'); // sem sessão = a conta saiu
  });
  await open(page, '/#ofertas');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => localStorage.getItem('tb.history'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('tb.owner'))).toBe('anon');
});

// ---------------------------------------------------------------- página de cada supermercado e módulos novos do portal
test('parceiros.html?m=slug abre com as cores e a logo do mercado', async ({ page }) => {
  const errs = await open(page, '/parceiros.html?m=veneza');
  await expect(page.locator('.mk-hero h1')).toHaveText('Veneza', { timeout: 15_000 });
  await expect(page.locator('body')).toHaveClass(/is-branded/);
  const brand = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--brand').trim().toLowerCase());
  expect(brand).not.toBe('#0f5a3e'); // não é o verde padrão
  expect(errs).toEqual([]);
});

test('portal: vendas comprovadas, cubra a diferença, demanda e queima abrem sem erro', async ({ page }) => {
  const errs = await open(page, '/parceiros.html');
  await page.click('[data-demo]');
  await page.goto('/parceiros.html#vendas');
  await expect(page.locator('.proof-hero')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.src-card')).toHaveCount(6);
  await page.goto('/parceiros.html#cubra');
  await expect(page.locator('#cvForm')).toBeVisible();
  await page.locator('#cvActive').check({ force: true });
  await page.locator('#cvForm .btn--primary').click();
  await expect(page.locator('.toast').last()).toContainText('Regras salvas');
  await page.goto('/parceiros.html#demanda');
  await expect(page.locator('.dm-row').first()).toBeVisible();
  const r = page.locator('[data-dm-range]').first();
  await r.evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('[data-dm-txt]').first()).toContainText('mais barato em');
  await page.goto('/parceiros.html#queima');
  await page.locator('[data-qm="new"]').first().click();
  const f = page.locator('#qmForm');
  await f.locator('[name=title]').fill('Pão de forma');
  await f.locator('[name=category_slug]').selectOption({ index: 1 });
  await f.locator('[name=regular_price]').fill('8,99');
  await f.locator('[name=price]').fill('4,99');
  await f.locator('.btn--primary').click();
  await expect(page.locator('.qm-card h3', { hasText: 'Pão de forma' })).toBeVisible();
  expect(errs).toEqual([]);
});

// ---------------------------------------------------------------- publicidade inteligente (sempre de um produto)
test('publicidade inteligente: busca patrocinada, sugestão na lista e hora de repor', async ({ page }) => {
  await page.goto('/privacidade.html');
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('tb.seenHome', '1');
    // comprou Coca-Cola há 31 dias (guardado só no aparelho)
    localStorage.setItem('tb.receipts', JSON.stringify([{ key: 'r1', at: new Date(Date.now() - 31 * 864e5).toISOString(), items: [{ name: 'COCA', pid: 35, qty: 1, unit_price: 9 }] }]));
  });
  const errs = await ofertas(page);
  await expect(page.locator('#adRestock .ad--prod')).toContainText('Hora de repor');
  await page.fill('#searchInput', 'café');
  await expect(page.locator('#productGrid > .ad--prod').first()).toContainText('Para quem procura');
  await page.fill('#searchInput', 'ninho');
  await page.locator('[data-add="9"]').first().evaluate((b) => b.click());
  await expect(page.locator('.ad-nudge .ad--prod')).toBeVisible();
  await page.locator('.ad-nudge [data-ad-swap]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tb.list')).map((x) => x[0]))).toEqual([24]);
  expect(errs).toEqual([]);
});

test('portal: pedir anúncio de busca patrocinada de um produto', async ({ page }) => {
  const errs = await open(page, '/parceiros.html');
  await page.click('[data-demo]');
  await page.goto('/parceiros.html#publicidade');
  await page.locator('input[name=slot][value=busca]').check({ force: true });
  await page.locator('select[name=product]').selectOption({ index: 1 });
  await page.fill('textarea[name=body]', 'Com preço de atacado até domingo.');
  await page.fill('input[name=keywords]', 'cafe, expresso');
  await page.locator('#adForm button.btn--primary').click();
  await expect(page.locator('#adList')).toContainText('publicidade inteligente', { timeout: 15_000 });
  expect(errs).toEqual([]);
});

// ---------------------------------------------------------------- dono do mercado
test('portal: resumo da semana, radar, minhas lojas, faltas e minha página', async ({ page }) => {
  const errs = await open(page, '/parceiros.html');
  await page.click('[data-demo]');
  await page.goto('/parceiros.html#resumo');
  await expect(page.locator('.tg-msg')).toContainText('clientes vieram pelo site', { timeout: 15_000 });
  await page.goto('/parceiros.html#radar');
  await expect(page.locator('[data-rd-match]').first()).toBeVisible();
  await page.goto('/parceiros.html#lojas');
  await expect(page.locator('.ls-card').first()).toBeVisible();
  await page.goto('/parceiros.html#faltas');
  await page.locator('[data-ft-ok]').first().click();
  await expect(page.locator('.toast').last()).toContainText('reposto');
  await page.goto('/parceiros.html#pagina');
  await page.locator('[name=svc][value=wifi]').check();
  await page.locator('#pgForm .btn--primary').click();
  await expect(page.locator('.toast').last()).toContainText('Página salva');
  expect(errs).toEqual([]);
});

test('site: diferenciais na página da rede e "não achei na loja"', async ({ page }) => {
  const errs = await open(page, '/mercado.html?m=nova-era');
  await expect(page.locator('.svc--lg')).toContainText('Açougue', { timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem('tb.seenHome', '1'));
  await ofertas(page);
  await page.locator('.card').first().click();
  await page.locator('[data-missing]').click();
  await page.locator('[data-falta-send]').click();
  await expect(page.locator('.toast').last()).toContainText('Obrigado');
  expect(errs).toEqual([]);
});
