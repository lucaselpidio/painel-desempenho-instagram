# Relatório Instagram — framework de visualização

Relatório/dashboard reutilizável de desempenho no Instagram, alimentado pelos exports CSV do **Meta Business Suite**.
HTML + CSS + JavaScript puro: **sem dependências e sem build**. Os arquivos são processados no navegador. O único servidor é o opcional `servidor/hub-relatorios.js`, necessário só para enviar o PDF ao Hub de Relatórios (ele guarda o segredo da API).

Passo a passo para quem usa o relatório no dia a dia: [guia.md](guia.md). Detalhes do PDF e do envio ao Hub: [EXPORTAR-PDF.md](EXPORTAR-PDF.md). Histórico de versões: [CHANGELOG.md](CHANGELOG.md).

## Uso rápido

1. Abra `index.html` no navegador (funciona via `file://` ou servido por qualquer servidor estático). Para **enviar o PDF ao Hub de Relatórios**, abra pelo servidor do projeto: `node servidor/hub-relatorios.js` e depois `http://127.0.0.1:8080/` (veja o [guia.md](guia.md)).
2. Clique em **Carregar exports** ou arraste os CSVs para a página. Pode enviar vários de uma vez.
3. Para atualizar o relatório, basta enviar novos exports. Os dados se somam aos que já estão carregados.

| Export | Onde gerar | Exemplo de nome |
|---|---|---|
| Conteúdos (posts do feed) | Insights → Conteúdo → Exportar dados | `Jul-03-2026_Sep-30-2026_1874902543921230.csv` |
| Conteúdos (stories) | O mesmo export de conteúdos, com o tipo filtrado para Stories | `Jul-01-2026_Sep-30-2026_1832914247699087.csv` |
| Público | Insights → Público → Exportar | `Público.csv` |

O tipo de cada arquivo é detectado **pelo conteúdo**, e não pelo nome. Cabeçalhos em português e em inglês são aceitos.

## Estrutura

```
relatorio-instagram/
├── index.html              Página e marcação das seções
├── guia.md                 Passo a passo de uso (exportar e enviar ao Hub)
├── EXPORTAR-PDF.md         Como o PDF é gerado e enviado ao Hub de Relatórios
├── CHANGELOG.md            Histórico de versões
├── assets/css/tokens.css   ← identidade visual (cores, fonte, raios). Troque aqui.
├── assets/css/dashboard.css Layout e componentes (prefixo .igr-)
├── assets/js/
│   ├── parsers.js    Leitura dos CSVs (encoding, separador, colunas PT/EN, datas)
│   ├── metrics.js    Cálculos, agregações, séries dos gráficos de evolução e formatação pt-BR
│   ├── insights.js   Leituras automáticas (regras determinísticas)
│   ├── charts.js     Gráficos SVG (colunas, barras, linhas…), tooltip, tabelas
│   ├── hub-config.js Endereço do envio ao Hub, tipo do relatório e cliente fixo (sem segredo)
│   └── app.js        Estado, filtros, renderização das seções, envio ao Hub e API pública
└── servidor/
    └── hub-relatorios.js Serve o relatório e repassa o PDF à API do Hub com o segredo (Node 18+)
tests/
├── index.html      Executor dos testes (abre o index.html real em iframes)
├── testes.js       Cenários de teste
├── teste-evolucao.node.js  Lógica do gráfico de evolução (node tests/teste-evolucao.node.js)
├── teste-linhas.node.js    Desenho do gráfico de linhas (node tests/teste-linhas.node.js)
├── teste-evolucao-limites.node.js  Casos-limite do gráfico: datas, fusos, dados estranhos, valores extremos
└── fixtures/       Exports FICTÍCIOS (feed, stories e público), no formato real do Meta
```

Os scripts devem ser carregados **nesta ordem**. Todos são scripts clássicos com o namespace global `window.IGR`, sem módulos ES, para funcionar também via `file://`.

## Como funciona

