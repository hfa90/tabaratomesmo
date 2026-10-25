// Configuração pública do projeto.
// A anon key é pública por natureza: a segurança vem das políticas RLS do schema.sql.
export const CONFIG = {
  SUPABASE_URL: 'https://lygqyliiebcxwxioxbvd.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5Z3F5bGlpZWJjeHd4aW94YnZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NDUyOTIsImV4cCI6MjEwNzUyMTI5Mn0.U5B6Z4zugyfX7bIJYagBE5EcUESZdxRHkvUoI6TeIdo',

  // Comparações (abrir o detalhe de um produto) sem cadastro
  ANON_COMPARISONS: 10,
  // Com cadastro rápido, até concluir o cadastro completo (mesmo valor da função SQL)
  QUICK_COMPARISONS: 15,

  // Centro de Manaus — usado até o usuário informar a localização
  DEFAULT_POS: { lat: -3.1019, lng: -60.025, label: 'Manaus' },

  // Se o banco não responder (ex.: schema ainda não aplicado), usa dados de demonstração
  DEMO_FALLBACK: true,
};

// Zonas administrativas de Manaus (mesma tabela public.bairros do banco)
const ZONES = {"Adrianópolis": "Centro-Sul", "Aleixo": "Centro-Sul", "Alvorada": "Centro-Oeste", "Cachoeirinha": "Sul", "Centro": "Sul", "Chapada": "Centro-Sul", "Cidade de Deus": "Norte", "Cidade Nova": "Norte", "Compensa": "Oeste", "Coroado": "Leste", "Dom Pedro": "Centro-Oeste", "Educandos": "Sul", "Flores": "Centro-Sul", "Gilberto Mestrinho": "Leste", "Japiim": "Sul", "Jorge Teixeira": "Leste", "Lago Azul": "Norte", "Novo Aleixo": "Norte", "Novo Israel": "Norte", "Parque 10 de Novembro": "Centro-Sul", "Petrópolis": "Sul", "Planalto": "Centro-Oeste", "Ponta Negra": "Oeste", "Redenção": "Centro-Oeste", "Santo Antônio": "Oeste", "São José Operário": "Leste", "Tarumã": "Oeste", "Zumbi dos Palmares": "Leste"};
export const ZONE_NAMES = ['Norte', 'Sul', 'Leste', 'Oeste', 'Centro-Sul', 'Centro-Oeste'];

// Bairros para quem não quer liberar o GPS (coordenadas aproximadas do centro do bairro)
export const BAIRROS = [
  ['Adrianópolis', -3.1010, -60.0120], ['Aleixo', -3.0900, -59.9950],
  ['Alvorada', -3.0820, -60.0430], ['Cachoeirinha', -3.1180, -60.0110],
  ['Centro', -3.1316, -60.0233], ['Chapada', -3.0960, -60.0270],
  ['Cidade de Deus', -3.0280, -59.9560], ['Cidade Nova', -3.0360, -59.9880],
  ['Compensa', -3.1070, -60.0560], ['Coroado', -3.0950, -59.9850],
  ['Dom Pedro', -3.0880, -60.0350], ['Educandos', -3.1400, -60.0100],
  ['Flores', -3.0730, -60.0150], ['Gilberto Mestrinho', -3.0700, -59.9300],
  ['Japiim', -3.1180, -59.9850], ['Jorge Teixeira', -3.0430, -59.9330],
  ['Lago Azul', -3.0050, -60.0350], ['Novo Aleixo', -3.0570, -59.9700],
  ['Novo Israel', -3.0450, -60.0250], ['Parque 10 de Novembro', -3.0870, -60.0130],
  ['Petrópolis', -3.1140, -59.9930], ['Planalto', -3.0700, -60.0450],
  ['Ponta Negra', -3.0700, -60.0950], ['Redenção', -3.0670, -60.0500],
  ['Santo Antônio', -3.1270, -60.0500], ['São José Operário', -3.0820, -59.9420],
  ['Tarumã', -3.0300, -60.0700], ['Zumbi dos Palmares', -3.0880, -59.9520],
].map(([name, lat, lng]) => ({ name, lat, lng, zone: ZONES[name] }));
