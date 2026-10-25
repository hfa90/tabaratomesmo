// Pratos do dia a dia (Manaus e Brasil) com a quantidade de cada ingrediente POR PESSOA (1 porção de adulto).
// Unidades: g (gramas), ml (mililitros), un (unidades). "busca" é o termo usado para achar o produto no catálogo.
// Fontes de referência: porções usuais de cozinha doméstica (arroz cru ~80 g, feijão cru ~60 g, carne ~150 g).
// [ingrediente, quantidade, unidade, busca?]
const R = (id, nome, alias, tipo, itens) => ({ id, nome, alias, tipo, itens: itens.map(([n, q, u, b]) => ({ n, q, u, b: b || n })) });

export const RECEITAS = [
  // ------------------------------------------------ bases
  R('arroz', 'Arroz branco', ['arroz', 'arroz soltinho'], 'acompanhamento', [['Arroz', 80, 'g', 'arroz tipo 1'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Alho', 2, 'g'], ['Cebola', 10, 'g'], ['Sal', 1, 'g', 'sal refinado']]),
  R('feijao', 'Feijão carioca', ['feijao', 'feijão', 'feijao carioca'], 'acompanhamento', [['Feijão carioca', 60, 'g', 'feijao carioca'], ['Alho', 2, 'g'], ['Cebola', 10, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Sal', 1, 'g', 'sal refinado']]),
  R('feijao-preto', 'Feijão preto', ['feijao preto'], 'acompanhamento', [['Feijão preto', 60, 'g', 'feijao preto'], ['Alho', 2, 'g'], ['Cebola', 10, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Sal', 1, 'g', 'sal refinado']]),
  R('farofa', 'Farofa', ['farofa'], 'acompanhamento', [['Farinha de mandioca', 40, 'g', 'farinha de mandioca'], ['Manteiga', 10, 'g'], ['Cebola', 10, 'g'], ['Ovos', 0.25, 'un', 'ovos']]),
  R('salada', 'Salada simples', ['salada', 'salada verde', 'salada de alface e tomate'], 'acompanhamento', [['Alface', 40, 'g'], ['Tomate', 60, 'g'], ['Cebola', 15, 'g'], ['Azeite', 5, 'ml', 'azeite'], ['Limão', 0.25, 'un', 'limao']]),
  R('pure', 'Purê de batata', ['pure', 'purê', 'pure de batata'], 'acompanhamento', [['Batata', 200, 'g', 'batata inglesa'], ['Leite', 50, 'ml', 'leite uht integral'], ['Manteiga', 10, 'g'], ['Sal', 1, 'g', 'sal refinado']]),
  R('macarrao-alho', 'Macarrão alho e óleo', ['macarrao alho e oleo', 'macarrão alho e óleo'], 'prato', [['Macarrão espaguete', 100, 'g', 'macarrao espaguete'], ['Alho', 6, 'g'], ['Azeite', 15, 'ml', 'azeite'], ['Sal', 1, 'g', 'sal refinado']]),
  R('banana-frita', 'Banana frita', ['banana frita', 'banana pacova frita'], 'acompanhamento', [['Banana pacovã', 1, 'un', 'banana'], ['Óleo de soja', 15, 'ml', 'oleo de soja']]),
  R('macaxeira', 'Macaxeira cozida', ['macaxeira', 'aipim', 'mandioca cozida'], 'acompanhamento', [['Macaxeira', 200, 'g', 'macaxeira'], ['Manteiga', 10, 'g'], ['Sal', 1, 'g', 'sal refinado']]),
  R('vinagrete', 'Vinagrete', ['vinagrete'], 'acompanhamento', [['Tomate', 50, 'g'], ['Cebola', 20, 'g'], ['Pimentão', 15, 'g', 'pimentao'], ['Cheiro-verde', 3, 'g', 'cheiro verde'], ['Vinagre', 10, 'ml'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),

  // ------------------------------------------------ carnes e aves
  R('bife', 'Bife acebolado', ['bife', 'bife acebolado', 'carne'], 'prato', [['Bife (alcatra ou patinho)', 150, 'g', 'carne bovina patinho'], ['Cebola', 50, 'g'], ['Alho', 2, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Sal', 1, 'g', 'sal refinado']]),
  R('carne-moida', 'Carne moída refogada', ['carne moida', 'carne moída'], 'prato', [['Carne moída', 120, 'g', 'carne moida'], ['Cebola', 20, 'g'], ['Tomate', 40, 'g'], ['Alho', 2, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Cheiro-verde', 3, 'g', 'cheiro verde']]),
  R('carne-panela', 'Carne de panela', ['carne de panela', 'carne cozida'], 'prato', [['Acém ou músculo', 180, 'g', 'carne bovina acem'], ['Batata', 100, 'g', 'batata inglesa'], ['Cenoura', 50, 'g'], ['Cebola', 30, 'g'], ['Tomate', 40, 'g'], ['Alho', 3, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('picadinho', 'Picadinho de carne', ['picadinho'], 'prato', [['Patinho em cubos', 150, 'g', 'carne bovina patinho'], ['Batata', 80, 'g', 'batata inglesa'], ['Cenoura', 40, 'g'], ['Cebola', 25, 'g'], ['Tomate', 40, 'g'], ['Alho', 2, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('churrasco', 'Churrasco', ['churrasco', 'picanha'], 'prato', [['Picanha ou fraldinha', 250, 'g', 'picanha'], ['Linguiça toscana', 80, 'g', 'linguica toscana'], ['Sal grosso', 5, 'g', 'sal grosso'], ['Carvão', 300, 'g', 'carvao']]),
  R('frango-assado', 'Frango assado', ['frango assado', 'coxa e sobrecoxa assada', 'frango'], 'prato', [['Coxa e sobrecoxa de frango', 250, 'g', 'coxa sobrecoxa frango'], ['Limão', 0.25, 'un', 'limao'], ['Alho', 3, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Sal', 1, 'g', 'sal refinado']]),
  R('frango-grelhado', 'Frango grelhado', ['frango grelhado', 'peito de frango', 'file de frango'], 'prato', [['Peito de frango', 150, 'g', 'peito de frango'], ['Limão', 0.25, 'un', 'limao'], ['Alho', 2, 'g'], ['Azeite', 5, 'ml', 'azeite'], ['Sal', 1, 'g', 'sal refinado']]),
  R('frango-frito', 'Frango frito', ['frango frito', 'frango a passarinho'], 'prato', [['Frango a passarinho', 250, 'g', 'frango passarinho'], ['Farinha de trigo', 20, 'g', 'farinha de trigo'], ['Óleo de soja', 30, 'ml', 'oleo de soja'], ['Alho', 3, 'g'], ['Limão', 0.25, 'un', 'limao']]),
  R('strogonoff-frango', 'Strogonoff de frango', ['strogonoff', 'estrogonofe', 'strogonoff de frango'], 'prato', [['Peito de frango', 150, 'g', 'peito de frango'], ['Creme de leite', 50, 'g', 'creme de leite'], ['Molho de tomate', 30, 'g', 'molho de tomate'], ['Ketchup', 10, 'g'], ['Mostarda', 5, 'g'], ['Cebola', 20, 'g'], ['Manteiga', 5, 'g'], ['Batata palha', 25, 'g', 'batata palha']]),
  R('strogonoff-carne', 'Strogonoff de carne', ['strogonoff de carne', 'estrogonofe de carne'], 'prato', [['Alcatra em tiras', 150, 'g', 'carne bovina alcatra'], ['Creme de leite', 50, 'g', 'creme de leite'], ['Molho de tomate', 30, 'g', 'molho de tomate'], ['Ketchup', 10, 'g'], ['Mostarda', 5, 'g'], ['Cebola', 20, 'g'], ['Manteiga', 5, 'g'], ['Batata palha', 25, 'g', 'batata palha']]),
  R('linguica', 'Linguiça acebolada', ['linguica', 'linguiça', 'calabresa acebolada'], 'prato', [['Linguiça calabresa', 150, 'g', 'linguica calabresa'], ['Cebola', 50, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('feijoada', 'Feijoada', ['feijoada'], 'prato', [['Feijão preto', 80, 'g', 'feijao preto'], ['Carne seca', 40, 'g', 'charque'], ['Linguiça calabresa', 40, 'g', 'linguica calabresa'], ['Costelinha suína', 50, 'g', 'costela suina'], ['Bacon', 15, 'g'], ['Cebola', 15, 'g'], ['Alho', 3, 'g'], ['Couve', 30, 'g'], ['Laranja', 0.5, 'un', 'laranja']]),
  R('galinhada', 'Galinhada', ['galinhada'], 'prato', [['Arroz', 70, 'g', 'arroz tipo 1'], ['Coxa e sobrecoxa de frango', 200, 'g', 'coxa sobrecoxa frango'], ['Açafrão', 1, 'g', 'acafrao'], ['Cebola', 20, 'g'], ['Tomate', 30, 'g'], ['Milho verde', 20, 'g', 'milho verde lata'], ['Ervilha', 15, 'g', 'ervilha lata'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('arroz-carreteiro', 'Arroz carreteiro', ['arroz carreteiro', 'carreteiro'], 'prato', [['Arroz', 70, 'g', 'arroz tipo 1'], ['Carne seca', 80, 'g', 'charque'], ['Linguiça calabresa', 40, 'g', 'linguica calabresa'], ['Cebola', 20, 'g'], ['Tomate', 30, 'g'], ['Alho', 2, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('baiao', 'Baião de dois', ['baiao de dois', 'baião de dois'], 'prato', [['Arroz', 60, 'g', 'arroz tipo 1'], ['Feijão de corda', 40, 'g', 'feijao de corda'], ['Queijo coalho', 40, 'g', 'queijo coalho'], ['Bacon', 30, 'g'], ['Cebola', 15, 'g'], ['Coentro', 3, 'g'], ['Manteiga', 10, 'g']]),
  R('escondidinho', 'Escondidinho de carne seca', ['escondidinho'], 'prato', [['Macaxeira', 200, 'g', 'macaxeira'], ['Carne seca', 100, 'g', 'charque'], ['Queijo mussarela', 40, 'g', 'queijo mussarela'], ['Manteiga', 10, 'g'], ['Leite', 50, 'ml', 'leite uht integral'], ['Cebola', 20, 'g']]),

  // ------------------------------------------------ peixes (Amazonas)
  R('tambaqui', 'Tambaqui assado', ['tambaqui', 'costela de tambaqui', 'banda de tambaqui'], 'prato', [['Tambaqui', 300, 'g'], ['Limão', 0.5, 'un', 'limao'], ['Alho', 3, 'g'], ['Cebola', 20, 'g'], ['Tomate', 30, 'g'], ['Pimentão', 15, 'g', 'pimentao'], ['Óleo de soja', 5, 'ml', 'oleo de soja'], ['Sal', 2, 'g', 'sal refinado']]),
  R('jaraqui', 'Jaraqui frito', ['jaraqui', 'jaraqui frito'], 'prato', [['Jaraqui', 300, 'g'], ['Farinha de trigo', 20, 'g', 'farinha de trigo'], ['Óleo de soja', 30, 'ml', 'oleo de soja'], ['Limão', 0.5, 'un', 'limao'], ['Sal', 2, 'g', 'sal refinado']]),
  R('peixe-frito', 'Peixe frito (filé)', ['peixe frito', 'file de peixe', 'peixe'], 'prato', [['Filé de peixe', 180, 'g', 'file de peixe'], ['Farinha de trigo', 20, 'g', 'farinha de trigo'], ['Óleo de soja', 25, 'ml', 'oleo de soja'], ['Limão', 0.5, 'un', 'limao']]),
  R('caldeirada', 'Caldeirada de tucunaré', ['caldeirada', 'caldeirada de tucunare', 'caldeirada de peixe'], 'prato', [['Tucunaré', 250, 'g', 'tucunare'], ['Batata', 100, 'g', 'batata inglesa'], ['Cebola', 30, 'g'], ['Tomate', 50, 'g'], ['Pimentão', 20, 'g', 'pimentao'], ['Ovos', 1, 'un', 'ovos'], ['Cheiro-verde', 5, 'g', 'cheiro verde']]),
  R('moqueca', 'Moqueca de peixe', ['moqueca'], 'prato', [['Peixe em postas', 200, 'g', 'file de peixe'], ['Leite de coco', 60, 'ml', 'leite de coco'], ['Azeite de dendê', 10, 'ml', 'azeite de dende'], ['Tomate', 60, 'g'], ['Cebola', 40, 'g'], ['Pimentão', 30, 'g', 'pimentao'], ['Coentro', 3, 'g']]),
  R('pirarucu', 'Pirarucu de casaca', ['pirarucu de casaca', 'pirarucu'], 'prato', [['Pirarucu seco', 120, 'g', 'pirarucu'], ['Banana pacovã', 1, 'un', 'banana'], ['Farinha uarini', 40, 'g', 'farinha de mandioca'], ['Leite de coco', 50, 'ml', 'leite de coco'], ['Ovos', 0.5, 'un', 'ovos'], ['Azeitona', 10, 'g'], ['Cebola', 20, 'g']]),
  R('tacaca', 'Tacacá', ['tacaca', 'tacacá'], 'prato', [['Tucupi', 300, 'ml'], ['Goma de tapioca', 50, 'g', 'goma de tapioca'], ['Jambu', 30, 'g'], ['Camarão seco', 30, 'g', 'camarao seco'], ['Alho', 2, 'g']]),

  // ------------------------------------------------ massas e lanches
  R('bolonhesa', 'Macarrão à bolonhesa', ['macarrao', 'macarrão', 'macarronada', 'espaguete a bolonhesa', 'bolonhesa'], 'prato', [['Macarrão espaguete', 100, 'g', 'macarrao espaguete'], ['Carne moída', 100, 'g', 'carne moida'], ['Molho de tomate', 100, 'g', 'molho de tomate'], ['Cebola', 15, 'g'], ['Alho', 2, 'g'], ['Queijo ralado', 10, 'g', 'queijo ralado'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('lasanha', 'Lasanha à bolonhesa', ['lasanha'], 'prato', [['Massa de lasanha', 70, 'g', 'massa para lasanha'], ['Carne moída', 100, 'g', 'carne moida'], ['Molho de tomate', 100, 'g', 'molho de tomate'], ['Queijo mussarela', 60, 'g', 'queijo mussarela'], ['Presunto', 40, 'g'], ['Leite', 100, 'ml', 'leite uht integral'], ['Manteiga', 10, 'g'], ['Farinha de trigo', 8, 'g', 'farinha de trigo']]),
  R('panqueca', 'Panqueca de carne', ['panqueca'], 'prato', [['Farinha de trigo', 40, 'g', 'farinha de trigo'], ['Leite', 80, 'ml', 'leite uht integral'], ['Ovos', 0.5, 'un', 'ovos'], ['Carne moída', 80, 'g', 'carne moida'], ['Molho de tomate', 60, 'g', 'molho de tomate'], ['Queijo mussarela', 30, 'g', 'queijo mussarela']]),
  R('pizza', 'Pizza caseira', ['pizza'], 'prato', [['Farinha de trigo', 100, 'g', 'farinha de trigo'], ['Fermento biológico', 2, 'g', 'fermento biologico'], ['Molho de tomate', 40, 'g', 'molho de tomate'], ['Queijo mussarela', 70, 'g', 'queijo mussarela'], ['Linguiça calabresa', 40, 'g', 'linguica calabresa'], ['Cebola', 20, 'g'], ['Óleo de soja', 5, 'ml', 'oleo de soja']]),
  R('hamburguer', 'Hambúrguer caseiro', ['hamburguer', 'hambúrguer', 'x-burguer', 'x burguer'], 'lanche', [['Pão de hambúrguer', 1, 'un', 'pao de hamburguer'], ['Carne moída', 150, 'g', 'carne moida'], ['Queijo mussarela', 20, 'g', 'queijo mussarela'], ['Alface', 10, 'g'], ['Tomate', 30, 'g']]),
  R('cachorro-quente', 'Cachorro-quente', ['cachorro quente', 'cachorro-quente', 'hot dog'], 'lanche', [['Pão de cachorro-quente', 1, 'un', 'pao de cachorro quente'], ['Salsicha', 100, 'g'], ['Molho de tomate', 40, 'g', 'molho de tomate'], ['Milho verde', 15, 'g', 'milho verde lata'], ['Batata palha', 15, 'g', 'batata palha'], ['Ketchup', 10, 'g']]),
  R('x-caboquinho', 'X-caboquinho', ['x caboquinho', 'x-caboquinho', 'caboquinho'], 'lanche', [['Pão francês', 1, 'un', 'pao frances'], ['Tucumã', 40, 'g', 'tucuma'], ['Queijo coalho', 50, 'g', 'queijo coalho'], ['Banana pacovã', 0.5, 'un', 'banana'], ['Manteiga', 5, 'g']]),
  R('sopa', 'Sopa de legumes com carne', ['sopa', 'sopa de legumes'], 'prato', [['Batata', 100, 'g', 'batata inglesa'], ['Cenoura', 50, 'g'], ['Abobrinha', 50, 'g'], ['Chuchu', 50, 'g'], ['Cebola', 20, 'g'], ['Macarrão de sopa', 20, 'g', 'macarrao'], ['Músculo', 60, 'g', 'carne bovina musculo']]),
  R('canja', 'Canja de galinha', ['canja'], 'prato', [['Peito de frango', 100, 'g', 'peito de frango'], ['Arroz', 30, 'g', 'arroz tipo 1'], ['Cenoura', 30, 'g'], ['Batata', 50, 'g', 'batata inglesa'], ['Cebola', 15, 'g'], ['Cheiro-verde', 3, 'g', 'cheiro verde']]),

  // ------------------------------------------------ café da manhã e lanches leves
  R('cafe-pao', 'Café com leite e pão com manteiga', ['cafe da manha', 'café da manhã', 'pao com manteiga', 'cafe com leite'], 'cafe', [['Pão francês', 2, 'un', 'pao frances'], ['Manteiga', 10, 'g'], ['Café em pó', 10, 'g', 'cafe em po'], ['Leite', 150, 'ml', 'leite uht integral'], ['Açúcar', 10, 'g', 'acucar cristal']]),
  R('tapioca', 'Tapioca com queijo coalho', ['tapioca'], 'cafe', [['Goma de tapioca', 80, 'g', 'goma de tapioca'], ['Queijo coalho', 40, 'g', 'queijo coalho'], ['Manteiga', 5, 'g']]),
  R('cuscuz', 'Cuscuz com ovo', ['cuscuz'], 'cafe', [['Flocão de milho', 60, 'g', 'flocao de milho'], ['Ovos', 1, 'un', 'ovos'], ['Manteiga', 5, 'g'], ['Sal', 1, 'g', 'sal refinado']]),
  R('ovo-mexido', 'Ovos mexidos', ['ovo mexido', 'ovos mexidos', 'ovo'], 'cafe', [['Ovos', 2, 'un', 'ovos'], ['Manteiga', 5, 'g'], ['Sal', 0.5, 'g', 'sal refinado']]),
  R('omelete', 'Omelete', ['omelete', 'omelete de queijo'], 'cafe', [['Ovos', 2, 'un', 'ovos'], ['Queijo mussarela', 20, 'g', 'queijo mussarela'], ['Presunto', 20, 'g'], ['Tomate', 20, 'g'], ['Cebola', 10, 'g']]),
  R('mingau', 'Mingau de aveia', ['mingau', 'mingau de aveia'], 'cafe', [['Aveia em flocos', 40, 'g', 'aveia'], ['Leite', 200, 'ml', 'leite uht integral'], ['Açúcar', 10, 'g', 'acucar cristal']]),
  R('vitamina', 'Vitamina de banana', ['vitamina', 'vitamina de banana'], 'cafe', [['Banana', 1, 'un', 'banana'], ['Leite', 250, 'ml', 'leite uht integral'], ['Aveia em flocos', 15, 'g', 'aveia'], ['Açúcar', 10, 'g', 'acucar cristal']]),
  R('acai', 'Açaí com farinha', ['acai', 'açaí', 'acai com farinha'], 'cafe', [['Polpa de açaí', 300, 'g', 'acai polpa'], ['Farinha de tapioca', 30, 'g', 'farinha de tapioca'], ['Açúcar', 20, 'g', 'acucar cristal']]),
  R('sanduiche', 'Misto quente', ['misto quente', 'misto', 'sanduiche'], 'cafe', [['Pão de forma', 2, 'un', 'pao de forma'], ['Queijo mussarela', 30, 'g', 'queijo mussarela'], ['Presunto', 30, 'g'], ['Manteiga', 5, 'g']]),
  R('frutas', 'Frutas (banana e mamão)', ['frutas', 'fruta'], 'cafe', [['Banana', 1, 'un', 'banana'], ['Mamão', 150, 'g', 'mamao']]),
];

/** refeições prontas (vários pratos) para o atalho */
export const COMBOS = [
  { nome: 'Arroz, feijão e bife', pratos: ['arroz', 'feijao', 'bife', 'salada'] },
  { nome: 'Arroz, feijão e frango', pratos: ['arroz', 'feijao', 'frango-assado', 'salada'] },
  { nome: 'Feijoada completa', pratos: ['feijoada', 'arroz', 'farofa'] },
  { nome: 'Tambaqui com baião', pratos: ['tambaqui', 'baiao', 'vinagrete'] },
  { nome: 'Strogonoff', pratos: ['strogonoff-frango', 'arroz'] },
  { nome: 'Macarronada', pratos: ['bolonhesa', 'salada'] },
  { nome: 'Peixe frito com macaxeira', pratos: ['jaraqui', 'macaxeira', 'vinagrete'] },
  { nome: 'Café da manhã', pratos: ['cafe-pao', 'frutas'] },
  { nome: 'Tapioca e café', pratos: ['tapioca', 'cafe-pao'] },
  { nome: 'X-caboquinho e café', pratos: ['x-caboquinho', 'cafe-pao'] },
];