```
 arquivos CSV ──► parsers.js ──► arquivos carregados ──► buildDataset() ──► buildModel() ──► render*()
 (File ou texto)  detecta tipo    (state.files; salvos     une exports,       aplica filtros,   uma função
                  e encoding,     no navegador se          separa dona ×      calcula métricas  por seção
                  lê colunas      persist = true)          collabs e          (metrics.js) e    (app.js)
                                                           feed × stories     leituras
                                                                              (insights.js)
```

- **Tudo é recalculado a cada mudança.** Carregar um arquivo, trocar um filtro ou a dona chama `render()`, que reconstrói o modelo e redesenha as seções. Não há estado parcial a sincronizar.
- **`buildDataset()`** junta todos os arquivos (sem filtros): posts da dona no feed, stories da dona, collabs de terceiros, contas encontradas e o período coberto.
- **`buildModel()`** aplica período e formato e devolve o modelo que as seções usam. É o mesmo objeto que `IGR.app.getModel()` retorna.
- **Gráficos** (`charts.js`) são SVG gerados no navegador. Eles medem a largura do container e se redesenham ao redimensionar.

## O que o relatório mostra

1. **Resumo executivo**: leituras automáticas (destaques, oportunidades, pontos de atenção) e indicadores com variação frente ao período anterior. Com stories carregados, os indicadores abrem com a **visão geral feed + stories** (visualizações totais e a divisão entre os canais), seguida de blocos separados para Feed e Stories. Sem stories, mostra só o feed. Fecha com o gráfico de **Evolução**: uma linha por dia ou por semana para a métrica escolhida nos botões (visualizações, alcance, interações, curtidas, comentários, compartilhamentos, salvamentos, taxa de engajamento, visitas ao perfil, novos seguidores, seguidores e publicações), com a linha cinza do período anterior quando há um período selecionado no filtro. Métricas de posts e stories são somadas pelo dia de publicação, porque os exports trazem o total de cada publicação e não o dia a dia.
2. **O que as pessoas viram** (feed): ranking de posts (ordenável por métrica, maiores ou menores), visualizações por post com a linha de mediana, visualizações por semana e revisualização (visualizações ÷ alcance). Fecha com o gráfico **Evolução do feed**, só com métricas dos posts do feed (respeita o filtro de formato).
3. **Formatos e interações no feed**: desempenho médio e participação de cada formato (quando o feed tem dois ou mais formatos; com um só, a seção avisa e mostra só as interações) e composição das interações.
4. **Temas e características**: termos das legendas mais vistas, hashtags, duração dos vídeos e tamanho da legenda.
5. **Calendário do feed**: mapa de calor dia × horário, média por dia da semana e frequência semanal.
6. **Stories** (seção própria, fora dos números do feed): totais do período, stories por dia, alcance por story conforme o volume do dia, respostas e figurinhas, contas mais mencionadas (@), mapa dia × horário, stories de destaque e a tabela completa. Só aparece quando há stories nos exports. Fecha com o gráfico **Evolução dos stories**, com métricas próprias: alcance por story, respostas, toques em figurinhas, cliques no link, navegação e stories publicados.
7. **Público**: total de seguidores do perfil (informado à mão, porque os exports não trazem esse número) com o crescimento estimado no período, novos seguidores por dia (com marcação dos dias com publicação), pirâmide idade × gênero, cidades e países.
8. **Colaborações**: posts de outras contas em que a dona entrou como colaboradora (collab), fora dos totais. Mostra a comparação com os posts próprios, os parceiros e as collabs mais vistas. A seção só aparece quando há collabs.
9. **Base completa**: tabela dos posts do feed, pesquisável e ordenável, com download do CSV consolidado (`;` e decimal com vírgula, pronto para o Excel).
10. **Metodologia e glossário**.

O filtro de período vale para todas as seções. O filtro de formato só aparece quando o feed da dona tem dois ou mais formatos, e vale só para o feed. Todo gráfico tem o botão **Ver tabela**, que mostra os mesmos dados em forma de tabela. **Exportar PDF** usa a impressão do navegador, já com layout próprio para impressão, e em seguida envia uma cópia do PDF ao Hub de Relatórios com o nome do campo **"Nome da cliente no Hub"** (ao lado do botão). Detalhes em [EXPORTAR-PDF.md](EXPORTAR-PDF.md).

