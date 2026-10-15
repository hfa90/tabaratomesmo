# Tá Barato Mesmo?

Comparador de preços de supermercados de Manaus: Nova Era, Supermercados DB, Veneza, Baratão da Carne e Coema.

- Mostra primeiro o **menor preço** de cada produto, com as logomarcas e o preço de todos os mercados no mesmo card.
- Usa a **localização** do usuário (ou o bairro escolhido) para indicar o mercado mais perto e a distância de cada loja.
- Abas **Mais baratos**, **Baixaram**, **Subiram** (variação dos últimos 7 dias) e **Maior economia**.
- Detalhe do produto com barras comparativas, histórico de 7/15/30 dias e rota até a loja.
- **Rancho do mês**: lista mensal (com atalho "cesta básica", busca para adicionar e caixinhas para marcar no mercado). Ao concluir, o relatório mostra:
  - em qual supermercado o rancho inteiro sai mais barato e quanto você economiza em relação ao mercado mais perto de casa;
  - distância de casa, tempo e custo de deslocamento (carro, moto, ônibus, aplicativo ou a pé, com valores editáveis) e se **vale a pena** ir mais longe;
  - se dividir a compra entre 2 mercados numa volta só compensa;
  - **melhores dias da semana para comprar proteínas**, por produto e mercado (view `v_protein_weekday`).
- **Colaboração de preços** (usuários informam o que viram na prateleira):
  - "R$ ?" nos cards onde nenhum preço foi informado, e o **preço misterioso da semana**;
  - aviso **"Você está no mercado X?"** quando o GPS indica que a pessoa está numa loja (pontos extras);
  - modo **Conferir preços**: 6 produtos mais desatualizados ou mais procurados, com "Está igual" em um toque;
  - pontos (10 a 30 por preço), níveis (Novato do rancho → Lenda do encarte), **ranking do bairro** e "seus preços ajudam N pessoas";
  - cada preço informado libera +2 comparações para quem está no cadastro rápido;
  - um preço entra no site quando **duas pessoas confirmam o mesmo valor (±3%) em 48 h**, ou quando alguém confiável (3+ envios aprovados) informa estando na loja. Valores muito fora do último preço são recusados e há limite de 60 envios por dia.
- **Mapa** das lojas (Leaflet + OpenStreetMap).
- **Carrinho por voz** (aba do meio, com microfone): a pessoa fala o item como falaria no mercado ("Nescau 370 gramas 9 e 49", "duas caixas de leite a 5,49", "meio quilo de carne moída 19,90") e o site anota, soma e compara com o orçamento. O leitor da frase (`js/voice.js`) não usa IA: entende números por extenso, preço ("12 e 50", "R$ 12,50", "12 reais e 50 centavos"), tamanho ("500 gramas", "1 quilo e meio") e quantidade, e acha o produto mesmo com erros do reconhecedor ("nescal") ou só pela marca ("toddy" → achocolatado). Se o preço difere do site, se o tamanho é outro ou se o produto não existe, abre a câmera para a pessoa fotografar a etiqueta; a foto vai para a moderação no admin.
- **Boas-vindas na loja**: com a localização liberada e o site aberto, o GPS do celular é comparado com as coordenadas das lojas. Ao chegar (precisão boa, parado ou a pé, 2 leituras seguidas dentro do raio), abre um popup com as boas-vindas da loja, as ofertas que valem a pena ali, quanto o rancho sai nela e atalhos para o carrinho e para conferir preços. Uma vez por loja por dia; o raio (padrão 150 m) e a função ficam em Administração › Configurações. Depende das coordenadas corretas das lojas (Administração › Supermercados › Lojas).
- **Na fila do caixa** (`#fila`): cronômetro, total do carrinho para conferir antes de pagar, o jogo "Tá barato ou tá caro?" com preços reais, uma curiosidade do dia e "confira 3 preços desta loja".
- **Publicidade em formato de curiosidade**: o anúncio mostra uma pergunta e a imagem desfocada; a oferta só aparece quando a pessoa toca em "Descobrir". Um anúncio por espaço, sem pop-up, com "Ocultar" por 7 dias. Espaços: destaque da página inicial, entre os produtos, Rancho do mês, Carrinho e Fila do caixa. Planos (editáveis no admin): Relâmpago 6 h R$ 39, Diário R$ 89, Fim de semana R$ 199, Semanal R$ 389, Mensal R$ 1.190, multiplicados pelo espaço (página inicial ×1,5, carrinho ×1,3, rancho ×1,2, entre os produtos ×1, fila ×0,8). O supermercado pede e agenda no portal; o administrador aprova, marca como pago e a campanha entra no ar sozinha.
- **Ajudantes do mercado** (página inicial e carrinho): quatro botões grandes, com figuras e quase nada de texto, para usar na frente da prateleira.
  - **📷 Ler código** (`js/scanner.js`): aponta a câmera para o código de barras e aparece um rosto (😀 aqui é o mais barato / 😬 em outro mercado é mais barato), o preço daqui, o menor preço e o preço por quilo. Usa o `BarcodeDetector` do navegador (Android) e, no iPhone, a biblioteca ZXing; confere o dígito verificador para não aceitar leitura torta, tem lanterna quando o celular permite e campo para digitar os números. Código desconhecido: sugere o nome pela base aberta Open Food Facts e a pessoa escolhe o produto ("me ensina: qual é?"); o aparelho já passa a reconhecer, e quando duas pessoas diferentes indicam o mesmo produto o EAN é gravado em `products.ean` (tabela `ean_suggestions`). "Pôr no carrinho" leva o item direto.
  - **⚖️ Qual compensa?** (`js/unitprice.js`): dois pacotes, A e B, com preço e tamanho (g, kg, ml, L, un); a coroa 👑 vai para o que sai mais barato por quilo/litro/unidade. Os cards e o detalhe do produto mostram o preço por kg/L quando o tamanho não é 1, e o detalhe lista os outros tamanhos do mesmo produto do que compensa mais para o que compensa menos.
  - **🏷️ Promoção vale?**: escolhe o tipo (leve 3 pague 2, 2ª unidade com desconto, preço de atacado a partir de N unidades, de/por) e mostra quanto sai cada um, quanto economiza e se outro mercado tem mais barato mesmo sem promoção. O carrinho por voz também entende "leve 3 pague 2" e "a segunda sai pela metade".
  - **🗺️ Caminho no mercado** (Rancho › No mercado): a lista vira uma trilha de paradas na ordem de uma volta só (frutas e verduras → mercearia → bebidas → limpeza → higiene → frios → açougue → congelados por último), com "Agora vá para…" e o avanço automático para a próxima parada. A ordem pode ser ajustada por mercado ("Mudar a ordem") e fica salva no aparelho.
