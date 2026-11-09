// Rodar: node tests/teste-evolucao-limites.node.js
// Casos-limite do gráfico de evolução: lógica (IGR.metrics) e desenho (IGR.charts.lines).
// Também vale rodar com outro fuso: TZ=America/New_York node tests/teste-evolucao-limites.node.js
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..'); // pasta relatorio-instagram

/* ---------- DOM mínimo para o charts.js ---------- */
class Node_ {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.style = {}; this._text = ''; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  set textContent(t) { this.children = []; this._text = String(t); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  get classList() { const s = this; return { add: c => { s.className = (s.className + ' ' + c).trim(); }, remove: c => { s.className = s.className.split(' ').filter(x => x !== c).join(' '); } }; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { (this.listeners[t] || []).forEach(f => f(e || { type: t })); }
  all() { return this.children.reduce((a, c) => a.concat([c], c.all()), []); }
  find(pred) { return this.all().filter(pred); }
  querySelectorAll(sel) { return sel === ':scope > svg' ? this.children.filter(c => c.tagName === 'SVG') : sel === '*' ? this.all() : []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  get offsetWidth() { return 120; } get offsetHeight() { return 40; }
}
global.document = { createElement: t => new Node_(t), createElementNS: (ns, t) => new Node_(t), createTextNode: t => { const n = new Node_('#text'); n._text = String(t); return n; }, body: new Node_('body'), documentElement: { clientWidth: 1280 } };
global.window = globalThis;
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
require(path.join(ROOT, 'assets/js/parsers.js'));
require(path.join(ROOT, 'assets/js/metrics.js'));
require(path.join(ROOT, 'assets/js/charts.js'));
const M = IGR.metrics, C = IGR.charts;

let total = 0, falhas = 0;
function check(nome, ok, det) { total++; if (!ok) falhas++; console.log((ok ? '  ok   ' : '  FALHA ') + nome + (ok ? '' : '  → ' + (typeof det === 'string' ? det : JSON.stringify(det)))); }
function grupo(n) { console.log('\n' + n); }
function semErro(nome, fn) { try { fn(); check(nome, true); } catch (e) { check(nome, false, e.stack.split('\n').slice(0, 3).join(' | ')); } }

/* ---------- Dados sintéticos ---------- */
let seq = 0;
function post(key, o) {
  const [y, m, d] = key.split('-').map(Number);
  return M.enrich(Object.assign({ id: 'p' + (++seq), ts: new Date(y, m - 1, d, 12, 0).getTime(), type: 'reel', views: 100, reach: 50, likes: 5, comments: 1, shares: 1, saves: 1, follows: 1, profileVisits: 2, replies: 0 }, o || {}));
}
const story = (key, o) => post(key, Object.assign({ type: 'story' }, o));
const S = M.sum;
const vals = e => e.points.map(p => p.value);
const finite = arr => arr.every(v => v == null || Number.isFinite(v));
const input = o => Object.assign({ prev: null, posts: [], stories: [], prevPosts: [], prevStories: [], audienceFollowers: null, followerTotal: null }, o);
const allKeys = M.EVOLUTION_METRICS.map(m => m.key);
function everyMetric(inp, fn) { allKeys.forEach(k => ['day', 'week'].forEach(g => fn(M.evolution(inp, k, g), k, g))); }

/* ======================================================================
   LÓGICA
   ====================================================================== */
grupo('Datas: fuso ' + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone));
for (const [nome, r] of [
  ['virada de ano (dez → jan)', { start: '2026-12-20', end: '2027-01-10' }],
  ['ano bissexto (29/02/2028)', { start: '2028-02-20', end: '2028-03-05' }],
  ['horário de verão EUA (8/3/2026)', { start: '2026-03-01', end: '2026-03-15' }],
  ['horário de verão EUA (1/11/2026)', { start: '2026-10-25', end: '2026-11-08' }],
  ['horário de verão Europa (29/3/2026)', { start: '2026-03-25', end: '2026-04-02' }]
]) {
  const days = M.daysBetween(r.start, r.end) + 1;
  const ps = [post(r.start), post(r.end)];
  const e = M.evolution(input({ range: r, posts: ps }), 'views', 'day');
  const keys = e.points.map(p => p.start);
  check(nome + ': ' + days + ' dias, sem repetir nem pular', keys.length === days && new Set(keys).size === days && keys.every((k, i) => !i || M.addDays(keys[i - 1], 1) === k), keys.join(','));
  check(nome + ': posts do 1º e do último dia contados', e.points[0].value === 100 && e.points[days - 1].value === 100, vals(e));
}
const bis = M.evolution(input({ range: { start: '2028-02-28', end: '2028-03-01' }, posts: [post('2028-02-29', { views: 7 })] }), 'views', 'day');
check('29/02 existe e recebe o post', bis.points[1].start === '2028-02-29' && bis.points[1].value === 7, bis.points);
check('rótulo "29 fev"', M.fmt.dayMonth('2028-02-29') === '29 fev');

grupo('Dados vazios ou estranhos');
const r30 = { start: '2026-09-01', end: '2026-09-30' };
check('sem nada carregado: nenhuma métrica oferecida', M.evolutionMetrics(input({ range: r30 })).length === 0);
semErro('sem nada carregado: evolution() não quebra em nenhuma métrica', () => everyMetric(input({ range: r30 }), e => { if (!Array.isArray(e.points)) throw new Error('sem points'); }));
const zeros = input({ range: r30, posts: [post('2026-09-05', { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, follows: 0, profileVisits: 0 })] });
const kz = M.evolutionMetrics(zeros).map(m => m.key);
check('post com tudo zero: só "Publicações" (as outras ficariam retas no zero)', kz.join() === 'publications', kz);
const erZero = M.evolution(zeros, 'er', 'day');
check('taxa com alcance 0: sem ponto (não divide por zero)', erZero.points[4].value === null && finite(vals(erZero)), erZero.points[4]);
const lixo = input({ range: r30, posts: [post('2026-09-05', { views: undefined, reach: NaN, likes: null }), post('2026-09-05', { views: 50 })] });
semErro('métricas undefined/NaN/null no post: não quebra', () => everyMetric(lixo, e => { if (!finite(vals(e))) throw new Error('valor não finito em ' + e.metric.key + ': ' + vals(e)); }));
check('métricas inválidas contam como 0 na soma', M.evolution(lixo, 'views', 'day').points[4].value === 50, M.evolution(lixo, 'views', 'day').points[4].value);
const fora = input({ range: r30, posts: [post('2026-08-31'), post('2026-10-01'), post('2026-09-15')] });
check('posts fora do período são ignorados', S(vals(M.evolution(fora, 'publications', 'day'))) === 1);

grupo('Export de público');
const aud = [{ date: '2026-09-10', value: 5 }, { date: '2026-09-02', value: 3 }, { date: '2026-09-20', value: 7 }]; // fora de ordem, com buracos
let e = M.evolution(input({ range: r30, audienceFollowers: aud }), 'newFollowers', 'day');
check('fora de ordem: soma certa', S(vals(e)) === 15, S(vals(e)));
check('antes da 1ª data do export: sem ponto', e.points[0].value === null);
check('buraco no meio da cobertura: 0', e.points[4].value === 0);
check('depois da última data: sem ponto', e.points[25].value === null);
e = M.evolution(input({ range: r30, audienceFollowers: [{ date: '2026-09-15', value: 4 }] }), 'newFollowers', 'day');
check('export com 1 dia só: 1 ponto, resto sem ponto', vals(e).filter(v => v != null).length === 1 && e.points[14].value === 4);
e = M.evolution(input({ range: r30, audienceFollowers: [{ date: '2026-09-15', value: 4 }, { date: '2026-09-15', value: 6 }] }), 'newFollowers', 'day');
check('data duplicada no export: conta uma vez (a última)', e.points[14].value === 6, e.points[14].value);
e = M.evolution(input({ range: r30, audienceFollowers: [{ date: '2025-01-01', value: 4 }] }), 'newFollowers', 'day');
check('export de outro período: métrica não oferecida', !M.evolutionMetrics(input({ range: r30, audienceFollowers: [{ date: '2025-01-01', value: 4 }] })).some(m => m.key === 'newFollowers'));
check('export de outro período: evolution() não quebra e não inventa pontos', vals(e).every(v => v === null));
const audNeg = [{ date: '2026-09-01', value: 10 }, { date: '2026-09-02', value: -3 }, { date: '2026-09-30', value: 2 }];
semErro('valores negativos no export (perda líquida): não quebra', () => everyMetric(input({ range: r30, audienceFollowers: audNeg, followerTotal: { total: 100, date: '2026-09-30' } }), () => {}));

grupo('Total de seguidores');
const audFull = []; for (let k = '2026-09-01'; k <= '2026-09-30'; k = M.addDays(k, 1)) audFull.push({ date: k, value: 10 });
const tot = t => input({ range: r30, audienceFollowers: audFull, followerTotal: t });
e = M.evolution(tot({ total: 1000, date: '2026-09-30' }), 'followers', 'day');
check('informado no último dia: termina no total', e.points[29].value === 1000 && e.points[0].value === 1000 - 290, [e.points[0].value, e.points[29].value]);
e = M.evolution(tot({ total: 1000, date: '2026-09-15' }), 'followers', 'day');
check('informado no meio do período: passa pelo total no dia informado', e.points[14].value === 1000 && e.points[29].value === 1150, [e.points[14].value, e.points[29].value]);
e = M.evolution(tot({ total: 1000, date: '2026-12-31' }), 'followers', 'day');
check('informado meses depois (sem export no meio): último dia = total', e.points[29].value === 1000);
e = M.evolution(tot({ total: 1000, date: '2026-01-01' }), 'followers', 'day');
check('informado antes do período: soma os ganhos desde então', e.points[29].value === 1300, e.points[29].value);
const errado = tot({ total: 5, date: '2026-09-30' }); // digitou 5 em vez de 5.189
e = M.evolution(errado, 'followers', 'day');
check('total menor que os ganhos (digitado errado): métrica "Seguidores" não é oferecida', !M.evolutionMetrics(errado).some(m => m.key === 'followers'), M.evolutionMetrics(errado).map(m => m.key));
check('total digitado errado: nenhum ponto negativo', vals(e).every(v => v == null || v >= 0), vals(e).slice(0, 5));
check('total sem export de público: métrica não oferecida', !M.evolutionMetrics(input({ range: r30, followerTotal: { total: 1000, date: '2026-09-30' } })).some(m => m.key === 'followers'));

grupo('Comparação');
const rA = { start: '2026-09-01', end: '2026-09-30' }, rB = { start: '2026-08-02', end: '2026-08-31' };
const cmp = input({ range: rA, prev: rB, posts: [post('2026-09-01')], prevPosts: [post('2026-08-02', { views: 30 })], audienceFollowers: audFull });
e = M.evolution(cmp, 'views', 'day');
check('comparação com o mesmo nº de pontos e valor alinhado', e.prev.length === 30 && e.prev[0].value === 30);
check('export de público só no período atual: sem comparação de seguidores', M.evolution(cmp, 'newFollowers', 'day').prev === null);
e = M.evolution(input({ range: rA, prev: rB, stories: [story('2026-09-03')], prevStories: [story('2026-08-05')] }), 'views', 'week');
check('só stories nos dois períodos: comparação semanal', e.prev && e.prev.length === e.points.length);
e = M.evolution(input({ range: rA, prev: rB, posts: [post('2026-09-01')], prevStories: [story('2026-08-05')] }), 'interactions', 'day');
check('métrica do feed sem posts no anterior (só stories): sem comparação', e.prev === null);
const r7 = { start: '2026-09-24', end: '2026-09-30' };
e = M.evolution(input({ range: r7, prev: { start: '2026-09-17', end: '2026-09-23' }, posts: [post('2026-09-30')], prevPosts: [post('2026-09-17')] }), 'views', 'week');
check('período de 7 dias agrupado por semana: 1 bloco nos dois', e.points.length === 1 && e.prev.length === 1 && e.points[0].days === 7);

grupo('Semanas');
for (const days of [1, 6, 7, 8, 13, 14, 15, 30, 31, 92, 365, 366]) {
  const r = { start: '2026-01-01', end: M.addDays('2026-01-01', days - 1) };
  const w = M.evolution(input({ range: r, posts: [post(r.start), post(r.end)] }), 'views', 'week');
  const d = M.evolution(input({ range: r, posts: [post(r.start), post(r.end)] }), 'views', 'day');
  const ok = w.points.length === Math.ceil(days / 7) && S(w.points, p => p.days) === days && w.points[w.points.length - 1].days === Math.min(7, days)
    && w.points[w.points.length - 1].end === r.end && w.points[0].start === r.start && S(vals(w)) === S(vals(d));
  check(days + ' dias: ' + w.points.length + ' blocos, última semana completa, mesma soma do diário', ok, w.points.map(p => p.days).join(','));
}

grupo('Desempenho');
const big = { start: '2022-01-01', end: '2026-12-31' }; // 5 anos
const bigPosts = [], bigStories = [], bigAud = [];
for (let k = big.start, i = 0; k <= big.end; k = M.addDays(k, 1), i++) {
  if (i % 2 === 0) bigPosts.push(post(k, { views: i }));
  bigStories.push(story(k)); bigStories.push(story(k));
  bigAud.push({ date: k, value: i % 9 });
}
const bigIn = input({ range: big, posts: bigPosts, stories: bigStories, audienceFollowers: bigAud, followerTotal: { total: 50000, date: big.end } });
let t0 = Date.now();
const opts = M.evolutionMetrics(bigIn);
let t1 = Date.now();
check('5 anos (1.826 dias, 4.565 publicações): lista de métricas em < 1,5 s', t1 - t0 < 1500, (t1 - t0) + ' ms');
t0 = Date.now();
opts.forEach(m => { M.evolution(bigIn, m.key, 'day'); M.evolution(bigIn, m.key, 'week'); });
t1 = Date.now();
check('5 anos: todas as métricas, dia e semana, em < 3 s', t1 - t0 < 3000, (t1 - t0) + ' ms');

grupo('Gráficos das seções: feed e stories');
const scopeKeys = (inp, sc) => M.evolutionMetrics(inp, sc).map(m => m.key);
const keysOf = sc => M.EVOLUTION_SCOPES[sc].map(m => m.key);
function everyScoped(inp, sc, fn) { keysOf(sc).forEach(k => ['day', 'week'].forEach(g => fn(M.evolution(inp, k, g, sc), k, g))); }
check('catálogos sem chave repetida', ['all', 'feed', 'stories'].every(sc => new Set(keysOf(sc)).size === keysOf(sc).length));
check('catálogos sem métrica sem rótulo/descrição/valor', ['all', 'feed', 'stories'].every(sc => M.EVOLUTION_SCOPES[sc].every(m => m.label && m.desc && typeof m.value === 'function')));
semErro('sem nada carregado: nenhum escopo quebra em nenhuma métrica', () => ['feed', 'stories'].forEach(sc => everyScoped(input({ range: r30 }), sc, () => {})));
check('sem nada carregado: nenhum escopo oferece métrica', scopeKeys(input({ range: r30 }), 'feed').length === 0 && scopeKeys(input({ range: r30 }), 'stories').length === 0);

const st1 = story('2026-09-05', { views: 40, reach: 0, likes: 0, shares: 0, replies: 0, stickerTaps: 0, profileVisits: 0, follows: 0, navigation: 0, linkClicks: 0 });
const kOnly = scopeKeys(input({ range: r30, stories: [st1] }), 'stories');
check('story só com visualizações: só Visualizações e Stories publicados (alcance por story 0 não conta)', kOnly.join() === 'views,publications', kOnly);
const ar0 = M.evolution(input({ range: r30, stories: [st1] }), 'avgReach', 'day', 'stories');
check('alcance por story com alcance 0: ponto 0 no dia do story, sem ponto nos outros', ar0.points[4].value === 0 && ar0.points[3].value === null, [ar0.points[3].value, ar0.points[4].value]);
const link = story('2026-09-06', { linkClicks: 12 });
check('cliques no link aparecem quando o export tem a coluna com valores', scopeKeys(input({ range: r30, stories: [link] }), 'stories').includes('linkClicks'));
const lixoSt = input({ range: r30, stories: [story('2026-09-05', { views: undefined, reach: NaN, replies: null, navigation: 'abc' }), story('2026-09-05', { views: 9 })] });
semErro('stories com métricas undefined/NaN/texto: valores finitos em todas as métricas', () => everyScoped(lixoSt, 'stories', e => { if (!finite(vals(e))) throw new Error(e.metric.key + ': ' + vals(e)); }));
check('stories inválidos contam como 0 na soma', M.evolution(lixoSt, 'views', 'day', 'stories').points[4].value === 9, M.evolution(lixoSt, 'views', 'day', 'stories').points[4].value);
const avgOk = M.evolution(lixoSt, 'avgReach', 'day', 'stories').points[4].value;
check('alcance por story com um alcance inválido: média só não vira NaN', Number.isFinite(avgOk), avgOk);

const mix = input({ range: r30, posts: [post('2026-09-10', { views: 70 })], stories: [story('2026-09-10', { views: 30 }), story('2026-09-11', { views: 5 })] });
check('mesmo dia com post e story: feed 70, stories 30, resumo 100', M.evolution(mix, 'views', 'day', 'feed').points[9].value === 70 && M.evolution(mix, 'views', 'day', 'stories').points[9].value === 30 && M.evolution(mix, 'views', 'day', 'all').points[9].value === 100);
check('dia só com story: feed 0 (não vazio), stories 5', M.evolution(mix, 'views', 'day', 'feed').points[10].value === 0 && M.evolution(mix, 'views', 'day', 'stories').points[10].value === 5);
check('taxa do feed em dia só com story: sem ponto', M.evolution(mix, 'er', 'day', 'feed').points[10].value === null);
const ft = Object.assign({}, mix, { audienceFollowers: audFull, followerTotal: { total: 1000, date: '2026-09-30' } });
check('total de seguidores e export de público não entram nos gráficos das seções', !scopeKeys(ft, 'feed').some(k => ['followers', 'newFollowers'].includes(k)) && !scopeKeys(ft, 'stories').some(k => ['followers', 'newFollowers'].includes(k)));

const soAnterior = input({ range: rA, prev: rB, posts: [], stories: [], prevPosts: [post('2026-08-05')], prevStories: [story('2026-08-05')] });
check('dados só no período anterior: nenhum gráfico de seção', scopeKeys(soAnterior, 'feed').length === 0 && scopeKeys(soAnterior, 'stories').length === 0);
const stSoAtual = input({ range: rA, prev: rB, stories: [story('2026-09-03')], prevPosts: [post('2026-08-03')] });
check('stories só no atual, posts só no anterior: stories sem comparação', M.evolution(stSoAtual, 'views', 'day', 'stories').prev === null);
for (const sc of ['feed', 'stories']) {
  const one = input({ range: { start: '2026-09-30', end: '2026-09-30' }, posts: [post('2026-09-30')], stories: [story('2026-09-30')] });
  semErro(sc + ': período de 1 dia em todas as métricas e agrupamentos', () => everyScoped(one, sc, e => { if (e.points.length !== 1) throw new Error(e.metric.key + ' ' + e.points.length); }));
}
for (const [nome, r] of [['virada de ano', { start: '2026-12-25', end: '2027-01-05' }], ['horário de verão EUA', { start: '2026-03-05', end: '2026-03-12' }], ['bissexto', { start: '2028-02-27', end: '2028-03-02' }]]) {
  const ii = input({ range: r, posts: [post(r.start), post(r.end)], stories: [story(r.start), story(r.end), story(r.end)] });
  const f = M.evolution(ii, 'publications', 'day', 'feed'), sx = M.evolution(ii, 'publications', 'day', 'stories');
  check(nome + ': feed e stories contam as publicações certas no 1º e no último dia', f.points[0].value === 1 && f.points[f.points.length - 1].value === 1 && sx.points[0].value === 1 && sx.points[sx.points.length - 1].value === 2);
}
// Volume: 5 anos, os dois escopos
t0 = Date.now();
['feed', 'stories'].forEach(sc => M.evolutionMetrics(bigIn, sc).forEach(m => { M.evolution(bigIn, m.key, 'day', sc); M.evolution(bigIn, m.key, 'week', sc); }));
t1 = Date.now();
check('5 anos: todas as métricas de feed e de stories, dia e semana, em < 3 s', t1 - t0 < 3000, (t1 - t0) + ' ms');

/* ======================================================================
   DESENHO
   ====================================================================== */
const textWidth = (s, size) => String(s).length * (size || 12) * 0.56;
function draw(W, opt) {
  const host = new Node_('div');
  Object.defineProperty(host, 'clientWidth', { value: W, configurable: true });
  C.lines(host, Object.assign({ fmt: v => String(v), labels: opt.values.map((_, i) => (i + 1) + ' out') }, opt));
  return { host, svg: host.children.find(c => c.tagName === 'SVG') };
}
const cls = (svg, c) => svg.find(n => (n.attrs.class || '').split(' ').includes(c));
const nums = svg => svg.find(() => true).flatMap(n => Object.entries(n.attrs).filter(([k]) => ['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'width', 'height'].includes(k)).map(([, v]) => v));
const semNaN = svg => !nums(svg).some(v => /NaN|Infinity/.test(v));
const dentro = (svg, W, H) => cls(svg, 'igr-line').concat(cls(svg, 'igr-area')).every(p => (p.attrs.d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) || []).every(c => { const [x, y] = c.split(',').map(Number); return x >= -0.5 && x <= W + 0.5 && y >= -0.5 && y <= H + 0.5; }));
const yLabels = svg => cls(svg, 'igr-tick').filter(t => t.attrs['text-anchor'] === 'end').map(t => t.textContent);

grupo('Desenho: valores extremos');
let g = draw(800, { values: [10, -5, 20, -30, 15] });
check('valores negativos: nada desenhado fora do SVG', g.svg && dentro(g.svg, 800, 260) && semNaN(g.svg));
g = draw(800, { values: [1e9, 2.5e9, 3.7e9], fmt: M.fmt.int, fmtAxis: M.fmt.compact });
check('bilhões: rótulo final cabe no SVG', +cls(g.svg, 'igr-end-label')[0].attrs.x + textWidth(cls(g.svg, 'igr-end-label')[0].textContent, 12) <= 800, cls(g.svg, 'igr-end-label')[0].textContent);
check('bilhões: rótulos do eixo y cabem na margem', cls(g.svg, 'igr-tick').filter(t => t.attrs['text-anchor'] === 'end').every(t => +t.attrs.x - textWidth(t.textContent, 11) >= 0), yLabels(g.svg));
for (const [nome, v] of [['taxa ~1%', [0.009, 0.012, 0.011, 0.01]], ['taxa ~0,2%', [0.001, 0.002, 0.0015]], ['taxa ~12%', [0.08, 0.12, 0.1]], ['taxa constante 5%', [0.05, 0.05, 0.05]]]) {
  g = draw(800, { values: v, fmt: x => M.fmt.pct(x), fmtAxis: (x, casas) => M.fmt.pct(x, casas) }); // como o app.js passa
  const yl = yLabels(g.svg);
  check(nome + ': rótulos do eixo y sem repetição', new Set(yl).size === yl.length, yl);
}
for (const [nome, v] of [['contagem 0–3', [0, 1, 3, 2]], ['milhares 10–15 mil', [10000, 12500, 15000]], ['milhões 1,0–1,5 mi', [1e6, 1.25e6, 1.5e6]]]) {
  g = draw(800, { values: v, fmt: M.fmt.int, fmtAxis: M.fmt.compact, integer: true });
  const yl = yLabels(g.svg);
  check(nome + ': rótulos do eixo y sem repetição', new Set(yl).size === yl.length, yl);
}
g = draw(800, { values: [10, -5, 20, -30, 15], integer: true });
check('valores negativos: zero no eixo, rótulos negativos e guia até o pé', yLabels(g.svg).includes('0') && yLabels(g.svg).some(t => /^-/.test(t)) && +cls(g.svg, 'igr-guide')[0].attrs.y2 === 260 - 28, yLabels(g.svg));
g = draw(800, { values: [-3, -8, -1] });
check('só negativos: desenha (não é "sem dados")', !!g.svg && dentro(g.svg, 800, 260));
g = draw(800, { values: [5, 5, 5, 5] });
check('linha reta (todos iguais): desenha sem NaN', g.svg && semNaN(g.svg) && cls(g.svg, 'igr-line').length === 1);
g = draw(800, { values: [0, 0, 7, 0] });
check('um pico só: ok', g.svg && semNaN(g.svg));
g = draw(800, { values: [1, NaN, 3, Infinity, 5] });
check('NaN/Infinity nos dados: tratados como sem dado (sem "NaN" no SVG)', g.svg && semNaN(g.svg), nums(g.svg).filter(v => /NaN|Infinity/.test(v)).slice(0, 3));

grupo('Desenho: tamanhos');
for (const W of [120, 200, 320]) {
  g = draw(W, { values: [100, 2000, 30000, 400000], fmt: M.fmt.int, fmtAxis: M.fmt.compact });
  check('largura ' + W + 'px: sem NaN e dentro do SVG', g.svg && semNaN(g.svg) && dentro(g.svg, W, 260));
}
g = draw(0, { values: [1, 2, 3] });
check('largura 0 (aba escondida): não desenha e não quebra', !g.svg);
g = draw(800, { values: [3, 4] });
check('2 pontos: linha com 2 pontos', g.svg && (cls(g.svg, 'igr-line')[0].attrs.d.match(/[ML]/g) || []).length === 2);
const many = Array.from({ length: 1826 }, (_, i) => i % 50);
t0 = Date.now();
g = draw(1200, { values: many, compare: many.map(v => v + 1) });
t1 = Date.now();
check('1.826 pontos (5 anos diário): desenha em < 500 ms', g.svg && t1 - t0 < 500, (t1 - t0) + ' ms');
check('1.826 pontos: rótulos do eixo x sem sobreposição', (() => { const xl = cls(g.svg, 'igr-tick').filter(t => t.attrs['text-anchor'] === 'middle').map(t => ({ x: +t.attrs.x, w: textWidth(t.textContent, 11) })); return xl.every((l, i) => !i || l.x - l.w / 2 >= xl[i - 1].x + xl[i - 1].w / 2); })());

grupo('Desenho: comparação e rótulos');
g = draw(800, { values: [1, 2, 3], compare: [4, 5, 6, 7, 8] });
check('comparação mais longa que o atual: ignora o excesso', g.svg && cls(g.svg, 'is-compare')[0].attrs.d.match(/[ML]/g).length === 3);
g = draw(800, { values: [1, 2, 3], compare: [null, null, null] });
check('comparação toda nula: sem linha cinza', g.svg && cls(g.svg, 'is-compare').length === 0);
g = draw(800, { values: [1, 2, 3], labels: [undefined, '', null] });
check('rótulos ausentes: não escreve "undefined"/"null"', g.svg && !cls(g.svg, 'igr-tick').some(t => /undefined|null/.test(t.textContent)));
g = draw(800, { values: [null, 4, null] });
check('um único valor entre nulos: ponto + rótulo final', g.svg && cls(g.svg, 'igr-line-dot').length === 1 && cls(g.svg, 'igr-end-label')[0].textContent === '4');
g = draw(800, { values: [1, 2, null], compare: [3, 4, 5], tip: i => ({ title: 't' + i, rows: [] }) });
const hits = cls(g.svg, 'igr-hit');
hits[2].fire('pointerenter', { type: 'pointerenter', clientX: 1, clientY: 1 });
const foco = cls(g.svg, 'igr-line-focus');
check('hover num ponto sem dado: marcador atual escondido, comparação visível', foco[0].attrs.visibility === 'hidden' && foco[1].attrs.visibility === 'visible');
hits[2].fire('blur');
check('foco por teclado sai: guia some', cls(g.svg, 'igr-guide')[0].attrs.visibility === 'hidden');

grupo('Desenho: redesenho (impressão / troca de largura)');
const pai = new Node_('div'), host = pai.appendChild(new Node_('div'));
let w = 900; Object.defineProperty(host, 'clientWidth', { get: () => w });
C.lines(host, { values: [1, 2, 3], labels: ['a', 'b', 'c'] });
w = 600; C.rerenderAll(pai); // como o beforeprint faz com a raiz do relatório
const svgs = host.children.filter(c => c.tagName === 'SVG');
check('rerenderAll (antes de imprimir): redesenha na nova largura, um SVG só', svgs.length === 1 && svgs[0].attrs.width === '600', svgs.map(s => s.attrs.width));

console.log('\n' + (total - falhas) + '/' + total + ' ok' + (falhas ? ' — ' + falhas + ' FALHA(S)' : ''));
process.exit(falhas ? 1 : 0);