## Integração na ferramenta

### Dona da conta (obrigatório na integração)
O export de conteúdos também traz **collabs de terceiros**: posts criados por outra conta em que a dona aceitou aparecer como colaboradora. Eles vêm com o @ de quem criou o post. Para separá-los, a ferramenta deve informar o @ da dona:

```js
IGR.app.init(el, { owner: 'clara.nutri.demo' });   // aceita com ou sem "@"
// ou, no HTML: <div class="igr" data-igr-root data-igr-owner="clara.nutri.demo">
IGR.app.setOwner('outracliente');              // troca de cliente sem recarregar
```

- Posts da dona formam o relatório. Posts de outras contas vão para a seção **Colaborações**, fora dos totais.
- Se o @ informado não aparecer em nenhum post, o relatório mostra um aviso no topo.
- Sem `owner` (o `index.html` aberto sozinho), a dona passa a ser a conta com mais posts, e aparece o seletor **Dona da conta** para corrigir. Dentro da ferramenta, com `owner` informado, o seletor fica oculto.
- Ao trocar de cliente, use `persist: false` ou chame `IGR.app.clear()`, para não misturar arquivos de clientes diferentes guardados no navegador.

### Opção A: iframe (mais simples)
Hospede a pasta e use `<iframe src="/relatorio-instagram/index.html">`. O iframe não passa o @ da dona sozinho: use a Opção B, ou um `index.html` próprio com `data-igr-owner`.

### Opção B: embutir na página
1. Inclua `tokens.css` e `dashboard.css`. Classes, IDs e variáveis CSS usam o prefixo `igr` (`.igr-*`, `#igr-*`, `--igr-*`, `data-igr-theme`), para não colidir com os tokens da ferramenta. Duas regras globais mexem em `html` e `body` (fundo, fonte e rolagem suave) e podem ser removidas no topo de `dashboard.css` se conflitarem.
2. Copie o bloco `<div class="igr" data-igr-root>…</div>` do `index.html`. Os IDs `igr-*` são usados pelo JS.
3. Inclua os 6 scripts na ordem acima (`hub-config.js` antes de `app.js`).

Para controlar a inicialização manualmente:

```html
<div class="igr" data-igr-root data-igr-autoinit="false">…</div>
<script>
  IGR.app.init(document.querySelector('[data-igr-root]'), { persist: false, owner: 'clara.nutri.demo' });
</script>
```

### O que o relatório espera da página

- **Seções são opcionais.** Qualquer `<section id="igr-sec-…">`, a barra de filtros (`#igr-filters`), a barra de arquivos (`#igr-files`) e o aviso (`#igr-alert`) podem ser removidos do HTML: o relatório simplesmente não desenha o que não existe. Para esconder um item da navegação, remova também o `<a>` correspondente em `.igr-nav`.
- **Obrigatório:** só a raiz `[data-igr-root]`. Se o `<input type="file" id="igr-file-input">` faltar, ele é criado automaticamente.
- **Fora da raiz**, o relatório só insere no `<body>` o tooltip dos gráficos (`.igr-tooltip`) e, por um instante, um link temporário ao baixar o CSV. No primeiro envio ao Hub, insere no `<head>` o script do html2pdf.js (cdnjs), que monta por um instante uma cópia do relatório para gerar o PDF.
- **Armazenamento no navegador** (`localStorage`):
  - `igr:v1:files`: arquivos carregados e filtros (só com `persist: true`);
  - `igr:v1:theme`: tema escolhido no botão;
  - `igr:v1:seguidores`: total de seguidores informado para cada @ (só com `persist: true`);
  - `igr:v1:hub-clientes`: nome da cliente no Hub corrigido para cada @ (só com `persist: true`).
- **Tema:** variáveis, `color-scheme` e o atributo `data-igr-theme` valem só para o relatório; a página hospedeira não é afetada.
- **`init()` pode ser chamado mais de uma vez** na mesma raiz (por exemplo, auto-inicialização + chamada manual): a segunda chamada só atualiza as opções.