- **Funciona sem internet dentro do mercado** (`js/offline.js`, `sw.js`): o catálogo, os descontos e as configurações ficam salvos no aparelho a cada abertura; sem sinal, o site abre com os preços salvos e mostra uma faixa "Sem internet… preços salvos em 15/10, 18:32". Preços informados, fotos de etiqueta, códigos ensinados e eventos de uso ficam numa fila (IndexedDB) e são enviados sozinhos quando a internet volta. As bibliotecas de CDN (Supabase, leitor de código, mapa) também ficam guardadas.
- **🧾 Conferir a nota do caixa** (`js/cupom.js` + função `supabase/functions/nfce`): depois de pagar, a pessoa lê o QR da NFC-e (Carrinho › Conferir a nota, no fim da compra ou na Fila do caixa). O app busca os itens na Sefaz e compara com o preço da etiqueta anotado no carrinho: 😀 "O caixa cobrou certinho!" ou 😬 "1 item passou mais caro: R$ 0,50 a mais", com o aviso de que vale o menor preço (Lei 10.962/2004). Mostra itens do carrinho que não aparecem na nota e permite mandar os preços reais da nota para o site (com pontos).
- **💳 Dias de desconto** (`js/deals.js`, tabela `market_deals`): os mercados cadastram no portal (aba Descontos) descontos que se repetem, por dia da semana, seção da loja e forma de pagamento ("Terça do Hortifrúti", "5% no Pix"). O site mostra a semana na página inicial, avisa no detalhe do produto ("terça no Nova Era: 15% off, R$ 4,94") e o relatório do Rancho calcula o **melhor dia para ir**.
- **Página Você**: quanto a pessoa já economizou (total, por mês e projeção), o supermercado onde mais compra, histórico dos ranchos, conquistas, fiscal do preço e dados da conta. Funciona até sem conta (guarda no aparelho).
- **Área do supermercado** (`parceiros.html`): cada mercado cadastra, edita e remove produtos, envia fotos reais, cria promoções **exclusivas do site** (com código para o caixa) ou **gerais da loja**, importa produtos em massa pela planilha [`assets/modelo-importacao-tabaratomesmo.xlsx`](assets/modelo-importacao-tabaratomesmo.xlsx) e acompanha métricas: buscas, buscas sem resultado, produtos e marcas mais vistos, ranking de preferência de compra (dia/semana/mês), regiões e bairros, sexo e faixa etária de quem faz o rancho, horários de pico, produtos em que está perdendo clientes e desempenho das promoções.
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

### 1a. Administração master (`admin.html`)
O e-mail `haydenfernandes.ti@gmail.com` já vem cadastrado como administrador master (tabela `platform_admins`). Entre em `admin.html` com a conta do site desse e-mail (se ainda não existir, crie pelo site em "Você › Criar conta"). Na administração você:
- vê métricas de toda a plataforma (usuários, visitantes, buscas, ranchos, economia gerada, regiões, bairros, sexo, idade, horários de pico, produtos e desempenho de cada supermercado);
- cria, edita, ativa, desativa e exclui supermercados e lojas; gera, copia e exclui códigos de convite; suspende, reativa, muda o papel ou exclui o acesso de cada pessoa ao portal;
- bloqueia ou libera usuários, zera comparações, modera preços enviados, desliga produtos e promoções;
- liga e desliga funções do site (envio de preços, promoções, portal dos mercados, coleta de métricas), muda os limites de comparação e publica um aviso no topo do site;
- baixa relatórios em CSV e adiciona ou remove outros administradores. Tudo fica no registro de atividades (`admin_log`).

