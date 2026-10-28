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