### Alimentar os dados por código (ex.: a partir do backend)

```js
// Conteúdo do arquivo já como texto (o nome é usado para inferir o período)
IGR.app.loadText('Jul-03-2026_Sep-30-2026_123.csv', textoDoCsv);

// Ou um ArrayBuffer (o export Público vem em UTF-16)
const texto = IGR.parsers.decodeBuffer(arrayBuffer);
IGR.app.loadText('Público.csv', texto);

// Ou objetos File (input/drag & drop próprios)
await IGR.app.loadFiles(fileList);

IGR.app.clear();              // remove todos os dados
const m = IGR.app.getModel(); // posts filtrados, summary, formats, audience, insights...
```

### API

| Função | Descrição |
|---|---|
| `IGR.app.init(root, { persist, owner, hub })` | Liga a interface. `owner` é o @ da dona da conta. `persist: true` (padrão) guarda os arquivos carregados no `localStorage` do navegador. `hub: { url, tipo, cliente }` substitui o `hub-config.js` (veja [EXPORTAR-PDF.md](EXPORTAR-PDF.md)). Chamar de novo na mesma raiz só atualiza as opções. |
| `IGR.app.setOwner(usuario)` | Troca a dona da conta e re-renderiza. |
| `IGR.app.setFollowers(total, data, usuario)` | Informa o total de seguidores do perfil, que os exports não trazem. `data` (AAAA-MM-DD) é o dia da contagem, e o padrão é hoje. `usuario` tem como padrão a dona atual. Fica guardado por @ em `igr:v1:seguidores`. |
| `IGR.app.loadFiles(files)` | Lê e adiciona arquivos. Retorna uma Promise. |
| `IGR.app.loadText(nome, texto)` | Adiciona um export já lido como texto. Lança erro se o formato não for reconhecido (`loadFiles`, ao contrário, mostra o erro na barra de arquivos). |
| `IGR.app.clear()` | Limpa os dados e o armazenamento local. |
| `IGR.app.getModel()` | Modelo atual: `posts` (feed da dona), `prevPosts`, `stories`, `prevStories`, `storySummary`, `collabs`, `summary`, `collabSummary`, `prevSummary`, `formats`, `audience`, `followers`, `insights`, `range`, `ds.owner`. |
| `IGR.metrics.evolution(entrada, métrica, 'day' \| 'week', escopo)` | Séries dos gráficos de evolução, sem interface. `escopo`: `'all'` (resumo), `'feed'` ou `'stories'`. `IGR.metrics.evolutionMetrics(entrada, escopo)` lista as métricas com dado. |
| `IGR.parsers.parseText(nome, texto)` | Só o parser, sem interface. Retorna `{ kind: 'posts' \| 'audience', … }`. |

### Formato dos dados (`getModel()`)

**Post** (vale para posts do feed, stories e collabs):

| Campo | Conteúdo |
|---|---|
| `id`, `accountId`, `username`, `accountName` | Identificação do post e de quem o criou |
| `description`, `duration` | Legenda/texto e duração em segundos (0 quando não é vídeo) |
| `ts` | Data/hora de publicação em milissegundos, no horário local do export |
| `dateKey`, `weekKey`, `weekday`, `hour`, `band` | `'AAAA-MM-DD'`, segunda-feira da semana, dia da semana (0 = segunda), hora e faixa de horário (`metrics.js → TIME_BANDS`) |
| `type`, `format` | `'reel'`, `'carrossel'`, `'imagem'`, `'video'`, `'story'` ou `'outro'`, e o objeto do formato (`key`, `label`, `single`, `color`) |
| `permalink` | Link do post (só `http`/`https`; vazio se inválido) |
| `views`, `reach`, `likes`, `comments`, `shares`, `saves`, `follows` | Métricas do export (0 quando a coluna não existe) |
| `profileVisits`, `replies`, `stickerTaps`, `navigation`, `linkClicks` | Métricas extras (principalmente de stories) |
| `interactions`, `er`, `shareRate`, `saveRate`, `commentRate`, `followPer1k`, `viewsPerReach` | Calculados: interações (curtidas + comentários + compart. + salv.), taxas sobre o alcance e seguidores a cada mil contas |
| `hashtags`, `captionLength`, `dataComment` | Hashtags da legenda, tamanho da legenda e observação do Meta |

