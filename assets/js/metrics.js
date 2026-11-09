/* ==========================================================================
   IGR.metrics — cálculos, agregações e formatação
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR = global.IGR || {};
  const { dateKey } = IGR.parsers;

  /* ---------- Formatos (cor segue o formato em todo o relatório) ---------- */
  const FORMATS = [
    { key: 'reel', label: 'Reels', single: 'Reel', color: 'var(--igr-series-1)' },
    { key: 'carrossel', label: 'Carrosséis', single: 'Carrossel', color: 'var(--igr-series-2)' },
    { key: 'imagem', label: 'Imagens', single: 'Imagem', color: 'var(--igr-series-3)' },
    { key: 'video', label: 'Vídeos', single: 'Vídeo', color: 'var(--igr-series-4)' },
    { key: 'story', label: 'Stories', single: 'Story', color: 'var(--igr-series-5)' },
    { key: 'outro', label: 'Outros', single: 'Outro', color: 'var(--igr-series-6)' }
  ];
  const FORMAT = Object.fromEntries(FORMATS.map(f => [f.key, f]));

  const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const WEEKDAYS_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const TIME_BANDS = [
    { from: 0, to: 6, label: '00–06h', name: 'madrugada' },
    { from: 6, to: 9, label: '06–09h', name: 'início da manhã' },
    { from: 9, to: 12, label: '09–12h', name: 'manhã' },
    { from: 12, to: 15, label: '12–15h', name: 'início da tarde' },
    { from: 15, to: 18, label: '15–18h', name: 'fim da tarde' },
    { from: 18, to: 21, label: '18–21h', name: 'noite' },
    { from: 21, to: 24, label: '21–24h', name: 'fim da noite' }
  ];

  /* ---------- Formatação pt-BR ---------- */
  const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  const fmt = {
    int: v => (v == null || !isFinite(v) ? '–' : nfInt.format(Math.round(v))),
    compact: v => (v == null || !isFinite(v) ? '–' : Math.abs(v) < 10000 ? nfInt.format(Math.round(v)) : nfCompact.format(v)),
    pct: (v, digits) => (v == null || !isFinite(v) ? '–' :
      new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits == null ? 1 : digits, maximumFractionDigits: digits == null ? 1 : digits }).format(v * 100) + '%'),
    pctPoints: v => (v == null || !isFinite(v) ? '–' : nf1.format(v) + '%'),
    dec: v => (v == null || !isFinite(v) ? '–' : nf1.format(v)),
    times: v => (v == null || !isFinite(v) ? '–' : nf1.format(v) + '×'),
    date: ts => { const d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); },
    dateShort: ts => { const d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); },
    time: ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    dayKey: key => { const [y, m, d] = key.split('-'); return d + '/' + m + '/' + y; },
    dayKeyShort: key => { const [, m, d] = key.split('-'); return d + '/' + m; },
    dayMonth: key => { const [, m, d] = key.split('-'); return (+d) + ' ' + MONTHS_SHORT[+m - 1]; }, // "8 out"
    // Arredonda antes de dividir: 119,6s vira "2min", não "1min 60s"
    seconds: v => { const s = Math.round(v); return s < 60 ? s + 's' : Math.floor(s / 60) + 'min' + (s % 60 ? ' ' + (s % 60) + 's' : ''); }
  };
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------- Datas ---------- */
  const keyToDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (key, n) => { const d = keyToDate(key); d.setDate(d.getDate() + n); return dateKey(d); };
  const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
  const weekdayIdx = d => (d.getDay() + 6) % 7; // 0 = segunda
  const weekStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - weekdayIdx(d)); return dateKey(d); };

  /* ---------- Estatística ---------- */
  const sum = (arr, f) => arr.reduce((s, x) => s + ((f ? f(x) : x) || 0), 0);
  const mean = (arr, f) => (arr.length ? sum(arr, f) / arr.length : null);
  function median(values) {
    const v = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  const ratio = (a, b) => (b > 0 ? a / b : null);

  /* ---------- Texto ---------- */
  const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
  const STOPWORDS = new Set(('a o as os um uma uns umas de da do das dos e é em no na nos nas por para pra pro com sem que se ' +
    'ao aos à às mais menos muito muita muitos muitas meu minha meus minhas seu sua seus suas teu tua nosso nossa ' +
    'este esta estes estas esse essa esses essas isso isto aquilo ele ela eles elas eu tu você vocês voce voces nós nos ' +
    'me te lhe já ja só so também tambem mas ou como quando onde qual quais quem porque porquê pois então entao ' +
    'até ate sobre entre depois antes ainda aqui ali lá la bem tão tao num numa dum duma foi ser ter tem têm estar está ' +
    'estão sao são era vai vou faz fazer tudo todo toda todos todas nada cada outro outra outros outras mesmo mesma ' +
    'dia dias hoje sempre nunca ver vem vamos aí ai né ne the and for you with this that are was from your our out all ' +
    'link bio aqui clique confira siga').split(/\s+/));

  function hashtagsOf(text) {
    const set = new Set();
    String(text || '').replace(HASHTAG_RE, (_, t) => { set.add(t.toLowerCase()); return _; });
    return Array.from(set);
  }

  function wordsOf(text) {
    const clean = String(text || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(HASHTAG_RE, ' ')
      .replace(/@[\w.]+/g, ' ');
    const set = new Map();
    (clean.match(/[\p{L}][\p{L}\p{N}'’-]{2,}/gu) || []).forEach(w => {
      const lower = w.toLowerCase().replace(/['’-]+$/, '');
      const norm = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (lower.length < 3 || STOPWORDS.has(lower) || STOPWORDS.has(norm)) return;
      if (!set.has(norm)) set.set(norm, lower);
    });
    return Array.from(set.entries()).map(([key, display]) => ({ key, display }));
  }

  /* ---------- Posts enriquecidos ---------- */
  function enrich(p) {
    const d = new Date(p.ts);
    const interactions = (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);
    return Object.assign({}, p, {
      interactions,
      er: ratio(interactions, p.reach),
      shareRate: ratio(p.shares, p.reach),
      saveRate: ratio(p.saves, p.reach),
      commentRate: ratio(p.comments, p.reach),
      followPer1k: p.reach > 0 ? (p.follows / p.reach) * 1000 : null,
      viewsPerReach: ratio(p.views, p.reach),
      hashtags: hashtagsOf(p.description),
      captionLength: (p.description || '').length,
      dateKey: dateKey(d),
      weekKey: weekStart(p.ts),
      weekday: weekdayIdx(d),
      hour: d.getHours(),
      band: TIME_BANDS.findIndex(b => d.getHours() >= b.from && d.getHours() < b.to),
      format: FORMAT[p.type] || FORMAT.outro
    });
  }

  function summarize(posts) {
    const t = {
      n: posts.length,
      views: sum(posts, p => p.views), reach: sum(posts, p => p.reach),
      likes: sum(posts, p => p.likes), comments: sum(posts, p => p.comments),
      shares: sum(posts, p => p.shares), saves: sum(posts, p => p.saves),
      follows: sum(posts, p => p.follows), profileVisits: sum(posts, p => p.profileVisits),
      interactions: sum(posts, p => p.interactions)
    };
    t.er = ratio(t.interactions, t.reach);
    t.shareRate = ratio(t.shares, t.reach);
    t.saveRate = ratio(t.saves, t.reach);
    t.commentRate = ratio(t.comments, t.reach);
    t.followPer1k = t.reach > 0 ? (t.follows / t.reach) * 1000 : null;
    t.viewsPerReach = ratio(t.views, t.reach);
    t.avgViews = ratio(t.views, t.n);
    t.avgReach = ratio(t.reach, t.n);
    t.avgInteractions = ratio(t.interactions, t.n);
    t.medianViews = median(posts.map(p => p.views));
    t.medianReach = median(posts.map(p => p.reach));
    t.medianEr = median(posts.map(p => p.er));
    return t;
  }

  function byFormat(posts) {
    return FORMATS.map(f => {
      const list = posts.filter(p => p.format.key === f.key);
      return list.length ? Object.assign({ format: f, posts: list }, summarize(list)) : null;
    }).filter(Boolean);
  }

  // Participação do top 20% dos posts no total de visualizações
  function concentration(posts) {
    if (posts.length < 5) return null;
    const sorted = posts.map(p => p.views).sort((a, b) => b - a);
    const k = Math.max(1, Math.ceil(sorted.length * 0.2));
    const total = sum(sorted);
    return total ? { k, share: sum(sorted.slice(0, k)) / total } : null;
  }

  function weekly(posts, rangeStart, rangeEnd) {
    if (!posts.length) return [];
    const map = new Map();
    posts.forEach(p => {
      if (!map.has(p.weekKey)) map.set(p.weekKey, []);
      map.get(p.weekKey).push(p);
    });
    const first = rangeStart ? weekStart(keyToDate(rangeStart).getTime()) : Array.from(map.keys()).sort()[0];
    const last = rangeEnd ? weekStart(keyToDate(rangeEnd).getTime()) : Array.from(map.keys()).sort().pop();
    const out = [];
    for (let k = first; k <= last; k = addDays(k, 7)) {
      const list = map.get(k) || [];
      out.push({ week: k, posts: list, n: list.length, views: sum(list, p => p.views), reach: sum(list, p => p.reach), interactions: sum(list, p => p.interactions) });
    }
    return out;
  }

  function heatmap(posts) {
    const cells = WEEKDAYS.map(() => TIME_BANDS.map(() => []));
    posts.forEach(p => { if (p.band >= 0) cells[p.weekday][p.band].push(p); });
    return cells.map(row => row.map(list => ({
      n: list.length,
      avgViews: list.length ? mean(list, p => p.views) : null,
      avgEr: list.length ? median(list.map(p => p.er)) : null,
      posts: list
    })));
  }

  function hashtagStats(posts) {
    const map = new Map();
    posts.forEach(p => p.hashtags.forEach(tag => {
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(p);
    }));
    return Array.from(map.entries()).map(([tag, list]) => Object.assign({ tag }, summarize(list)))
      .sort((a, b) => b.n - a.n || b.avgViews - a.avgViews);
  }

  function keywordStats(posts) {
    const map = new Map();
    posts.forEach(p => wordsOf(p.description).forEach(w => {
      if (!map.has(w.key)) map.set(w.key, { word: w.display, posts: [] });
      map.get(w.key).posts.push(p);
    }));
    const minPosts = posts.length >= 8 ? 2 : 1;
    // Termos presentes exatamente nos mesmos posts (ex.: mesma legenda) viram um grupo
    const groups = new Map();
    Array.from(map.values()).filter(w => w.posts.length >= minPosts).forEach(w => {
      const sig = w.posts.map(p => p.id).sort().join('|');
      if (!groups.has(sig)) groups.set(sig, { words: [], posts: w.posts });
      groups.get(sig).words.push(w.word);
    });
    return Array.from(groups.values())
      .map(g => ({ word: g.words.slice(0, 3).join(', ') + (g.words.length > 3 ? '…' : ''), posts: g.posts }))
      .map(w => ({ word: w.word, n: w.posts.length, views: sum(w.posts, p => p.views), avgViews: mean(w.posts, p => p.views), er: ratio(sum(w.posts, p => p.interactions), sum(w.posts, p => p.reach)) }))
      .sort((a, b) => b.views - a.views);
  }

  const DURATION_BUCKETS = [
    { from: 0.01, to: 15, label: 'até 15s' },
    { from: 15, to: 30, label: '15–30s' },
    { from: 30, to: 60, label: '30–60s' },
    { from: 60, to: 90, label: '60–90s' },
    { from: 90, to: Infinity, label: '90s ou mais' }
  ];
  function durationStats(posts) {
    const videos = posts.filter(p => p.duration > 0);
    return DURATION_BUCKETS.map(b => {
      const list = videos.filter(p => p.duration >= b.from && p.duration < b.to);
      return list.length ? Object.assign({ label: b.label }, summarize(list)) : null;
    }).filter(Boolean);
  }

  /* ---------- Menções (@conta) ---------- */
  // O @ precisa vir no início ou depois de algo que não seja letra/número/ponto,
  // para e-mails (nome@dominio) não serem lidos como menção. Sem lookbehind de
  // propósito: lookbehind só funciona a partir do Safari 16.4.
  const MENTION_RE = /(^|[^\w.])@([A-Za-z0-9._]{1,30})/g;
  function mentionsOf(text) {
    const set = new Set();
    String(text || '').replace(MENTION_RE, (_, pre, u) => { const user = u.replace(/\.+$/, '').toLowerCase(); if (user) set.add(user); return _; });
    return Array.from(set);
  }
  // Contas mencionadas, com quantos stories/posts e o alcance médio deles
  function mentionStats(list, excludeUser) {
    const exclude = String(excludeUser || '').toLowerCase();
    const map = new Map();
    list.forEach(p => mentionsOf(p.description).forEach(u => {
      if (u === exclude) return;
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(p);
    }));
    return Array.from(map.entries()).map(([user, items]) => ({
      user, n: items.length, avgReach: mean(items, p => p.reach), views: sum(items, p => p.views), last: Math.max(...items.map(p => p.ts))
    })).sort((a, b) => b.n - a.n || b.avgReach - a.avgReach);
  }

  /* ---------- Stories ---------- */
  function summarizeStories(stories) {
    const days = new Set(stories.map(p => p.dateKey));
    const t = {
      n: stories.length,
      activeDays: days.size,
      views: sum(stories, p => p.views), reach: sum(stories, p => p.reach),
      replies: sum(stories, p => p.replies), likes: sum(stories, p => p.likes),
      shares: sum(stories, p => p.shares), stickerTaps: sum(stories, p => p.stickerTaps),
      navigation: sum(stories, p => p.navigation), profileVisits: sum(stories, p => p.profileVisits),
      follows: sum(stories, p => p.follows), linkClicks: sum(stories, p => p.linkClicks)
    };
    t.avgViews = ratio(t.views, t.n);
    t.avgReach = ratio(t.reach, t.n);
    t.medianReach = median(stories.map(p => p.reach));
    t.perActiveDay = ratio(t.n, t.activeDays);
    t.repliesPer1k = t.reach > 0 ? (t.replies / t.reach) * 1000 : null;
    return t;
  }

  // Alcance por story conforme a quantidade de stories publicados no mesmo dia
  const STORY_DAY_BUCKETS = [
    { from: 1, to: 1, label: '1 story no dia', short: '1 story' },
    { from: 2, to: 3, label: '2–3 stories', short: '2 a 3 stories' },
    { from: 4, to: 6, label: '4–6 stories', short: '4 a 6 stories' },
    { from: 7, to: Infinity, label: '7 ou mais', short: '7 ou mais stories' }
  ];
  function storyDayStats(stories) {
    const perDay = new Map();
    stories.forEach(p => perDay.set(p.dateKey, (perDay.get(p.dateKey) || 0) + 1));
    return STORY_DAY_BUCKETS.map(b => {
      const list = stories.filter(p => { const c = perDay.get(p.dateKey); return c >= b.from && c <= b.to; });
      if (!list.length) return null;
      return { label: b.label, short: b.short, from: b.from, stories: list.length, days: new Set(list.map(p => p.dateKey)).size,
        avgReach: mean(list, p => p.reach), medianReach: median(list.map(p => p.reach)), avgViews: mean(list, p => p.views) };
    }).filter(Boolean);
  }

  function fillDaily(points, from, to) {
    const map = new Map(points.map(p => [p.date, p.value]));
    if (!from || !to || from > to) return points.slice();
    const out = [];
    for (let k = from; k <= to; k = addDays(k, 1)) out.push({ date: k, value: map.get(k) || 0 });
    return out;
  }

  /* ---------- Evolução (gráfico de linhas) ----------
     Séries por dia ou por bloco de 7 dias, do período atual e do anterior
     (alinhados pela posição: dia 1 com dia 1). Métricas de posts e stories
     são somadas pelo DIA DE PUBLICAÇÃO (os exports trazem o total de cada
     publicação, não o dia a dia); seguidores vêm do export de público, que é
     diário de verdade.

     input: { range:{start,end}, prev:{start,end}|null, posts, prevPosts,
              stories, prevStories, audienceFollowers:[{date,value}]|null,
              followerTotal:{total,date}|null } */
  const pubSum = f => b => sum(b.posts, p => p[f]) + sum(b.stories, p => p[f]);
  const feedSum = f => b => sum(b.posts, p => p[f]);
  const EVOLUTION_METRICS = [
    { key: 'views', label: 'Visualizações', src: 'pub', value: pubSum('views'),
      desc: 'Visualizações das publicações (feed + stories), somadas pelo dia de publicação.' },
    { key: 'reach', label: 'Alcance somado', src: 'pub', value: pubSum('reach'),
      desc: 'Alcance de cada publicação (feed + stories), somado pelo dia de publicação. A mesma conta pode ser contada em mais de uma publicação.' },
    { key: 'interactions', label: 'Interações', src: 'feed', value: feedSum('interactions'),
      desc: 'Curtidas, comentários, compartilhamentos e salvamentos dos posts do feed, pelo dia de publicação.' },
    { key: 'likes', label: 'Curtidas', src: 'feed', value: feedSum('likes'), desc: 'Curtidas dos posts do feed, pelo dia de publicação.' },
    { key: 'comments', label: 'Comentários', src: 'feed', value: feedSum('comments'), desc: 'Comentários dos posts do feed, pelo dia de publicação.' },
    { key: 'shares', label: 'Compartilhamentos', src: 'feed', value: feedSum('shares'), desc: 'Compartilhamentos dos posts do feed, pelo dia de publicação.' },
    { key: 'saves', label: 'Salvamentos', src: 'feed', value: feedSum('saves'), desc: 'Salvamentos dos posts do feed, pelo dia de publicação.' },
    { key: 'er', label: 'Taxa de engajamento', src: 'feed', rate: true, needs: b => b.posts.length,
      value: b => ratio(sum(b.posts, p => p.interactions), sum(b.posts, p => p.reach)),
      desc: 'Interações ÷ alcance dos posts do feed publicados em cada dia. Dias sem post ficam sem ponto.' },
    { key: 'profileVisits', label: 'Visitas ao perfil', src: 'pub', value: pubSum('profileVisits'),
      desc: 'Visitas ao perfil vindas das publicações (feed + stories), pelo dia de publicação.' },
    { key: 'newFollowers', label: 'Novos seguidores', src: 'audience', value: b => sum(b.followers),
      desc: 'Seguidores ganhos por dia, segundo o export de público (todas as origens).' },
    { key: 'followers', label: 'Seguidores', src: 'total', last: true, value: b => b.total,
      desc: 'Total de seguidores ao fim de cada dia: o total informado menos os ganhos depois de cada data (export de público). Estimativa: não considera quem deixou de seguir.' },
    { key: 'pubFollows', label: 'Seguidores via publicações', src: 'pub', noAudience: true, value: pubSum('follows'),
      desc: 'Contas que começaram a seguir a partir de um post ou story, pelo dia de publicação. Carregue o export de público para ver todos os novos seguidores.' },
    { key: 'publications', label: 'Publicações', src: 'pub', integer: true, value: b => b.posts.length + b.stories.length,
      desc: 'Quantidade de posts do feed e stories publicados.' }
  ];

  // Gráfico da seção do feed: só posts do feed (respeita o filtro de formato)
  const FEED_EVOLUTION_METRICS = [
    { key: 'views', label: 'Visualizações', src: 'feed', value: feedSum('views'), desc: 'Visualizações dos posts do feed, somadas pelo dia de publicação.' },
    { key: 'reach', label: 'Alcance somado', src: 'feed', value: feedSum('reach'),
      desc: 'Alcance de cada post do feed, somado pelo dia de publicação. A mesma conta pode ser contada em mais de um post.' },
    { key: 'interactions', label: 'Interações', src: 'feed', value: feedSum('interactions'), desc: 'Curtidas, comentários, compartilhamentos e salvamentos dos posts do feed, pelo dia de publicação.' },
    { key: 'likes', label: 'Curtidas', src: 'feed', value: feedSum('likes'), desc: 'Curtidas dos posts do feed, pelo dia de publicação.' },
    { key: 'comments', label: 'Comentários', src: 'feed', value: feedSum('comments'), desc: 'Comentários dos posts do feed, pelo dia de publicação.' },
    { key: 'shares', label: 'Compartilhamentos', src: 'feed', value: feedSum('shares'), desc: 'Compartilhamentos dos posts do feed, pelo dia de publicação.' },
    { key: 'saves', label: 'Salvamentos', src: 'feed', value: feedSum('saves'), desc: 'Salvamentos dos posts do feed, pelo dia de publicação.' },
    EVOLUTION_METRICS.find(m => m.key === 'er'),
    { key: 'profileVisits', label: 'Visitas ao perfil', src: 'feed', value: feedSum('profileVisits'), desc: 'Visitas ao perfil vindas dos posts do feed, pelo dia de publicação.' },
    { key: 'follows', label: 'Seguidores', src: 'feed', value: feedSum('follows'), desc: 'Contas que começaram a seguir a partir de um post do feed, pelo dia de publicação.' },
    { key: 'publications', label: 'Posts publicados', src: 'feed', integer: true, value: b => b.posts.length, desc: 'Quantidade de posts publicados no feed.' }
  ];

  // Gráfico da seção de stories: só stories, com as métricas próprias deles
  const storySum = f => b => sum(b.stories, p => p[f]);
  const STORY_EVOLUTION_METRICS = [
    { key: 'views', label: 'Visualizações', src: 'story', value: storySum('views'), desc: 'Visualizações dos stories, somadas pelo dia de publicação.' },
    { key: 'reach', label: 'Alcance somado', src: 'story', value: storySum('reach'),
      desc: 'Alcance de cada story, somado pelo dia de publicação. A mesma conta pode ser contada em mais de um story.' },
    { key: 'avgReach', label: 'Alcance por story', src: 'story', rate: false, needs: b => b.stories.length,
      value: b => ratio(sum(b.stories, p => p.reach), b.stories.length), desc: 'Alcance médio de cada story publicado no dia. Dias sem story ficam sem ponto.' },
    { key: 'replies', label: 'Respostas', src: 'story', value: storySum('replies'), desc: 'Respostas aos stories, pelo dia de publicação.' },
    { key: 'likes', label: 'Curtidas', src: 'story', value: storySum('likes'), desc: 'Curtidas dos stories, pelo dia de publicação.' },
    { key: 'shares', label: 'Compartilhamentos', src: 'story', value: storySum('shares'), desc: 'Compartilhamentos dos stories, pelo dia de publicação.' },
    { key: 'stickerTaps', label: 'Toques em figurinhas', src: 'story', value: storySum('stickerTaps'), desc: 'Toques em figurinhas (enquetes, links, menções etc.) dos stories, pelo dia de publicação.' },
    { key: 'linkClicks', label: 'Cliques no link', src: 'story', value: storySum('linkClicks'), desc: 'Cliques no link dos stories, pelo dia de publicação.' },
    { key: 'profileVisits', label: 'Visitas ao perfil', src: 'story', value: storySum('profileVisits'), desc: 'Visitas ao perfil vindas dos stories, pelo dia de publicação.' },
    { key: 'follows', label: 'Seguidores', src: 'story', value: storySum('follows'), desc: 'Contas que começaram a seguir a partir de um story, pelo dia de publicação.' },
    { key: 'navigation', label: 'Navegação', src: 'story', value: storySum('navigation'), desc: 'Avançar, voltar, sair e próximo story, pelo dia de publicação.' },
    { key: 'publications', label: 'Stories publicados', src: 'story', integer: true, value: b => b.stories.length, desc: 'Quantidade de stories publicados.' }
  ];

  // Escopos: "all" = resumo (feed + stories e seguidores), "feed" e "stories" = seções
  const EVOLUTION_SCOPES = { all: EVOLUTION_METRICS, feed: FEED_EVOLUTION_METRICS, stories: STORY_EVOLUTION_METRICS };
  const metricOf = (scope, key) => (EVOLUTION_SCOPES[scope] || EVOLUTION_METRICS).find(m => m.key === key);

  function dayKeys(r) {
    const out = [];
    for (let k = r.start; k <= r.end; k = addDays(k, 1)) out.push(k);
    return out;
  }

  // Total de seguidores ao fim de cada dia, a partir do total informado numa data:
  // total(d) = total informado + ganhos entre a data informada e d (negativos se d vem antes)
  function followerTotalsByDay(audienceFollowers, followerTotal) {
    const gains = new Map((audienceFollowers || []).map(p => [p.date, p.value || 0]));
    const dates = Array.from(gains.keys()).sort();
    const cumUntil = k => { let s = 0; for (const d of dates) { if (d > k) break; s += gains.get(d); } return s; };
    const base = followerTotal.total - cumUntil(followerTotal.date);
    return k => base + cumUntil(k);
  }

  // Dias de um período, com as publicações e os seguidores de cada dia
  function evolutionDays(r, posts, stories, input) {
    const byDay = (list) => { const m = new Map(); list.forEach(p => { if (!m.has(p.dateKey)) m.set(p.dateKey, []); m.get(p.dateKey).push(p); }); return m; };
    const pd = byDay(posts), sd = byDay(stories);
    const aud = (input.audienceFollowers || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const gains = new Map(aud.map(p => [p.date, p.value || 0]));
    // O export de público omite dias sem ganho: dentro da cobertura dele, dia ausente = 0
    const covers = k => aud.length > 0 && k >= aud[0].date && k <= aud[aud.length - 1].date;
    const totalAt = input.followerTotal && aud.length ? followerTotalsByDay(aud, input.followerTotal) : null;
    return dayKeys(r).map(k => ({
      start: k, end: k, posts: pd.get(k) || [], stories: sd.get(k) || [],
      followers: covers(k) ? [gains.get(k) || 0] : [], hasAudience: covers(k),
      total: totalAt ? totalAt(k) : null
    }));
  }

  // Blocos de 7 dias contados a partir do FIM do período: a semana mais recente fica
  // completa e o bloco incompleto (se houver) é o primeiro. Os dois períodos têm o
  // mesmo tamanho, então os blocos do atual e do anterior se alinham.
  function groupWeeks(days) {
    const out = [];
    for (let end = days.length; end > 0; end -= 7) {
      const chunk = days.slice(Math.max(0, end - 7), end);
      out.unshift({
        start: chunk[0].start, end: chunk[chunk.length - 1].end, days: chunk.length,
        posts: [].concat(...chunk.map(d => d.posts)), stories: [].concat(...chunk.map(d => d.stories)),
        followers: [].concat(...chunk.map(d => d.followers)), hasAudience: chunk.some(d => d.hasAudience),
        total: chunk[chunk.length - 1].total
      });
    }
    return out;
  }

  // Métricas com dado no período atual (as outras não aparecem como opção)
  function evolutionMetrics(input, scope) {
    const hasAudience = !!(input.audienceFollowers && input.audienceFollowers.length);
    const days = evolutionDays(input.range, input.posts, input.stories, input);
    return (EVOLUTION_SCOPES[scope] || EVOLUTION_METRICS).filter(m => {
      if (m.src === 'audience') return days.some(d => d.hasAudience);
      // Total que daria negativo em algum dia = total digitado errado (ex.: "5" em vez de "5.189")
      if (m.src === 'total') return hasAudience && !!input.followerTotal && days.some(d => d.hasAudience) && days.every(d => !d.hasAudience || d.total >= 0);
      if (m.noAudience && hasAudience) return false;
      if (m.src === 'feed' && !input.posts.length) return false;
      if (m.src === 'story' && !input.stories.length) return false;
      return days.some(d => { const v = m.value(d); return v != null && v > 0; });
    });
  }

  // { points:[{start,end,days,value,n}], prev:[...]|null } — n = publicações no bloco
  function evolution(input, key, grain, scope) {
    const m = metricOf(scope, key);
    const build = (r, posts, stories) => {
      let blocks = evolutionDays(r, posts, stories, input);
      if (grain === 'week') blocks = groupWeeks(blocks);
      return blocks.map(b => {
        const noData = (m.src === 'audience' || m.src === 'total') ? !b.hasAudience
          : (m.needs ? !m.needs(b) : false); // médias e taxas: sem publicação no dia = sem ponto
        let value = noData ? null : m.value(b);
        if (value != null && (!Number.isFinite(value) || (m.src === 'total' && value < 0))) value = null;
        return { start: b.start, end: b.end, days: b.days || 1, posts: b.posts.length, stories: b.stories.length, value };
      });
    };
    const points = build(input.range, input.posts, input.stories);
    let prev = null;
    if (input.prev) {
      const pp = input.prevPosts || [], ps = input.prevStories || [];
      const srcOk = m.src === 'feed' ? pp.length > 0
        : m.src === 'story' ? ps.length > 0
        : m.src === 'pub' ? pp.length + ps.length > 0
        : true; // público/total: depende de o export cobrir o período anterior
      if (srcOk) {
        prev = build(input.prev, pp, ps).slice(0, points.length);
        if (!prev.some(p => p.value != null)) prev = null;
      }
    }
    return { metric: m, points, prev };
  }

  IGR.metrics = {
    FORMATS, FORMAT, WEEKDAYS, WEEKDAYS_SHORT, MONTHS_SHORT, TIME_BANDS, fmt,
    EVOLUTION_METRICS, EVOLUTION_SCOPES, evolution, evolutionMetrics,
    keyToDate, addDays, daysBetween, weekStart,
    sum, mean, median, ratio,
    hashtagsOf, wordsOf, enrich, summarize, byFormat, concentration, weekly, heatmap,
    hashtagStats, keywordStats, durationStats, fillDaily, summarizeStories, storyDayStats, mentionsOf, mentionStats
  };
})(window);
