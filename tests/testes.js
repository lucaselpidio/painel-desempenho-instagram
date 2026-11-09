/* ==========================================================================
   Testes do relatório — rodam no navegador, sem dependências.
   Cada cenário abre o index.html real num iframe, carrega exports fictícios
   (tests/fixtures) e confere o resultado. O título da página termina em
   "OK" ou "FALHA" (útil para rodar em navegador headless).
   ========================================================================== */
(function () {
  'use strict';

  const FIXTURES = {
    feed: 'fixtures/Jul-01-2026_Sep-30-2026_100000000000001.csv',   // 40 posts da dona + 1 collab
    stories: 'fixtures/Jul-01-2026_Sep-30-2026_100000000000002.csv', // 60 stories
    publico: 'fixtures/P%C3%BAblico.csv'                             // UTF-16 LE, como o export real
  };
  const DONA = 'perfil_exemplo';
  const NL = String.fromCharCode(10);

  /* ---------- Infraestrutura ---------- */
  const tbody = document.getElementById('resultados');
  let total = 0, falhas = 0;

  function linha(cls, cols) {
    const tr = document.createElement('tr');
    tr.className = cls;
    cols.forEach((c, i) => {
      const td = document.createElement('td');
      if (cls !== 'grupo') td.className = ['st', 'nome', 'det'][i];
      td.textContent = c;
      if (cls === 'grupo') td.colSpan = 3;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  function check(nome, ok, detalhe) {
    total++;
    if (!ok) falhas++;
    linha(ok ? 'ok' : 'falha', [ok ? 'OK' : 'FALHA', nome, ok ? '' : String(detalhe == null ? '' : detalhe)]);
  }

  const buffers = {};
  async function arquivo(chave) {
    if (!buffers[chave]) {
      const r = await fetch(FIXTURES[chave]);
      if (!r.ok) throw new Error('Não foi possível ler ' + FIXTURES[chave] + ' (a página está sendo servida por HTTP?)');
      buffers[chave] = await r.arrayBuffer();
    }
    return new File([buffers[chave]], decodeURIComponent(FIXTURES[chave].split('/').pop()), { type: 'text/csv' });
  }

  // Abre um index.html novo (largura em px) e devolve o contexto do relatório
  function abrir(largura) {
    return new Promise((resolve, reject) => {
      localStorage.clear(); // o iframe é da mesma origem: começa sem dados salvos
      const antigo = document.getElementById('palco');
      const frame = document.createElement('iframe');
      frame.id = 'palco';
      frame.title = 'Relatório em teste';
      frame.style.width = (largura || 1280) + 'px';
      frame.addEventListener('load', () => {
        const w = frame.contentWindow, doc = frame.contentDocument;
        if (!w.IGR || !w.IGR.app) return reject(new Error('IGR.app não carregou no index.html'));
        const erros = [];
        w.addEventListener('error', e => erros.push(e.message));
        resolve({ w, doc, app: w.IGR.app, root: doc.querySelector('[data-igr-root]'), erros, m: () => w.IGR.app.getModel() });
      });
      frame.addEventListener('error', reject);
      frame.src = '../index.html';
      antigo.replaceWith(frame);
    });
  }
  const iniciar = (ctx, opts) => ctx.app.init(ctx.root, Object.assign({ persist: false }, opts));
  const titulos = ctx => ctx.m().insights.map(i => i.title);
  const visivel = (ctx, sel) => { const el = ctx.doc.querySelector(sel); return !!el && !el.hidden; };

  // Nenhum texto de gráfico pode passar da borda do próprio SVG
  function textosCortados(ctx) {
    return [...ctx.doc.querySelectorAll('.igr-svg')].filter(svg => {
      const w = +svg.getAttribute('width');
      return [...svg.querySelectorAll('text')].some(t => { const b = t.getBBox(); return b.x < -2 || b.x + b.width > w + 2; });
    }).length;
  }

  const cenarios = [];
  const cenario = (nome, fn) => cenarios.push({ nome, fn });

  /* ---------- Cenários ---------- */

  cenario('Carga dos três exports (feed, stories e público em UTF-16)', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
    const m = ctx.m();
    check('40 posts no feed da dona', m.posts.length === 40, m.posts.length);
    check('60 stories separados do feed', m.stories.length === 60, m.stories.length);
    check('1 collab de terceiros fora dos totais', m.collabs.length === 1 && m.collabs[0].username === 'parceira_exemplo', m.collabs.length);
    check('público lido (seguidores, idade/gênero, cidades)', m.audience && m.followers && m.followers.length > 0 && m.audience.ageGender && m.audience.cities.length === 3);
    check('nenhum arquivo com erro', ctx.doc.querySelectorAll('.igr-file.is-error').length === 0);
    const chips = [...ctx.doc.querySelectorAll('.igr-file-detail')].map(e => e.textContent).join(' | ');
    check('chips mostram "41 posts" e "60 stories"', /41 posts/.test(chips) && /60 stories/.test(chips), chips);
    check('seções Stories e Colaborações visíveis', visivel(ctx, '#igr-sec-stories') && visivel(ctx, '#igr-sec-collabs'));
    check('resumo abre com a visão feed + stories', [...ctx.doc.querySelectorAll('.igr-card-title')].some(e => e.textContent.startsWith('Visão geral')));
    check('sem erros de JavaScript', ctx.erros.length === 0, ctx.erros.join(' | '));
  });

  cenario('Dona da conta', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: 'conta_inexistente' });
    await ctx.app.loadFiles([await arquivo('feed')]);
    check('@ que não está nos exports mostra aviso', visivel(ctx, '#igr-alert') && /conta_inexistente/.test(ctx.doc.getElementById('igr-alert').textContent));
    ctx.app.setOwner('@Perfil_Exemplo');
    check('setOwner aceita "@" e maiúsculas', ctx.m().ds.owner.username === DONA && !visivel(ctx, '#igr-alert'));
    check('com dona informada, o seletor fica oculto', ![...ctx.doc.querySelectorAll('.igr-field-label')].some(e => e.textContent === 'Dona da conta'));
    ctx.app.setOwner('');
    check('sem dona informada: escolhe a conta com mais posts', ctx.m().ds.owner.username === DONA && ctx.m().ds.owner.auto === true);
    check('sem dona informada: mostra o seletor', [...ctx.doc.querySelectorAll('.igr-field-label')].some(e => e.textContent === 'Dona da conta'));
  });

  cenario('Só stories + público (sem feed)', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('stories'), await arquivo('publico')]);
    const t = titulos(ctx);
    check('leituras de público e seguidores continuam', t.includes('Quem é o público') && t.includes('Crescimento da base'), t.join(' / '));
    check('sem leituras de feed', !t.includes('Panorama do período') && !t.includes('Leia com cautela'), t.join(' / '));
    check('sem a visão combinada (seria 100% stories)', ![...ctx.doc.querySelectorAll('.igr-card-title')].some(e => e.textContent.startsWith('Visão geral')));
    check('resumo mostra novos seguidores', [...ctx.doc.querySelectorAll('#igr-sec-summary .igr-kpi-label')].some(e => e.textContent === 'Novos seguidores'));
  });

  cenario('Filtros', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed')]);
    const campo = [...ctx.doc.querySelectorAll('.igr-field')].find(f => f.textContent.startsWith('Formato do feed'));
    campo.querySelector('.igr-field-label').click();
    check('clique no rótulo "Formato do feed" não filtra', ctx.m().posts.length === 40, ctx.m().posts.length);
    campo.querySelector('.igr-chip').click();
    check('chip de formato filtra o feed', ctx.m().posts.length > 0 && ctx.m().posts.length < 40, ctx.m().posts.length);
    check('collabs não são afetadas pelo filtro de formato', ctx.m().collabs.length === 1);
    const periodo = () => [...ctx.doc.querySelectorAll('#igr-filters select')].find(s => [...s.options].some(o => o.value === 'custom'));
    let sel = periodo(); sel.value = '30'; sel.dispatchEvent(new Event('change'));
    check('últimos 30 dias reduz o período', ctx.m().range.start > '2026-08-01', JSON.stringify(ctx.m().range));
    sel = periodo(); sel.value = 'custom'; sel.dispatchEvent(new Event('change'));
    let [de] = ctx.doc.querySelectorAll('#igr-filters input[type=date]');
    de.value = '2026-09-15'; de.dispatchEvent(new Event('change'));
    const ate = ctx.doc.querySelectorAll('#igr-filters input[type=date]')[1];
    ate.value = '2026-08-01'; ate.dispatchEvent(new Event('change'));
    const r = ctx.m().range;
    check('"De" depois de "Até" é invertido', r.start === '2026-08-01' && r.end === '2026-09-15', JSON.stringify(r));
  });

  cenario('Leitura de variações de arquivo', async () => {
    const ctx = await abrir();
    const P = ctx.w.IGR.parsers;
    let r = P.parseText('Jul-01-2026_Sep-30-2026_1.csv', ['Post ID,Account username,Description,Publish time,Post type,Date,Views,Reach',
      '1,ana,"Hello",09/18/2026 08:32,IG reel,Lifetime,1000,500'].join(NL));
    check('cabeçalhos em inglês', r.kind === 'posts' && r.posts[0].type === 'reel' && r.posts[0].views === 1000);
    r = P.parseText('x.csv', ['Identificação do post;Descrição;Horário de publicação;Tipo de post;Visualizações',
      '2;"linha 1' + NL + 'linha ""2""; com ;";09/18/2026 08:32;Carrossel do Instagram;1.234'].join(NL));
    check('";" como separador, legenda multilinha com aspas', r.posts[0].description === 'linha 1' + NL + 'linha "2"; com ;', JSON.stringify(r.posts[0].description));
    check('"1.234" vira 1234', r.posts[0].views === 1234, r.posts[0].views);
    r = P.parseText('x.csv', ['Identificação do post,Horário de publicação,Tipo de post,Data,Visualizações,Alcance',
      '3,09/18/2026 08:32,Reel do Instagram,2026-09-18,100,80', '3,09/18/2026 08:32,Reel do Instagram,2026-09-19,50,60'].join(NL));
    check('export diário sem "Total": soma visualizações, usa o maior alcance', r.posts[0].views === 150 && r.posts[0].reach === 80);
    r = P.parseText('x.csv', ['Identificação do post,Horário de publicação,Tipo de post,Visualizações', '4,18/09/2026 08:32,Reel do Instagram,10', '5,05/09/2026 10:00,Reel do Instagram,10'].join(NL));
    const d = new Date(r.posts.find(p => p.id === '5').ts);
    check('datas DD/MM detectadas', d.getDate() === 5 && d.getMonth() === 8, d.toString());
    r = P.parseText('Audience.csv', ['sep=,', '"Followers"', '"Date","Primary"', '"2026-07-03T00:00:00","3"', '"2026-07-04T00:00:00","1"', '', '"Age & gender"', '"","Men","Women"', '"25-34","22.1","19.4"', '', '"Top cities"', '"A, PR","B, SP"', '"54.5","2.8"'].join(NL));
    check('público em inglês', r.kind === 'audience' && r.followers.length === 2 && r.cities[0].value === 54.5 && r.ageGender.genders.join() === 'Men,Women');
    const erro = t => { try { P.parseText('x.csv', t); return ''; } catch (e) { return e.message; } };
    check('arquivo vazio dá erro claro', /não reconhecido/.test(erro('')));
    check('arquivo só com cabeçalho dá erro claro', /Nenhum post/.test(erro('Identificação do post,Visualizações' + NL)));
    check('planilha qualquer dá erro claro', /não reconhecido/.test(erro('a,b,c' + NL + '1,2,3')));
    const txt = 'Identificação do post,Visualizações' + NL + '1,5';
    const buf = new Uint8Array(txt.length * 2);
    for (let i = 0; i < txt.length; i++) { buf[i * 2] = txt.charCodeAt(i) & 255; buf[i * 2 + 1] = txt.charCodeAt(i) >> 8; }
    check('UTF-16 sem BOM é detectado', P.decodeBuffer(buf.buffer) === txt);
  });

  cenario('Segurança (conteúdo malicioso no CSV)', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    const csv = ['Identificação do post,Identificação da conta,Nome de usuário da conta,Nome da conta,Descrição,Horário de publicação,Link permanente,Tipo de post,Visualizações,Alcance,Curtidas',
      '1,1000,perfil_exemplo,Perfil,"<img src=x onerror=window.__xss=1> **negrito** =HYPERLINK(""http://mal"")",09/18/2026 08:32,javascript:window.__xss2=1,Reel do Instagram,500,100,10',
      '2,1000,perfil_exemplo,Perfil,"@parceira obrigada!",09/19/2026 08:32,https://www.instagram.com/p/abc/,Reel do Instagram,400,90,9',
      '3,1000,perfil_exemplo,Perfil,"=1+1",09/20/2026 08:32,https://www.instagram.com/p/def/,Reel do Instagram,300,80,8'].join(NL);
    ctx.app.loadText('Jul-01-2026_Sep-30-2026_1.csv', csv);
    check('HTML das legendas não é executado', !ctx.w.__xss && !ctx.root.querySelector('img'));
    const links = [...ctx.root.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    check('nenhum link "javascript:"', !links.some(h => /^\s*javascript:/i.test(h)), links.join(' '));
    check('links válidos continuam', links.includes('https://www.instagram.com/p/abc/'));
    let blob = null;
    const original = ctx.w.URL.createObjectURL;
    ctx.w.URL.createObjectURL = b => { blob = b; return 'blob:teste'; };
    [...ctx.doc.querySelectorAll('button')].find(b => b.textContent === 'Baixar CSV').click();
    ctx.w.URL.createObjectURL = original;
    const texto = blob ? await blob.text() : '';
    check('CSV: legenda "@..." não vira fórmula no Excel', texto.includes(";'@parceira"));
    check('CSV: legenda "=..." não vira fórmula no Excel', texto.includes(";'=1+1"));
    check('CSV: números continuam números', texto.includes(';500;'));
    check('CSV: link inválido não é exportado', !texto.includes('javascript:'));
  });

  cenario('Dados salvos no navegador', async () => {
    const ctx = await abrir();
    iniciar(ctx, { persist: true, owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed')]);
    const salvo = JSON.parse(ctx.w.localStorage.getItem('igr:v1:files') || 'null');
    check('arquivos ficam salvos (igr:v1:files)', salvo && salvo.files.length === 1 && salvo.files[0].data.posts.length === 41);
    ctx.app.clear();
    check('clear() apaga os dados salvos', ctx.w.localStorage.getItem('igr:v1:files') === null);
  });

  cenario('Tema e isolamento da página hospedeira', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories')]);
    const html = ctx.doc.documentElement, cs = ctx.w.getComputedStyle(ctx.root);
    check('variáveis CSS têm prefixo --igr-', cs.getPropertyValue('--igr-surface-1').trim() !== '' && cs.getPropertyValue('--surface-1').trim() === '');
    check('color-scheme não vaza para a página', ctx.w.getComputedStyle(html).colorScheme === 'normal', ctx.w.getComputedStyle(html).colorScheme);
    ctx.doc.getElementById('igr-theme').click();
    check('tema usa data-igr-theme (não data-theme)', html.hasAttribute('data-igr-theme') && !html.hasAttribute('data-theme'));
    html.setAttribute('data-igr-theme', 'dark');
    check('modo escuro só no relatório', ctx.w.getComputedStyle(ctx.root).colorScheme === 'dark' && ctx.w.getComputedStyle(html).colorScheme === 'normal');
    html.setAttribute('data-igr-theme', 'light');
    ctx.app.render();
    const rotulo = [...ctx.doc.querySelectorAll('#igr-sec-summary .igr-inbar')].find(t => t.textContent === '>99%' || parseInt(t.textContent, 10) > 50);
    check('% sobre o rosa claro usa tinta escura (contraste)', rotulo && rotulo.style.fill.replace(/\s/g, '') === 'rgb(11,11,11)', rotulo && rotulo.style.fill);
  });

  cenario('Formatação e utilitários', async () => {
    const ctx = await abrir();
    const { fmt, mentionsOf } = ctx.w.IGR.metrics, I = ctx.w.IGR.insights, P = ctx.w.IGR.parsers;
    check('119,6 s → "2min"', fmt.seconds(119.6) === '2min', fmt.seconds(119.6));
    check('75 s → "1min 15s"', fmt.seconds(75) === '1min 15s', fmt.seconds(75));
    check('story sem texto → "sem texto"', I.excerpt({ description: '', format: { key: 'story' } }) === 'sem texto');
    check('"**" da legenda não vira negrito', !I.excerpt({ description: 'Promo **50%**' }).includes('**'));
    check('normKey remove acentos e espaços', P.normKey('Identificação  da Conta') === 'identificacao da conta');
    check('menções: início, parênteses, ponto final', JSON.stringify(mentionsOf('@Ana e (com @bia.)')) === '["ana","bia"]', JSON.stringify(mentionsOf('@Ana e (com @bia.)')));
    check('e-mail não é menção', mentionsOf('contato@empresa.com').length === 0);
    check('safeUrl só aceita http(s)', P.safeUrl('https://x.com/a') === 'https://x.com/a' && P.safeUrl('javascript:alert(1)') === '');
  });

  cenario('Gráficos sem texto cortado e sem rolagem lateral', async () => {
    for (const largura of [1280, 390]) {
      const ctx = await abrir(largura);
      iniciar(ctx, { owner: DONA });
      await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
      check(`${largura}px: nenhum texto passa da borda do gráfico`, textosCortados(ctx) === 0, textosCortados(ctx) + ' gráfico(s)');
      check(`${largura}px: sem rolagem horizontal`, ctx.doc.documentElement.scrollWidth <= largura + 1, ctx.doc.documentElement.scrollWidth);
    }
  });

  cenario('Seções opcionais (HTML enxuto)', async () => {
    const ctx = await abrir();
    ['#igr-sec-themes', '#igr-sec-calendar', '#igr-sec-audience', '#igr-sec-posts', '#igr-sec-stories', '#igr-sec-collabs',
      '#igr-filters', '#igr-files', '#igr-alert', '#igr-generated', '#igr-file-input'].forEach(sel => { const el = ctx.doc.querySelector(sel); if (el) el.remove(); });
    let erro = '';
    try {
      iniciar(ctx, { owner: DONA });
      await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
    } catch (e) { erro = e.message; }
    check('relatório renderiza sem as seções removidas', !erro && ctx.erros.length === 0, erro || ctx.erros.join(' | '));
    check('seções que ficaram são preenchidas', ctx.doc.querySelectorAll('#igr-sec-summary .igr-kpi').length > 0 && ctx.doc.querySelectorAll('#igr-sec-content .igr-post').length > 0);
    // Marcação mínima: uma raiz vazia, sem nenhuma seção nem o <input type=file>
    const vazia = ctx.doc.createElement('div');
    vazia.className = 'igr';
    ctx.doc.body.appendChild(vazia);
    let erro2 = '';
    try { ctx.app.init(vazia, { persist: false, owner: DONA }); } catch (e) { erro2 = e.message; }
    check('init numa raiz vazia não quebra', !erro2 && ctx.erros.length === 0, erro2 || ctx.erros.join(' | '));
    check('sem o <input type=file> no HTML, ele é criado', !!vazia.querySelector('#igr-file-input'));
  });

  cenario('init() chamado duas vezes', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    iniciar(ctx, { owner: DONA });
    let leituras = 0;
    const P = ctx.w.IGR.parsers, original = P.readFile;
    P.readFile = f => { leituras++; return original(f); };
    const dt = new ctx.w.DataTransfer();
    dt.items.add(await arquivo('feed'));
    const input = ctx.doc.getElementById('igr-file-input');
    input.files = dt.files;
    input.dispatchEvent(new ctx.w.Event('change'));
    await new Promise(r => setTimeout(r, 600));
    check('cada arquivo é lido uma vez só', leituras === 1, leituras);
    check('dados carregados normalmente', ctx.m() && ctx.m().posts.length === 40);
  });

  cenario('Gráfico de evolução', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
    const card = () => ctx.doc.getElementById('igr-evolution');
    const chips = () => [...card().querySelectorAll('.igr-evo-metrics .igr-chip')];
    const chip = nome => chips().find(b => b.textContent === nome);
    const ativo = () => chips().filter(b => b.classList.contains('is-active')).map(b => b.textContent).join();
    const pontos = () => card().querySelectorAll('.igr-hit').length;
    const nota = () => card().querySelector('.igr-footnote').textContent;
    check('card "Evolução" é o último do resumo', card() && card().closest('#igr-sec-summary') && card().parentElement.lastElementChild === card());
    const nomes = chips().map(b => b.textContent);
    check('métricas do Instagram como opções', ['Visualizações', 'Alcance somado', 'Interações', 'Curtidas', 'Comentários', 'Compartilhamentos', 'Salvamentos', 'Taxa de engajamento', 'Novos seguidores', 'Publicações'].every(n => nomes.includes(n)), nomes.join(', '));
    check('sem total informado, "Seguidores" não aparece', !nomes.includes('Seguidores'));
    check('com export de público, "Seguidores via publicações" não aparece', !nomes.includes('Seguidores via publicações'));
    check('abre com "Visualizações" ativa, uma métrica por vez', ativo() === 'Visualizações', ativo());
    check('linha do período atual com área', card().querySelectorAll('.igr-line:not(.is-compare)').length >= 1 && card().querySelectorAll('.igr-area').length >= 1);
    check('"Todo o período": sem comparação e com dica de como comparar', card().querySelectorAll('.igr-line.is-compare').length === 0 && /escolha um período/.test(nota()), nota());
    const grao = () => card().querySelector('.igr-evo-grain .igr-chip.is-active').textContent;
    check('período longo (92 dias) abre na visão semanal', grao() === 'Semana', grao());
    check('semanal: 14 blocos de 7 dias', pontos() === 14, pontos());
    check('semanal: nota avisa que o primeiro bloco é menor', /primeiro bloco tem 1 dia/.test(nota()), nota());
    card().querySelector('[data-grain=day]').click();
    check('"Dia": um ponto por dia (92)', pontos() === 92 && grao() === 'Dia', pontos());
    const m = ctx.m(), M = ctx.w.IGR.metrics;
    const somaViews = M.sum(m.posts, p => p.views) + M.sum(m.stories, p => p.views);
    const tabelaSoma = () => { const ab = card().querySelector('.igr-card-actions .igr-link-btn'); ab.click(); const tot = [...card().querySelectorAll('.igr-card-table tbody tr')].reduce((a, tr) => a + (+tr.children[1].textContent.replace(/\D/g, '') || 0), 0); const n = card().querySelectorAll('.igr-card-table tbody tr').length; ab.click(); return { tot, n }; };
    let t = tabelaSoma();
    check('"Ver tabela": 92 linhas que somam as visualizações de feed + stories', t.n === 92 && t.tot === somaViews, t.n + ' linhas, soma ' + t.tot + ' vs ' + somaViews);

    chip('Novos seguidores').click();
    check('troca de métrica: chip ativo, subtítulo e aria-pressed', ativo() === 'Novos seguidores' && chip('Novos seguidores').getAttribute('aria-pressed') === 'true' && /export de público/.test(card().querySelector('.igr-card-sub').textContent));
    t = tabelaSoma();
    check('novos seguidores somam o mesmo que o export de público', t.tot === M.sum(m.followers, p => p.value), t.tot + ' vs ' + M.sum(m.followers, p => p.value));

    // Tabela aberta acompanha a troca de métrica
    const btnTabela = card().querySelector('.igr-card-actions .igr-link-btn');
    btnTabela.click();
    const antes = card().querySelector('.igr-card-table tbody').textContent;
    chip('Publicações').click();
    check('tabela aberta é atualizada ao trocar a métrica', card().querySelector('.igr-card-table tbody').textContent !== antes && !card().querySelector('.igr-card-table').hidden);
    btnTabela.click();

    chip('Taxa de engajamento').click();
    check('taxa de engajamento: linha interrompida nos dias sem post', card().querySelectorAll('.igr-line:not(.is-compare)').length > 1, card().querySelectorAll('.igr-line:not(.is-compare)').length);
    check('taxa de engajamento: eixo em %', [...card().querySelectorAll('.igr-tick')].some(e => /%$/.test(e.textContent)));

    // Filtro de período: comparação com o anterior, escolha preservada
    chip('Visualizações').click();
    const periodo = [...ctx.doc.querySelectorAll('#igr-filters select')].find(sel => [...sel.options].some(o => o.value === 'custom'));
    periodo.value = '30'; periodo.dispatchEvent(new Event('change'));
    check('métrica e agrupamento escolhidos continuam depois do filtro', ativo() === 'Visualizações' && grao() === 'Dia', ativo() + ' / ' + grao());
    check('últimos 30 dias: linha de comparação + legenda', card().querySelectorAll('.igr-line.is-compare').length >= 1 && /Comparação/.test(card().querySelector('.igr-legend').textContent));
    check('nota informa as datas do período anterior', /período anterior \(\d\d\/\d\d\/\d{4} a \d\d\/\d\d\/\d{4}\)/.test(nota()), nota());
    check('30 pontos no período atual', pontos() === 30, pontos());
    const hit = card().querySelectorAll('.igr-hit')[10];
    hit.dispatchEvent(new ctx.w.PointerEvent('pointerenter', { clientX: 300, clientY: 300 }));
    const tip = ctx.doc.querySelector('.igr-tooltip');
    check('hover: tooltip com período atual, comparação e publicações do dia', tip && tip.classList.contains('is-visible') && /período atual/.test(tip.textContent) && /comparação/.test(tip.textContent) && /(post|story|stories|Nenhuma publicação)/.test(tip.textContent), tip && tip.textContent);
    check('hover: guia vertical visível', card().querySelector('.igr-guide').getAttribute('visibility') === 'visible');
    hit.dispatchEvent(new ctx.w.PointerEvent('pointerleave'));
    check('saída do mouse: tooltip e guia somem', !tip.classList.contains('is-visible') && card().querySelector('.igr-guide').getAttribute('visibility') === 'hidden');

    // Período curto: semana desabilitada
    periodo.value = '7'; periodo.dispatchEvent(new Event('change'));
    check('7 dias: "Semana" desabilitado e visão diária', card().querySelector('[data-grain=week]').disabled && grao() === 'Dia' && pontos() === 7);

    // Total de seguidores informado
    periodo.value = 'all'; periodo.dispatchEvent(new Event('change'));
    ctx.app.setFollowers(5189, '2026-09-30');
    check('com total informado, aparece "Seguidores"', !!chip('Seguidores'));
    chip('Seguidores').click();
    check('"Seguidores": valor final = total informado (5.189)', card().querySelector('.igr-end-label').textContent === '5.189', card().querySelector('.igr-end-label').textContent);

    check('nenhum texto do gráfico passa da borda', textosCortados(ctx) === 0, textosCortados(ctx));
    // Impressão / PDF: só a métrica escolhida, sem os controles
    const regrasPrint = [...ctx.doc.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } })
      .filter(r => r.media && /print/.test(r.media.mediaText)).map(r => r.cssText).join(' ');
    check('impressão esconde os chips inativos e o agrupamento', /igr-evo-metrics .igr-chip:not\(.is-active\)/.test(regrasPrint) && /igr-evo-grain/.test(regrasPrint));
    check('sem erros de JavaScript', ctx.erros.length === 0, ctx.erros.join(' | '));
  });

  cenario('Gráficos de evolução do feed e dos stories', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
    const feed = ctx.doc.getElementById('igr-evolution-feed'), stories = ctx.doc.getElementById('igr-evolution-stories');
    check('"Evolução do feed" no fim da seção do feed', feed && feed.closest('#igr-sec-content') && feed.parentElement.lastElementChild === feed);
    check('"Evolução dos stories" no fim da seção de stories', stories && stories.closest('#igr-sec-stories') && stories.parentElement.lastElementChild === stories);
    const nomes = el => [...el.querySelectorAll('.igr-evo-metrics .igr-chip')].map(b => b.textContent);
    check('feed: só métricas do feed', nomes(feed).includes('Salvamentos') && nomes(feed).includes('Posts publicados') && !nomes(feed).includes('Respostas'), nomes(feed).join(', '));
    check('stories: métricas próprias', ['Respostas', 'Toques em figurinhas', 'Navegação', 'Stories publicados'].every(n => nomes(stories).includes(n)) && !nomes(stories).includes('Salvamentos'), nomes(stories).join(', '));
    [...feed.querySelectorAll('.igr-evo-metrics .igr-chip')].find(b => b.textContent === 'Salvamentos').click();
    const ativo = el => el.querySelector('.igr-evo-metrics .igr-chip.is-active').textContent;
    check('escolha no feed não muda os outros gráficos', ativo(feed) === 'Salvamentos' && ativo(stories) === 'Visualizações' && ativo(ctx.doc.getElementById('igr-evolution')) === 'Visualizações');
    check('nenhum texto dos gráficos passa da borda', textosCortados(ctx) === 0, textosCortados(ctx));
    check('sem erros de JavaScript', ctx.erros.length === 0, ctx.erros.join(' | '));
  });

  cenario('Gráfico de evolução no celular (360 px) e só com stories', async () => {
    let ctx = await abrir(360);
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('feed'), await arquivo('stories'), await arquivo('publico')]);
    const card = ctx.doc.getElementById('igr-evolution');
    check('gráfico desenhado em 360 px', card && card.querySelector('.igr-svg') && +card.querySelector('.igr-svg').getAttribute('width') <= 360);
    check('360 px: nenhum texto passa da borda', textosCortados(ctx) === 0, textosCortados(ctx));
    check('360 px: card não estoura a largura da página', card.getBoundingClientRect().right <= ctx.doc.documentElement.clientWidth + 1, card.getBoundingClientRect().right);

    ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    await ctx.app.loadFiles([await arquivo('stories')]);
    const nomes = [...ctx.doc.querySelectorAll('#igr-evolution .igr-evo-metrics .igr-chip')].map(b => b.textContent);
    check('só stories: sem métricas do feed', !nomes.some(n => ['Interações', 'Curtidas', 'Taxa de engajamento'].includes(n)), nomes.join(', '));
    check('só stories: visualizações e publicações continuam', nomes.includes('Visualizações') && nomes.includes('Publicações'), nomes.join(', '));
    check('sem erros de JavaScript', ctx.erros.length === 0, ctx.erros.join(' | '));
  });

  cenario('Volume grande (2.000 posts + 3.000 stories)', async () => {
    const ctx = await abrir();
    iniciar(ctx, { owner: DONA });
    const linhas = ['Identificação do post,Identificação da conta,Nome de usuário da conta,Nome da conta,Descrição,Duração (s),Horário de publicação,Link permanente,Tipo de post,Data,Visualizações,Alcance,Curtidas,Compartilhamentos,Seguimentos,Comentários,Salvamentos,Respostas,Toques em figurinhas,Navegação'];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tipos = ['Reel do Instagram', 'Carrossel do Instagram', 'Imagem do Instagram'];
    for (let i = 0; i < 5000; i++) {
      const story = i >= 2000, dia = 1 + Math.floor(rnd() * 28), mes = 7 + Math.floor(rnd() * 3);
      linhas.push([i + 1, 1000, DONA, 'Perfil', '"Post ' + i + ' #tag' + (i % 30) + ' @amiga' + (i % 50) + '"', story ? 0 : Math.floor(rnd() * 90),
        '0' + mes + '/' + (dia < 10 ? '0' : '') + dia + '/2026 ' + (10 + (i % 12)) + ':00', 'https://www.instagram.com/p/' + i + '/',
        story ? 'Story do Instagram' : tipos[i % 3], 'Total', Math.floor(rnd() * 20000), Math.floor(rnd() * 9000), Math.floor(rnd() * 900),
        Math.floor(rnd() * 90), Math.floor(rnd() * 20), Math.floor(rnd() * 40), Math.floor(rnd() * 60), Math.floor(rnd() * 10),
        Math.floor(rnd() * 50), Math.floor(rnd() * 900)].join(','));
    }
    const t0 = performance.now();
    ctx.app.loadText('Jul-01-2026_Sep-30-2026_grande.csv', linhas.join(NL));
    const t1 = performance.now();
    check('2.000 posts e 3.000 stories carregados', ctx.m().posts.length === 2000 && ctx.m().stories.length === 3000);
    check('carga + renderização em menos de 4 s', t1 - t0 < 4000, Math.round(t1 - t0) + ' ms');
  });

  /* ---------- Execução ---------- */
  (async () => {
    const resumo = document.getElementById('resumo');
    // Os testes limpam o armazenamento do navegador (mesma origem do relatório).
    // Guarda o que já estava salvo (arquivos, totais de seguidores, nomes do Hub) e devolve no fim.
    const salvo = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); salvo[k] = localStorage.getItem(k); } } catch (e) { /* ignora */ }
    for (const c of cenarios) {
      linha('grupo', [c.nome]);
      try { await c.fn(); } catch (e) { check('cenário terminou sem exceção', false, e.message); }
    }
    try { localStorage.clear(); Object.keys(salvo).forEach(k => localStorage.setItem(k, salvo[k])); } catch (e) { /* ignora */ }
    const ok = falhas === 0 && total > 0;
    resumo.textContent = ok ? `Tudo certo: ${total} verificações em ${cenarios.length} cenários.` : `${falhas} de ${total} verificações falharam.`;
    resumo.className = ok ? 'ok' : 'falha';
    document.title = `Testes · ${total - falhas}/${total} · ${ok ? 'OK' : 'FALHA'}`;
  })();
})();