**Modelo:**

| Campo | Conteúdo |
|---|---|
| `posts`, `stories`, `collabs` | Listas já filtradas (período; o formato só filtra `posts`) |
| `prevPosts`, `prevStories` | Posts e stories do período anterior, com os mesmos filtros (vazios quando o filtro é "Todo o período") |
| `summary`, `prevSummary` | Totais do feed no período e no período anterior (`n`, `views`, `reach`, `interactions`, `er`, `avgViews`, `medianViews`…) |
| `storySummary`, `prevStorySummary`, `collabSummary` | Totais de stories e de collabs |
| `formats` | Um resumo por formato do feed |
| `audience`, `followers` | Público (seguidores por dia, idade × gênero, países e cidades em %) e a série de seguidores recortada no período |
| `insights` | Leituras automáticas: `[{ tone, title, text }]` |
| `range` | `{ start, end, prev }` (datas `'AAAA-MM-DD'`) |
| `ds` | Dados sem filtro: `posts`, `stories`, `collabs`, `accounts`, `owner` (`username`, `fixed`, `auto`, `missing`) e `bounds` |

Campos `prev…` ficam `null` quando não há dados carregados para o período anterior.

## Identidade visual

Para aplicar a marca, edite **apenas** `assets/css/tokens.css`:
- `--igr-font-sans`, `--igr-accent*`, `--igr-page`, `--igr-surface-*`, `--igr-text-*` e `--igr-radius*` podem ser trocados livremente;
- `--igr-series-*` e `--igr-seq-*` formam uma paleta validada para daltonismo. A ordem das cores é intencional. Se trocar, mantenha cores distinguíveis entre vizinhas;
- os modos claro e escuro são definidos no mesmo arquivo. O tema segue o sistema e pode ser forçado com `data-igr-theme="light|dark"` no `<html>`.

A cor de cada formato é fixa em todo o relatório: Reels = série 1, Carrosséis = série 2, Imagens = série 3, Vídeos = série 4, Stories = série 5 e Outros = série 6 (`metrics.js → FORMATS`).

## Regras de dados

- **Vários exports**: os posts são unidos pelo ID. Quando o mesmo post aparece em mais de um export, vale a versão com mais visualizações, porque métricas vitalícias só crescem.
- **Export diário** (coluna `Data` com datas em vez de `Total`): a linha `Total` é usada quando existe. Sem ela, as métricas são somadas e o alcance fica com o maior valor, já que alcance não é somável.
- **Datas** do export de posts no formato `MM/DD/AAAA HH:mm`. O formato `DD/MM` é detectado automaticamente quando o dia passa de 12.
- **Público**: a série de seguidores é unida por dia, e o export mais recente prevalece. Idade, gênero, cidades e países vêm do export mais recente (é um retrato na data do export, não varia com o filtro de período).
- O export **Público** é sempre tratado como sendo da dona da conta (ele não traz o ID da conta).
- **Feed × Stories**: posts com tipo "Story" (o Meta exporta os stories num arquivo de conteúdos próprio, com as colunas Respostas, Toques em figurinhas e Navegação) ficam fora de todos os totais, médias e comparações do feed, e são analisados na seção **Stories**. Os dois exports podem ser carregados juntos.
- **Collabs**: a separação é feita pelo @ de quem criou o post. As métricas de uma collab são compartilhadas entre as contas, por isso ficam fora dos totais. Collabs **criadas pela própria dona** não são identificáveis no export e contam como posts próprios.
- **Alcance somado** é a soma do alcance de cada post, e não o número de contas únicas no período.
- Seções desconhecidas no export de público são mantidas: séries diárias viram gráficos de colunas e listas viram gráficos de barras.

## Estender

