# Tá Barato Mesmo?

Comparador de preços de supermercados de Manaus: Nova Era, Supermercados DB, Veneza, Baratão da Carne e Coema.

- Mostra primeiro o **menor preço** de cada produto, com as logomarcas e o preço de todos os mercados no mesmo card.
- Usa a **localização** do usuário (ou o bairro escolhido) para indicar o mercado mais perto e a distância de cada loja.
- Abas **Mais baratos**, **Baixaram**, **Subiram** (variação dos últimos 7 dias) e **Maior economia**.
- Detalhe do produto com barras comparativas, histórico de 7/15/30 dias e rota até a loja.
- **Lista de compras** com o total em cada mercado e a combinação mais barata.
- **Mapa** das lojas (Leaflet + OpenStreetMap).
- **Cadastro em duas etapas**: o cadastro rápido (nome, e-mail, senha) libera 15 comparações; o cadastro completo (celular, nascimento, bairro, mercados preferidos) libera uso sem limite. Sem cadastro: 3 comparações.
- Usuários podem informar preços vistos na loja (`price_reports`, para moderação).
- PWA: instalável no Android e no iOS ("Adicionar à tela de início").

Stack: HTML, CSS e JavaScript puros (ES modules, sem build) + Supabase (Postgres, Auth, Realtime).

## Como colocar no ar

### 1. Banco (uma vez)
1. Abra o projeto no Supabase → **SQL Editor** → **New query**.
2. Cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   Ele cria tabelas, view, funções, políticas RLS, liga o Realtime em `prices` e insere dados iniciais.
3. Em **Authentication → URL Configuration**, defina o **Site URL** com o endereço onde o site vai rodar
   (ex.: `https://hfa90.github.io/tabaratomesmo/`). Isso é usado nos links de confirmação de e-mail.
4. Para um cadastro realmente instantâneo, você pode desligar **Confirm email** em
   Authentication → Providers → Email. Com ele ligado, o usuário confirma pelo e-mail antes de entrar.

Enquanto o schema não estiver aplicado, o site funciona em **modo demonstração** (faixa amarela no topo) com os mesmos dados do seed.

### 2. Logomarcas oficiais
Coloque os arquivos em `assets/logos/` com estes nomes (PNG ou troque a extensão na coluna `logo_url`):

| Supermercado | Arquivo |
|---|---|
| Nova Era | `assets/logos/nova-era.png` |
| Supermercados DB | `assets/logos/db.png` |
| Veneza | `assets/logos/veneza.png` |
| Baratão da Carne | `assets/logos/baratao-da-carne.png` |
| Coema | `assets/logos/coema.png` |

Use imagens quadradas (ex.: 256×256, fundo branco ou transparente). Enquanto o arquivo não existir, aparece um monograma com a cor da rede.
As cores ficam na coluna `supermarkets.color` e podem ser ajustadas para as cores oficiais de cada marca.

### 3. Lojas e preços reais
- `stores`: as coordenadas do seed são **aproximadas** (`approx = true`, aparecem com `*`). Atualize `lat`, `lng`, `address` e mude `approx` para `false`.
- `prices`: cada coleta é uma linha nova (`product_id`, `supermarket_id`, `price`, `collected_at`). A view `v_products` calcula o preço atual e a variação de 7 dias sozinha.
- `price_reports`: preços enviados pelos usuários, com `status` pendente/aprovado/rejeitado.

### 4. Publicar (GitHub Pages)
Settings → Pages → Branch `main` / pasta `/ (root)`. O arquivo `.nojekyll` já está no repositório.

## Rodar localmente
```bash
python -m http.server 8080
# abra http://localhost:8080
```
A geolocalização do navegador só funciona em `https://` ou `localhost`.

## Estrutura
```
index.html            páginas (ofertas, mapa, lista, conta) e sheets
css/styles.css        estilos, mobile first, tema claro/escuro
js/config.js          URL/anon key do Supabase, limites de comparação, bairros
js/api.js             acesso ao Supabase + modo demonstração
js/app.js             interface, localização, cadastro, lista, mapa
js/chart.js           gráfico de histórico em SVG
js/demo-data.js       dados de demonstração (gerados do seed)
supabase/schema.sql   banco completo
sw.js, manifest.webmanifest   PWA
```

## Segurança
A anon key é pública por design; o que protege os dados são as políticas RLS. O contador de comparações e a conclusão do cadastro só mudam pelas funções `register_comparison()` e `complete_profile()` (um trigger bloqueia alteração direta pelo REST). Nunca coloque a `service_role` key no front-end.
