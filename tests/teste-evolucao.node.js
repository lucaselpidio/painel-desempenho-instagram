// Rodar: node tests/teste-evolucao.node.js
// Testes da lógica do gráfico de evolução (IGR.metrics.evolution) com os exports fictícios
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..'); // pasta relatorio-instagram
global.window = globalThis;
require(path.join(ROOT, 'assets/js/parsers.js'));
require(path.join(ROOT, 'assets/js/metrics.js'));
const P = IGR.parsers, M = IGR.metrics;

let total = 0, falhas = 0;
function check(nome, ok, det) { total++; if (!ok) falhas++; console.log((ok ? '  ok   ' : '  FALHA ') + nome + (ok ? '' : '  → ' + det)); }

const fx = f => fs.readFileSync(path.join(ROOT, 'tests/fixtures', f));
const parse = (name, buf) => P.parseText(name, P.decodeBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
const feedRaw = parse('Jul-01-2026_Sep-30-2026_100000000000001.csv', fx('Jul-01-2026_Sep-30-2026_100000000000001.csv'));
const storyRaw = parse('Jul-01-2026_Sep-30-2026_100000000000002.csv', fx('Jul-01-2026_Sep-30-2026_100000000000002.csv'));
const aud = parse('Público.csv', fx('Público.csv'));
const DONA = 'perfil_exemplo';
const all = feedRaw.posts.concat(storyRaw.posts).map(M.enrich);
const feed = all.filter(p => p.type !== 'story' && p.username === DONA);
const stories = all.filter(p => p.type === 'story');
const inR = (list, r) => list.filter(p => p.dateKey >= r.start && p.dateKey <= r.end);
const S = M.sum;
const vals = pts => pts.map(p => p.value);
const sumv = pts => S(pts.filter(p => p.value != null), p => p.value);

console.log('Dados: ' + feed.length + ' posts, ' + stories.length + ' stories, ' + aud.followers.length + ' dias de seguidores');

// ---------- Período inteiro, sem comparação ----------
const range = { start: '2026-07-01', end: '2026-09-30' };
const base = { range, prev: null, posts: inR(feed, range), stories: inR(stories, range), audienceFollowers: aud.followers, followerTotal: null };
const keys = M.evolutionMetrics(base).map(m => m.key);
console.log('Métricas disponíveis: ' + keys.join(', '));
check('métricas principais disponíveis', ['views', 'reach', 'interactions', 'er', 'newFollowers', 'publications'].every(k => keys.includes(k)), keys);
check('"Seguidores" só aparece com total informado', !keys.includes('followers'));
check('"Seguidores via publicações" some quando há export de público', !keys.includes('pubFollows'));

const days = M.daysBetween(range.start, range.end) + 1;
let e = M.evolution(base, 'views', 'day');
check('um ponto por dia (' + days + ')', e.points.length === days, e.points.length);
check('visualizações somam feed + stories', sumv(e.points) === S(base.posts, p => p.views) + S(base.stories, p => p.views), sumv(e.points));
check('sem período anterior: sem linha de comparação', e.prev === null);
check('dias sem publicação valem 0 (não nulo)', e.points.every(p => p.value != null));

const w = M.evolution(base, 'views', 'week');
check('semanal: blocos de 7 dias (' + Math.ceil(days / 7) + ')', w.points.length === Math.ceil(days / 7), w.points.length);
check('semanal soma igual ao diário', sumv(w.points) === sumv(e.points));
check('último bloco semanal termina no fim do período', w.points[w.points.length - 1].end === range.end, w.points[w.points.length - 1].end);
check('semanal: a última semana é completa e o bloco incompleto é o primeiro', w.points[w.points.length - 1].days === 7 && w.points[0].days === days - 7 * (w.points.length - 1), w.points[0].days);
check('semanal: blocos contínuos, sem buraco nem sobreposição', w.points.every((p, i) => !i || M.addDays(w.points[i - 1].end, 1) === p.start));
check('semanal: primeiro bloco começa no início do período', w.points[0].start === range.start, w.points[0].start);

e = M.evolution(base, 'publications', 'day');
check('publicações = posts + stories', sumv(e.points) === base.posts.length + base.stories.length, sumv(e.points));

e = M.evolution(base, 'er', 'day');
const semPost = e.points.filter((p, i) => !base.posts.some(x => x.dateKey === p.start));
check('taxa de engajamento: dias sem post ficam sem ponto', semPost.length > 0 && semPost.every(p => p.value === null));
const comPost = e.points.find(p => p.value != null);
const pd = base.posts.filter(x => x.dateKey === comPost.start);
check('taxa do dia = interações ÷ alcance dos posts do dia', Math.abs(comPost.value - S(pd, p => p.interactions) / S(pd, p => p.reach)) < 1e-12);
const ew = M.evolution(base, 'er', 'week');
const b0 = ew.points.find(p => p.value != null);
const pw = base.posts.filter(x => x.dateKey >= b0.start && x.dateKey <= b0.end);
check('taxa semanal = soma das interações ÷ soma do alcance', Math.abs(b0.value - S(pw, p => p.interactions) / S(pw, p => p.reach)) < 1e-12);

e = M.evolution(base, 'newFollowers', 'day');
const audIn = aud.followers.filter(p => p.date >= range.start && p.date <= range.end);
check('novos seguidores = export de público no período', sumv(e.points) === S(audIn, p => p.value), sumv(e.points) + ' vs ' + S(audIn, p => p.value));
const audStart = aud.followers[0].date;
check('dias antes do export de público ficam sem ponto (não zero)', e.points.filter(p => p.start < audStart).every(p => p.value === null));

// ---------- Total de seguidores ----------
const T = 5189;
const withTotal = Object.assign({}, base, { followerTotal: { total: T, date: range.end } });
check('"Seguidores" aparece com total + export de público', M.evolutionMetrics(withTotal).some(m => m.key === 'followers'));
e = M.evolution(withTotal, 'followers', 'day');
const lastPt = e.points.filter(p => p.value != null).pop();
check('último dia do período fora do export de público fica sem ponto', e.points[e.points.length - 1].value === null);
check('total no último dia coberto = total informado (informado no fim do período)', lastPt.value === T, lastPt.start + ': ' + lastPt.value);
const firstPt = e.points.find(p => p.value != null);
const gainsAfter = S(aud.followers.filter(p => p.date > firstPt.start && p.date <= range.end), p => p.value);
check('total no primeiro dia = total − ganhos depois', firstPt.value === T - gainsAfter, firstPt.value + ' vs ' + (T - gainsAfter));
check('total nunca diminui (só ganhos)', e.points.filter(p => p.value != null).every((p, i, a) => !i || p.value >= a[i - 1].value));
const later = Object.assign({}, base, { followerTotal: { total: T, date: '2026-10-09' } });
const eL = M.evolution(later, 'followers', 'day');
const lastL = eL.points.filter(p => p.value != null).pop();
check('informado depois do período: último dia coberto = total − ganhos depois dele', lastL.value === T - S(aud.followers.filter(p => p.date > lastL.start && p.date <= '2026-10-09'), p => p.value), lastL.value);
const ewT = M.evolution(withTotal, 'followers', 'week');
check('semanal: total = valor do último dia do bloco', ewT.points[ewT.points.length - 1].value === T, ewT.points[ewT.points.length - 1].value);
check('dias sem linha no export (sem ganho) contam como 0, não como vazio', M.evolution(base, 'newFollowers', 'day').points.filter(p => p.start >= '2026-07-03' && p.start <= '2026-09-29').every(p => p.value != null));

// ---------- Comparação com o período anterior (últimos 30 dias) ----------
const r30 = { start: '2026-09-01', end: '2026-09-30' }, p30 = { start: '2026-08-02', end: '2026-08-31' };
const cmp = { range: r30, prev: p30, posts: inR(feed, r30), stories: inR(stories, r30), prevPosts: inR(feed, p30), prevStories: inR(stories, p30), audienceFollowers: aud.followers, followerTotal: null };
e = M.evolution(cmp, 'views', 'day');
check('comparação: mesma quantidade de pontos', e.prev && e.prev.length === e.points.length, e.prev && e.prev.length);
check('comparação soma o período anterior', sumv(e.prev) === S(cmp.prevPosts, p => p.views) + S(cmp.prevStories, p => p.views));
check('comparação alinhada: 1º ponto anterior = início do período anterior', e.prev[0].start === p30.start, e.prev[0].start);
e = M.evolution(cmp, 'newFollowers', 'week');
check('comparação de seguidores (export cobre os dois períodos)', e.prev && e.prev.length === e.points.length);
const semAnterior = Object.assign({}, cmp, { prev: { start: '2026-05-01', end: '2026-05-30' }, prevPosts: [], prevStories: [] });
check('período anterior sem dados: sem linha de comparação', M.evolution(semAnterior, 'views', 'day').prev === null && M.evolution(semAnterior, 'newFollowers', 'day').prev === null);

// ---------- Só stories, sem público ----------
const so = { range, prev: null, posts: [], stories: inR(stories, range), audienceFollowers: null, followerTotal: { total: T, date: range.end } };
const k2 = M.evolutionMetrics(so).map(m => m.key);
check('só stories: sem métricas do feed', !k2.some(k => ['interactions', 'likes', 'comments', 'shares', 'saves', 'er'].includes(k)), k2);
check('só stories: sem seguidores do público e sem total (falta o export)', !k2.includes('newFollowers') && !k2.includes('followers'), k2);
check('sem público: "Seguidores via publicações" quando há dado', k2.includes('pubFollows') === (S(so.stories, p => p.follows) > 0), k2);

// ---------- Período de 1 dia ----------
const r1 = { start: '2026-09-30', end: '2026-09-30' };
e = M.evolution({ range: r1, prev: null, posts: inR(feed, r1), stories: inR(stories, r1), audienceFollowers: aud.followers }, 'views', 'week');
check('período de 1 dia: 1 ponto', e.points.length === 1 && e.points[0].days === 1);

check('rótulo de data "8 out"', M.fmt.dayMonth('2026-10-08') === '8 out' && M.fmt.dayMonth('2026-12-25') === '25 dez');

// ---------- Gráficos das seções: só feed e só stories ----------
console.log('\nEscopos feed e stories');
const kFeed = M.evolutionMetrics(base, 'feed').map(m => m.key);
const kStory = M.evolutionMetrics(base, 'stories').map(m => m.key);
console.log('Feed: ' + kFeed.join(', ') + '\nStories: ' + kStory.join(', '));
check('feed: métricas do feed, sem seguidores do público', ['views', 'reach', 'interactions', 'likes', 'comments', 'shares', 'saves', 'er', 'publications'].every(k => kFeed.includes(k)) && !kFeed.includes('newFollowers') && !kFeed.includes('followers'), kFeed);
check('stories: métricas próprias (respostas, figurinhas, navegação, alcance por story)', ['views', 'reach', 'avgReach', 'replies', 'stickerTaps', 'navigation', 'publications'].every(k => kStory.includes(k)) && !kStory.includes('interactions') && !kStory.includes('newFollowers'), kStory);
const somaE = (scope, key) => sumv(M.evolution(base, key, 'day', scope).points);
check('feed: visualizações = só posts do feed', somaE('feed', 'views') === S(base.posts, p => p.views), somaE('feed', 'views'));
check('stories: visualizações = só stories', somaE('stories', 'views') === S(base.stories, p => p.views), somaE('stories', 'views'));
check('feed + stories = resumo (visualizações)', somaE('feed', 'views') + somaE('stories', 'views') === somaE('all', 'views'));
check('feed + stories = resumo (alcance, visitas, publicações)', ['reach', 'profileVisits', 'publications'].every(k => somaE('feed', k) + somaE('stories', k) === somaE('all', k)));
check('feed: posts publicados = nº de posts', somaE('feed', 'publications') === base.posts.length);
check('stories: stories publicados = nº de stories', somaE('stories', 'publications') === base.stories.length);
check('stories: respostas, figurinhas e navegação somam o export', ['replies', 'stickerTaps', 'navigation'].every(k => somaE('stories', k) === S(base.stories, p => p[k])));
check('feed: seguidores via posts = coluna do export', somaE('feed', 'follows') === S(base.posts, p => p.follows));
const ar = M.evolution(base, 'avgReach', 'day', 'stories');
const diaS = ar.points.find(p => p.value != null);
const sd = base.stories.filter(x => x.dateKey === diaS.start);
check('stories: alcance por story = alcance do dia ÷ stories do dia', Math.abs(diaS.value - S(sd, p => p.reach) / sd.length) < 1e-9);
check('stories: dias sem story ficam sem ponto no alcance por story', ar.points.filter(p => !base.stories.some(x => x.dateKey === p.start)).every(p => p.value === null));
const arw = M.evolution(base, 'avgReach', 'week', 'stories').points.find(p => p.value != null);
const sw = base.stories.filter(x => x.dateKey >= arw.start && x.dateKey <= arw.end);
check('stories: alcance por story semanal = alcance da semana ÷ stories da semana', Math.abs(arw.value - S(sw, p => p.reach) / sw.length) < 1e-9);
check('feed: taxa de engajamento igual à do resumo', JSON.stringify(M.evolution(base, 'er', 'day', 'feed').points) === JSON.stringify(M.evolution(base, 'er', 'day', 'all').points));
const cmpF = M.evolution(cmp, 'views', 'day', 'feed'), cmpS = M.evolution(cmp, 'views', 'day', 'stories');
check('feed: comparação soma só os posts do período anterior', cmpF.prev && sumv(cmpF.prev) === S(cmp.prevPosts, p => p.views));
check('stories: comparação soma só os stories do período anterior', cmpS.prev && sumv(cmpS.prev) === S(cmp.prevStories, p => p.views));
const soPosts = Object.assign({}, cmp, { stories: [], prevStories: [] });
check('sem stories: gráfico de stories sem métricas', M.evolutionMetrics(soPosts, 'stories').length === 0);
const soStories = Object.assign({}, cmp, { posts: [], prevPosts: [] });
check('sem posts: gráfico do feed sem métricas', M.evolutionMetrics(soStories, 'feed').length === 0);
const semPrevStories = Object.assign({}, cmp, { prevStories: [] });
check('stories sem período anterior com dados: sem comparação', M.evolution(semPrevStories, 'views', 'day', 'stories').prev === null && M.evolution(semPrevStories, 'views', 'day', 'feed').prev !== null);
check('escopo desconhecido cai no resumo (sem quebrar)', M.evolutionMetrics(base, 'xyz').length === M.evolutionMetrics(base).length);

console.log('\n' + (total - falhas) + '/' + total + ' ok' + (falhas ? ' — ' + falhas + ' FALHA(S)' : ''));
process.exit(falhas ? 1 : 0);