- **Nova leitura automática**: adicione uma regra em `insights.js → generate()`. Ela deve retornar `{ tone, title, text }`, e trechos entre `**…**` aparecem em destaque.
- **Nova coluna do export**: adicione o alias em `parsers.js → POST_COLUMNS` (e em `METRIC_FIELDS`, se for numérica).
- **Novo card**: siga o padrão `card({...})` + `C.columns/hbars/...` + `.table(...)` das funções `render*` em `app.js`.
- **Nova métrica nos gráficos de evolução**: acrescente um item em `metrics.js → EVOLUTION_METRICS` (resumo), `FEED_EVOLUTION_METRICS` ou `STORY_EVOLUTION_METRICS`, com `key`, `label`, `desc`, `src` e `value(bloco)`. Ela só aparece como opção quando tem dado no período.
- **Nova seção**: crie o `<section id="igr-sec-…">` com uma `<div class="igr-grid">` no `index.html` e uma função `render…(model)` que comece com `const sec = section('igr-sec-…'); if (!sec) return;` (assim a seção continua opcional). Chame-a em `render()`.
- **Depois de mudar o código**, rode os testes (seção abaixo) e, se a mudança for nova, acrescente um cenário em `tests/testes.js`.

## Testes

A pasta `tests/` tem uma página que roda todos os testes no navegador, sem instalar nada. Ela precisa ser servida por HTTP, porque o navegador bloqueia iframes e `fetch` entre arquivos locais:

```
cd relatorio-instagram
node servidor/hub-relatorios.js       # ou: python -m http.server 8000
```

Abra `http://127.0.0.1:8080/tests/` (ou `http://localhost:8000/tests/` com o Python). A página guarda e devolve no fim os dados salvos no navegador (arquivos, totais de seguidores e nomes do Hub), então pode ser rodada no mesmo endereço do relatório. Em alguns segundos a página lista cada verificação, e o título termina em `OK` ou `FALHA`. Os cenários cobrem:
- carga real dos três exports (inclusive o Público em UTF-16);
- dona da conta, collabs e stories;
- filtros;
- variações de arquivo (inglês, `;`, export diário, datas DD/MM);
- segurança (HTML e links maliciosos, fórmulas no CSV);
- dados salvos no navegador;
- isolamento do tema;
- gráficos sem texto cortado no desktop e no celular;
- seções opcionais;
- gráficos de evolução do resumo, do feed e dos stories (métricas, Dia/Semana, comparação, tabela, impressão);
- volume grande.

Também há testes em Node, sem navegador e sem instalar nada, para a lógica e o desenho dos gráficos de evolução:

```
node tests/teste-evolucao.node.js          # séries de cada métrica (resumo, feed e stories)
node tests/teste-linhas.node.js            # desenho do gráfico de linhas
node tests/teste-evolucao-limites.node.js  # casos-limite: datas, fusos, dados estranhos, valores extremos
```

Rode os testes depois de qualquer mudança no código. Os dados de `tests/fixtures` são fictícios.

## Navegadores, segurança e privacidade

- **Navegadores:** pelos recursos usados, funciona a partir do Chrome/Edge 88, Firefox 78 e Safari 14.1. Os testes foram feitos no Microsoft Edge atual (Chromium).
- **Privacidade:** os exports são processados só no navegador e ficam no `localStorage` quando `persist` está ativo. Há só duas chamadas de rede, ambas ao clicar em **Exportar PDF**: o download do html2pdf.js do cdnjs (no primeiro envio) e o envio do PDF com o nome da cliente, o título, a data e o tipo para `servidor/hub-relatorios.js`, que repassa ao Hub de Relatórios. Aberto via `file://` ou sem a `url` configurada, nada é enviado.
- **Segredo do Hub:** fica só na variável de ambiente `HUB_SEGREDO` do servidor; nunca no navegador nem no repositório.
- **Segurança:** textos vindos dos CSVs (legendas, nomes) são inseridos sempre como texto (`textContent`), nunca como HTML. Links só são aceitos se forem `http`/`https`. No CSV exportado, textos que começam com `=`, `+`, `-` ou `@` recebem um apóstrofo, para o Excel não os tratar como fórmula.