### 1b. Dar acesso a um supermercado
1. No SQL Editor, gere um código de convite para o mercado (o `id` está na tabela `supermarkets`):
   ```sql
   insert into public.market_invites (supermarket_id) values (5) returning code;
   ```
2. Envie o código ao responsável. Ele abre `parceiros.html`, cria o acesso com e-mail, senha e o código, e já cai no portal.
   Cada código vale 5 acessos por 30 dias (colunas `uses_left` e `expires_at`).

As métricas vêm da tabela `events` (buscas, produtos vistos, itens no rancho, rotas abertas, ranchos concluídos e compras confirmadas), gravada pela função `track()`. Ninguém lê essa tabela direto: o portal recebe só números agregados pela `market_dashboard()`, e dados de bairro, sexo e idade só aparecem em grupos com 5 pessoas ou mais. "Quem está vendendo mais" é uma estimativa de preferência pelo site (compras confirmadas pelos clientes, ranchos que saem mais baratos em cada mercado e rotas abertas), não o faturamento das lojas.

### 1c. Função que lê a nota fiscal (NFC-e)
O navegador não consegue abrir a página da Sefaz direto, então a leitura da nota passa por uma Edge Function do Supabase:
1. No painel do Supabase, abra **Edge Functions › Deploy a new function › Via Editor**.
2. Dê o nome **`nfce`**, apague o exemplo e cole o conteúdo de [`supabase/functions/nfce/index.ts`](supabase/functions/nfce/index.ts).
3. Clique em **Deploy**. Pode deixar "Verify JWT" ligado (o site manda a chave pública).

Pela linha de comando: `supabase functions deploy nfce`. Enquanto a função não existir, o app mostra "Função ainda não instalada" ao ler uma nota; no modo demonstração há uma nota de exemplo.

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
- `price_reports`: preços enviados pelos usuários. A aprovação é automática pelas regras acima; você também pode aprovar manualmente inserindo em `prices` com `source = 'comunidade'`.
- `shopping_lists` / `shopping_list_items`: ranchos mensais dos usuários logados (quem não tem conta guarda a lista só no aparelho).
- O seed simula um dia de oferta de carnes por rede para o quadro de proteínas; com dados reais, o quadro passa a refletir as coletas.

### 4. Publicar (GitHub Pages)
O site já está publicado em https://hfa90.github.io/tabaratomesmo/ a partir da branch `gh-pages` (mantida igual à `main`). O arquivo `.nojekyll` já está no repositório.

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
js/core.js            estado e componentes compartilhados
js/app.js             interface, localização, cadastro, mapa
js/rancho.js          rancho do mês e relatório (distância, vale a pena, proteínas)
js/fiscal.js          colaboração: conferir preços, pontos, níveis, ranking
js/account.js         página Você (economia, mercado preferido, histórico, conquistas)
js/track.js           eventos de uso anônimos para as métricas
parceiros.html        área do supermercado
admin.html            administração master
js/admin.js           administração: métricas, acessos, usuários, moderação, configurações
js/admin-api.js       dados da administração (Supabase ou demonstração)
js/viz.js             barras, indicadores, mapa de calor e exportação CSV
js/voice.js           leitor de frases faladas (preço, tamanho, quantidade) e busca no catálogo
js/carrinho.js        carrinho por voz, orçamento e foto da etiqueta
js/fila.js            modo fila do caixa e o jogo "Tá barato ou tá caro?"
js/ajudantes.js       ajudantes do mercado: central, "qual compensa?" e "promoção vale?"
js/scanner.js         leitor de código de barras
js/unitprice.js       preço por kg/L/unidade e comparação de tamanhos
js/offline.js         cópia do catálogo no aparelho e fila de envios sem internet
js/deals.js           dias e formas de pagamento com desconto
js/cupom.js           conferir a nota do caixa (NFC-e)
supabase/functions/nfce/index.ts   função que lê a página da NFC-e na Sefaz
js/ads.js             anúncios de curiosidade nos espaços do site
js/portal.js          portal: painel, produtos, promoções, importação
js/portal-api.js      dados do portal (Supabase ou demonstração)
css/portal.css        estilos do portal
assets/modelo-importacao-tabaratomesmo.xlsx   planilha modelo de importação
js/chart.js           gráfico de histórico em SVG
js/demo-data.js       dados de demonstração (gerados do seed)
supabase/schema.sql   banco completo
sw.js, manifest.webmanifest   PWA
```

## Segurança
A anon key é pública por design; o que protege os dados são as políticas RLS. O contador de comparações e a conclusão do cadastro só mudam pelas funções `register_comparison()` e `complete_profile()` (um trigger bloqueia alteração direta pelo REST). Nunca coloque a `service_role` key no front-end.
