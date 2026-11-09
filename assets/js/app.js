/* ==========================================================================
   IGR.app — orquestração do relatório
   --------------------------------------------------------------------------
   API pública (ver README):
     IGR.app.init(rootEl, { persist: true, owner: 'usuario', hub: { url, tipo, cliente } })
     IGR.app.setOwner('usuario')               → troca a dona da conta e re-renderiza
     IGR.app.setFollowers(12345, '2026-09-30')  → total de seguidores do perfil (não vem nos exports)
     IGR.app.loadFiles(FileList | File[])      → Promise
     IGR.app.loadText(nomeArquivo, conteudo)   → carrega export já lido como texto
     IGR.app.clear()
     IGR.app.getModel()                        → dados filtrados + métricas atuais
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR;
  const C = IGR.charts, M = IGR.metrics, P = IGR.parsers, I = IGR.insights;
  const { html } = C;
  const { fmt } = M;

  const STORAGE_KEY = 'igr:v1:files';
  const THEME_KEY = 'igr:v1:theme';
  const HUB_NAMES_KEY = 'igr:v1:hub-clientes'; // { usuario: nome da cliente no Hub de Relatórios }
  const FOLLOWERS_KEY = 'igr:v1:seguidores';    // { usuario: { total, date } } — total informado à mão

  const state = {
    root: null,
    persist: true,
    files: [],      // { id, name, kind, loadedAt, data, error }
    ownerFixed: null, // @ da dona informado pela ferramenta (prevalece sobre o seletor)
    filters: { owner: '', period: 'all', from: '', to: '', formats: [] },
    top: { sort: 'views', order: 'top' },
    storySort: 'reach',
    // Gráficos de evolução (resumo, feed e stories): métrica e agrupamento escolhidos em cada um
    evo: { all: { metric: 'views', grain: null }, feed: { metric: 'views', grain: null }, stories: { metric: 'views', grain: null } },
    search: '',
    model: null,
    hub: null       // config de envio ao Hub de Relatórios passada no init()
  };

  const $ = sel => state.root.querySelector(sel);

  /* ---------- Armazenamento local (conveniência — falha em silêncio) ---------- */
  function save() {
    if (!state.persist) return;
    try {
      const files = state.files.filter(f => !f.error).map(f => ({ id: f.id, name: f.name, kind: f.kind, loadedAt: f.loadedAt, data: f.data }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, filters: state.filters }));
    } catch (e) { /* quota / modo privado */ }
  }
  function restore() {
    if (!state.persist) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.files = (saved.files || []).filter(f => f && f.data && f.kind);
      if (saved.filters) Object.assign(state.filters, saved.filters);
    } catch (e) { /* ignora */ }
  }

  /* ---------- Carga de arquivos ---------- */
  function addParsed(name, data) {
    // Reenviar um arquivo com o mesmo nome substitui o anterior
    state.files = state.files.filter(f => !(f.name === name && f.kind === data.kind));
    state.files.push({ id: name + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 7), name, kind: data.kind, loadedAt: Date.now(), data });
  }

  function loadFiles(list) {
    const files = Array.from(list || []).filter(f => /\.(csv|txt)$/i.test(f.name) || /csv|text/.test(f.type));
    if (!files.length) { toast('Selecione arquivos .csv exportados do Meta Business Suite.'); return Promise.resolve(); }
    return Promise.all(files.map(f => P.readFile(f).then(
      data => ({ name: f.name, data }),
      err => ({ name: f.name, error: err.message || String(err) })
    ))).then(results => {
      const errors = [];
      results.forEach(r => (r.error ? errors.push(r) : addParsed(r.name, r.data)));
      errors.forEach(e => state.files.push({ id: 'err:' + e.name + Date.now(), name: e.name, kind: 'erro', error: e.error, loadedAt: Date.now() }));
      const ok = results.length - errors.length;
      if (ok) toast(ok + (ok > 1 ? ' arquivos carregados.' : ' arquivo carregado.'));
      save();
      render();
    });
  }

  function loadText(name, text) {
    addParsed(name, P.parseText(name, text));
    save();
    render();
  }

  function clear() {
    state.files = [];
    state.filters = { owner: '', period: 'all', from: '', to: '', formats: [] };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignora */ }
    render();
  }

  /* ---------- Modelo de dados ---------- */
  function buildDataset() {
    const postFiles = state.files.filter(f => f.kind === 'posts').sort((a, b) => a.loadedAt - b.loadedAt);
    const byId = new Map();
    // Mesmo post em exports diferentes: mantém a versão com mais visualizações
    // (métricas vitalícias só crescem — a versão maior é a mais recente).
    postFiles.forEach(f => f.data.posts.forEach(p => {
      const cur = byId.get(p.id);
      if (!cur || p.views > cur.views || (p.views === cur.views && p.reach >= cur.reach)) byId.set(p.id, p);
    }));
    const posts = Array.from(byId.values()).map(M.enrich).sort((a, b) => a.ts - b.ts);

    const accountMap = new Map();
    posts.forEach(p => {
      if (!accountMap.has(p.accountId)) accountMap.set(p.accountId, { id: p.accountId, username: p.username, name: p.accountName, n: 0 });
      accountMap.get(p.accountId).n++;
    });
    const accounts = Array.from(accountMap.values()).sort((a, b) => b.n - a.n);

    // Posts da dona formam o relatório; posts de outras contas são collabs
    // em que ela foi convidada (o export traz o @ de quem criou o post).
    const owner = resolveOwner(accounts);
    const isOwn = p => owner.account && p.accountId === owner.account.id;

    const audienceFiles = state.files.filter(f => f.kind === 'audience');
    const dates = [];
    postFiles.forEach(f => { if (f.data.period) dates.push(f.data.period.start, f.data.period.end); });
    audienceFiles.forEach(f => { if (f.data.period) dates.push(f.data.period.start, f.data.period.end); });
    posts.forEach(p => dates.push(p.dateKey));
    dates.sort();

    // Stories têm métricas e dinâmica próprias: ficam fora do feed, em seção separada
    const isStory = p => p.format.key === 'story';
    return {
      posts: posts.filter(p => isOwn(p) && !isStory(p)),
      stories: posts.filter(p => isOwn(p) && isStory(p)),
      collabs: posts.filter(p => !isOwn(p)),
      accounts,
      owner,
      audienceFiles,
      bounds: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
    };
  }

  const normUser = s => String(s || '').trim().replace(/^@+/, '').toLowerCase();

  // Dona da conta: o @ informado pela ferramenta prevalece. No modo avulso,
  // vale a escolha do seletor ou, por padrão, a conta com mais posts.
  function resolveOwner(accounts) {
    if (state.ownerFixed) {
      const account = accounts.find(a => normUser(a.username) === state.ownerFixed) || null;
      return { account, username: account ? account.username : state.ownerFixed, fixed: true, missing: !account && accounts.length > 0 };
    }
    const picked = accounts.find(a => a.id === state.filters.owner);
    const account = picked || accounts[0] || null;
    return { account, username: account ? account.username : '', fixed: false, auto: !picked, missing: false };
  }

  function mergeAudience(files) {
    if (!files.length) return null;
    const sorted = files.slice().sort((a, b) =>
      ((a.data.range && a.data.range.end) || '').localeCompare((b.data.range && b.data.range.end) || '') || a.loadedAt - b.loadedAt);
    const followers = new Map();
    const series = new Map();
    sorted.forEach(f => {
      (f.data.followers || []).forEach(p => followers.set(p.date, p.value));
      (f.data.series || []).forEach(s => {
        if (!series.has(s.title)) series.set(s.title, new Map());
        s.points.forEach(p => series.get(s.title).set(p.date, p.value));
      });
    });
    const latest = field => {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const v = sorted[i].data[field];
        if (v && (!Array.isArray(v) || v.length) && (!v.rows || v.rows.length)) return v;
      }
      return null;
    };
    const toPoints = map => Array.from(map.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
    return {
      followers: followers.size ? toPoints(followers) : null,
      series: Array.from(series.entries()).map(([title, map]) => ({ title, points: toPoints(map) })),
      ageGender: latest('ageGender'),
      countries: latest('countries'),
      cities: latest('cities'),
      pages: latest('pages'),
      other: [].concat(...sorted.map(f => f.data.other || [])),
      files: sorted.map(f => f.name)
    };
  }

  function currentRange(bounds) {
    const f = state.filters;
    if (!bounds) return null;
    const { start, end } = bounds;
    if (f.period === 'custom' && (f.from || f.to)) {
      let s = f.from || start, e = f.to || end;
      if (s > e) [s, e] = [e, s]; // "De" depois de "Até": inverte em vez de esvaziar o relatório
      const len = M.daysBetween(s, e) + 1;
      return { start: s, end: e, prev: len > 0 ? { start: M.addDays(s, -len), end: M.addDays(s, -1) } : null };
    }
    const n = parseInt(f.period, 10);
    if (n > 0) {
      const s = M.addDays(end, -(n - 1));
      return { start: s < start ? start : s, end, prev: { start: M.addDays(s, -n), end: M.addDays(s, -1) } };
    }
    return { start, end, prev: null };
  }

  function filterPosts(posts, range) {
    const f = state.filters;
    return posts.filter(p =>
      (!range || (p.dateKey >= range.start && p.dateKey <= range.end)) &&
      (!f.formats.length || f.formats.includes(p.format.key)));
  }

  function buildModel() {
    const ds = buildDataset();
    // O filtro de formato é do feed da dona: descarta formatos que ela não tem
    // (ex.: filtro salvo de outro export), para não esvaziar o relatório.
    const ownFormats = new Set(ds.posts.map(p => p.format.key));
    state.filters.formats = state.filters.formats.filter(k => ownFormats.has(k));
    const range = currentRange(ds.bounds);
    const posts = filterPosts(ds.posts, range);
    const prevPosts = range && range.prev ? filterPosts(ds.posts, range.prev) : [];
    // Collabs e stories: só o filtro de período (o filtro de formato vale para o feed)
    const inRange = (list, r) => (r ? list.filter(p => p.dateKey >= r.start && p.dateKey <= r.end) : list);
    const collabs = inRange(ds.collabs, range);
    const stories = inRange(ds.stories, range);
    const prevStories = range && range.prev ? inRange(ds.stories, range.prev) : [];
    const audience = mergeAudience(ds.audienceFiles);
    let followers = null;
    if (audience && audience.followers && range) {
      const pts = audience.followers.filter(p => p.date >= range.start && p.date <= range.end);
      if (pts.length) {
        const first = audience.followers[0].date, last = audience.followers[audience.followers.length - 1].date;
        followers = M.fillDaily(pts, range.start > first ? range.start : first, range.end < last ? range.end : last);
      }
    }
    const summary = M.summarize(posts);
    const prevSummary = prevPosts.length ? M.summarize(prevPosts) : null;
    const formats = M.byFormat(posts);
    const collabSummary = M.summarize(collabs);
    const storySummary = M.summarizeStories(stories);
    const prevStorySummary = prevStories.length ? M.summarizeStories(prevStories) : null;
    const model = { ds, range, posts, prevPosts, summary, prevSummary, formats, audience, followers, collabs, collabSummary, stories, prevStories, storySummary, prevStorySummary };
    model.insights = I.generate(model);
    return model;
  }

  /* ---------- Componentes ---------- */
  function card(opts) {
    const body = html('div', { class: 'igr-card-body' });
    const tableBox = html('div', { class: 'igr-card-table', hidden: true });
    const actions = html('div', { class: 'igr-card-actions' }, opts.actions || []);
    let tableFn = null;
    if (opts.table !== false) {
      const btn = html('button', { type: 'button', class: 'igr-link-btn', 'aria-pressed': 'false', text: 'Ver tabela' });
      btn.addEventListener('click', () => {
        const showTable = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(showTable));
        btn.textContent = showTable ? 'Ver gráfico' : 'Ver tabela';
        body.hidden = showTable;
        tableBox.hidden = !showTable;
        if (showTable && tableFn) tableFn(tableBox);
      });
      actions.appendChild(btn);
    }
    const el = html('article', { class: 'igr-card span-' + (opts.span || 'full') + (opts.cls ? ' ' + opts.cls : '') }, [
      html('header', { class: 'igr-card-head' }, [
        html('div', { class: 'igr-card-titles' }, [
          html('h3', { class: 'igr-card-title', text: opts.title }),
          opts.subtitle ? html('p', { class: 'igr-card-sub', text: opts.subtitle }) : null
        ]),
        actions
      ]),
      body,
      tableBox,
      opts.footnote ? html('p', { class: 'igr-footnote', text: opts.footnote }) : null
    ]);
    return {
      el, body,
      table(columns, rows, options) {
        tableFn = box => C.table(box, columns, rows, Object.assign({ compact: true }, options));
        if (!tableBox.hidden) { tableBox.textContent = ''; tableFn(tableBox); } // tabela aberta: acompanha a troca de dados
      }
    };
  }

  function formatTag(f) {
    return html('span', { class: 'igr-format-tag' }, [html('span', { class: 'igr-swatch igr-swatch-rect', style: { background: f.color } }), f.single]);
  }

  // Link para o post. Revalida o endereço (dados salvos no navegador antes da validação do parser).
  function igLink(p, text) {
    const url = P.safeUrl(p.permalink);
    return url ? html('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'igr-link', 'aria-label': 'Abrir no Instagram', text }) : null;
  }

  // Texto com **destaques** como nós de texto (sem innerHTML)
  function richText(tag, text, cls) {
    const el = html(tag, { class: cls });
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(part => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) el.appendChild(html('strong', { text: part.slice(2, -2) }));
      else el.appendChild(document.createTextNode(part));
    });
    return el;
  }

  function delta(cur, prev, opts) {
    opts = opts || {};
    if (cur == null || prev == null) return null;
    let v, label;
    if (opts.points) { v = cur - prev; label = (Math.abs(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.'; }
    else { if (!prev) return null; v = (cur - prev) / prev; label = fmt.pct(Math.abs(v), Math.abs(v) < 0.1 ? 1 : 0); }
    if (Math.abs(v) < 0.0005) return html('span', { class: 'igr-delta is-flat' }, ['= estável vs período anterior']);
    const up = v > 0;
    return html('span', { class: 'igr-delta ' + (up ? 'is-up' : 'is-down') }, [
      html('span', { 'aria-hidden': 'true', text: up ? '▲ ' : '▼ ' }),
      (up ? '+' : '−') + label + ' vs período anterior'
    ]);
  }

  function toggleNav(sel, show) { const a = $(sel); if (a) a.hidden = !show; }

  // Seções são opcionais: quem integra pode remover qualquer <section> do HTML.
  // section() devolve null quando a seção (ou a sua .igr-grid) não existe.
  function section(id) {
    const s = $('#' + id), grid = s && s.querySelector('.igr-grid');
    if (!grid) return null;
    grid.textContent = '';
    return { s, grid };
  }
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
  const setHidden = (sel, hidden) => { const el = $(sel); if (el) el.hidden = hidden; };

  function callout(text, tone) {
    return html('div', { class: 'igr-callout' + (tone ? ' is-' + tone : '') }, [richText('p', text)]);
  }

  /* ---------- Render: cabeçalho, arquivos, filtros ---------- */
  function renderHeader(model) {
    const { ds, range, summary } = model;
    const acc = ds.owner.account;
    setText('#igr-title', acc ? (acc.name || '@' + acc.username) : ds.owner.username ? '@' + ds.owner.username : 'Desempenho no Instagram');
    const parts = [];
    if (ds.owner.username) parts.push('@' + ds.owner.username);
    if (range) parts.push(fmt.dayKey(range.start) + ' a ' + fmt.dayKey(range.end));
    parts.push(fmt.int(summary.n) + (summary.n === 1 ? ' post no feed' : ' posts no feed'));
    if (model.storySummary.n) parts.push(fmt.int(model.storySummary.n) + (model.storySummary.n === 1 ? ' story' : ' stories'));
    setText('#igr-subtitle', parts.join(' · '));
    setText('#igr-generated', 'Gerado em ' + fmt.date(Date.now()) + ' a partir de ' + state.files.filter(f => !f.error).length + ' arquivo(s) do Meta Business Suite');
    renderHubClient(model);
  }

  function renderFiles(model) {
    const box = $('#igr-files');
    if (!box) return;
    box.textContent = '';
    if (!state.files.length) { box.hidden = true; return; }
    box.hidden = false;
    state.files.forEach(f => {
      const kindLabel = f.kind === 'posts' ? 'Conteúdos' : f.kind === 'audience' ? 'Público' : 'Erro';
      // Conta posts e stories separadamente (o export de stories é um export de conteúdos)
      const countLabel = list => {
        const nStories = list.filter(p => p.type === 'story').length, nPosts = list.length - nStories;
        return [nPosts ? nPosts + (nPosts === 1 ? ' post' : ' posts') : '', nStories ? nStories + (nStories === 1 ? ' story' : ' stories') : '']
          .filter(Boolean).join(' · ');
      };
      const detail = f.error ? f.error
        : f.kind === 'posts' ? countLabel(f.data.posts) + (f.data.period ? ' · ' + fmt.dayKeyShort(f.data.period.start) + '–' + fmt.dayKeyShort(f.data.period.end) : '')
          : (f.data.range ? fmt.dayKeyShort(f.data.range.start) + '–' + fmt.dayKeyShort(f.data.range.end) : 'snapshot');
      const chip = html('div', { class: 'igr-file' + (f.error ? ' is-error' : '') }, [
        html('span', { class: 'igr-file-kind', text: kindLabel }),
        html('span', { class: 'igr-file-name', text: f.name, title: f.name }),
        html('span', { class: 'igr-file-detail', text: detail })
      ]);
      chip.appendChild(html('button', {
        type: 'button', class: 'igr-file-remove', 'aria-label': 'Remover ' + f.name, text: '×',
        onclick: () => { state.files = state.files.filter(x => x !== f); save(); render(); }
      }));
      box.appendChild(chip);
    });
    box.appendChild(html('button', { type: 'button', class: 'igr-link-btn', text: 'Limpar tudo', onclick: () => { if (confirm('Remover todos os arquivos carregados?')) clear(); } }));
  }

  function renderFilters(model) {
    const box = $('#igr-filters');
    if (!box) return;
    box.textContent = '';
    const { ds, range } = model;
    const f = state.filters;
    // <label> só para um controle único; um grupo de botões fica em <div>,
    // senão o clique no rótulo aciona o primeiro botão do grupo.
    const field = (label, control, isGroup) => html(isGroup ? 'div' : 'label', { class: 'igr-field' }, [html('span', { class: 'igr-field-label', text: label }), control]);

    // Só no modo avulso: dentro da ferramenta a dona vem do @ informado na integração
    if (!ds.owner.fixed && ds.accounts.length > 1) {
      const sel = html('select', { class: 'igr-select' }, ds.accounts.map(a =>
        html('option', { value: a.id, text: '@' + a.username + ' · ' + a.n + (a.n === 1 ? ' post' : ' posts') })));
      sel.value = ds.owner.account ? ds.owner.account.id : '';
      sel.addEventListener('change', () => { f.owner = sel.value; save(); render(); });
      const ownerField = field('Dona da conta', sel);
      if (ds.owner.auto) ownerField.appendChild(html('span', { class: 'igr-field-hint', text: 'Automático: conta com mais posts' }));
      box.appendChild(ownerField);
    }

    const period = html('select', { class: 'igr-select' }, [
      ['all', 'Todo o período'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['custom', 'Personalizado']
    ].map(([v, t]) => html('option', { value: v, text: t })));
    period.value = f.period;
    period.addEventListener('change', () => {
      f.period = period.value;
      if (f.period === 'custom' && !f.from && range) { f.from = range.start; f.to = range.end; }
      save(); render();
    });
    box.appendChild(field('Período', period));

    if (f.period === 'custom' && ds.bounds) {
      const mk = key => {
        const inp = html('input', { type: 'date', class: 'igr-input', value: f[key] || '', min: ds.bounds.start, max: ds.bounds.end });
        inp.addEventListener('change', () => { f[key] = inp.value; save(); render(); });
        return inp;
      };
      box.appendChild(field('De', mk('from')));
      box.appendChild(field('Até', mk('to')));
    }

    // Só os formatos do feed da dona (collabs e stories não entram neste filtro)
    const present = M.FORMATS.filter(x => ds.posts.some(p => p.format.key === x.key));
    if (present.length > 1) {
      const group = html('div', { class: 'igr-chips', role: 'group', 'aria-label': 'Formatos' }, present.map(x => {
        const active = !f.formats.length || f.formats.includes(x.key);
        const b = html('button', { type: 'button', class: 'igr-chip' + (active ? ' is-active' : ''), 'aria-pressed': String(active) }, [
          html('span', { class: 'igr-swatch igr-swatch-rect', style: { background: x.color } }), x.label
        ]);
        b.addEventListener('click', () => {
          let sel = f.formats.length ? f.formats.slice() : present.map(p => p.key);
          sel = sel.includes(x.key) ? sel.filter(k => k !== x.key) : sel.concat(x.key);
          f.formats = sel.length === present.length || !sel.length ? [] : sel;
          save(); render();
        });
        return b;
      }));
      box.appendChild(field('Formato do feed', group, true));
    }

    if (range && range.prev && (model.prevSummary || model.prevStorySummary)) {
      box.appendChild(html('p', { class: 'igr-compare-note', text: 'Variações comparadas a ' + fmt.dayKey(range.prev.start) + ' – ' + fmt.dayKey(range.prev.end) }));
    }
  }

  /* ---------- Render: resumo ---------- */
  function renderSummary(model) {
    const sec = section('igr-sec-summary');
    if (!sec) return;
    const { grid } = sec;
    const { summary: s, prevSummary: p, followers, range, posts } = model;

    // Insights
    if (model.insights.length) {
      const list = html('div', { class: 'igr-insights' }, model.insights.map(it => html('article', { class: 'igr-insight is-' + it.tone }, [
        html('div', { class: 'igr-insight-tone' }, [html('span', { class: 'igr-insight-icon', 'aria-hidden': 'true', text: { destaque: '★', oportunidade: '↗', atencao: '!', contexto: 'i' }[it.tone] }),
          { destaque: 'Destaque', oportunidade: 'Oportunidade', atencao: 'Atenção', contexto: 'Contexto' }[it.tone]]),
        html('h4', { text: it.title }),
        richText('p', it.text)
      ])));
      const c = card({ title: 'Principais leituras', subtitle: 'Geradas automaticamente a partir dos dados filtrados', table: false });
      c.body.appendChild(list);
      grid.appendChild(c.el);
    }

    // KPIs
    const st = model.storySummary, sp = model.prevStorySummary;
    const weeks = M.weekly(posts, range && range.start, range && range.end);
    const followTotal = followers ? M.sum(followers, x => x.value) : null;
    const pf = profileFollowers(model);
    // Com o total informado, ele é o número principal e os novos do período vêm embaixo, como comparação
    const pfTile = via => ({ label: 'Seguidores do perfil', value: fmt.int(pf.total), sub: newFollowersNote(model, pf, via), cls: 'is-highlight' });
    const per1k = v => (s.reach ? fmt.dec(v / s.reach * 1000) + ' a cada mil contas alcançadas' : '');
    const feedTiles = [
      { label: 'Alcance somado', value: fmt.compact(s.reach), d: delta(s.reach, p && p.reach), sub: 'Média de ' + fmt.compact(s.avgReach) + ' contas por post' },
      { label: 'Interações', value: fmt.compact(s.interactions), d: delta(s.interactions, p && p.interactions), sub: 'Curtidas, comentários, compart. e salvamentos' },
      { label: 'Taxa de engajamento', value: fmt.pct(s.er), d: delta(s.er, p && p.er, { points: true }), sub: 'Interações ÷ alcance' },
      { label: 'Compartilhamentos', value: fmt.compact(s.shares), d: delta(s.shares, p && p.shares), sub: per1k(s.shares) },
      { label: 'Salvamentos', value: fmt.compact(s.saves), d: delta(s.saves, p && p.saves), sub: per1k(s.saves) },
      { label: 'Comentários', value: fmt.compact(s.comments), d: delta(s.comments, p && p.comments), sub: per1k(s.comments) }
    ];
    const followTile = pf ? pfTile('posts') : followTotal != null
      ? { label: 'Novos seguidores', value: '+' + fmt.compact(followTotal), sub: 'Export de público · ' + fmt.int(s.follows) + ' atribuídos a posts' }
      : { label: 'Seguidores via posts', value: '+' + fmt.compact(s.follows), d: delta(s.follows, p && p.follows), sub: s.reach ? fmt.dec(s.followPer1k) + ' a cada mil contas alcançadas' : '' };
    const postsTile = { label: 'Posts no feed', value: fmt.int(s.n), d: delta(s.n, p && p.n), sub: weeks.length ? fmt.dec(s.n / weeks.length) + ' por semana' : '' };

    // Sem stories: herói = visualizações do feed + 8 indicadores
    if (!st.n) {
      const hero = html('div', { class: 'igr-kpi igr-kpi-hero' }, [
        html('div', { class: 'igr-kpi-label', text: 'Visualizações' }),
        html('div', { class: 'igr-kpi-value is-hero', text: fmt.compact(s.views) }),
        delta(s.views, p && p.views),
        html('div', { class: 'igr-kpi-sub', text: 'Média de ' + fmt.compact(s.avgViews) + ' por post · mediana ' + fmt.compact(s.medianViews) }),
        html('div', { class: 'igr-kpi-spark' })
      ]);
      const tiles = kpiTiles(feedTiles.concat([followTile, postsTile]));
      tiles.classList.remove('span-full');
      grid.appendChild(html('div', { class: 'igr-kpis span-full' }, [hero, tiles]));
      C.sparkline(hero.querySelector('.igr-kpi-spark'), weeks.map(w => w.views), 'var(--igr-series-1)');
      return;
    }

    const subhead = (title, text, link) => html('div', { class: 'igr-subhead span-full' }, [
      html('h3', { text: title }), html('p', { text }),
      link ? html('a', { href: link.href, class: 'igr-link', text: link.text }) : null
    ]);
    const storiesLink = { href: '#igr-sec-stories', text: 'Ver análise de stories →' };

    // Só stories no período: a visão combinada seria "100% stories" e não diria nada.
    // O resumo mostra o conjunto completo de indicadores de stories.
    if (!s.n) {
      grid.appendChild(callout('Nenhum post no feed no período filtrado: os números abaixo são só dos stories.'));
      grid.appendChild(subhead('Stories', 'Analisados com métricas próprias.', storiesLink));
      grid.appendChild(kpiTiles([
        { label: 'Stories publicados', value: fmt.int(st.n), d: delta(st.n, sp && sp.n), sub: fmt.dec(st.perActiveDay) + ' por dia ativo' },
        { label: 'Visualizações', value: fmt.compact(st.views), d: delta(st.views, sp && sp.views), sub: 'Média de ' + fmt.compact(st.avgViews) + ' por story' },
        { label: 'Alcance médio por story', value: fmt.compact(st.avgReach), d: delta(st.avgReach, sp && sp.avgReach), sub: 'Mediana de ' + fmt.compact(st.medianReach) + ' contas' },
        { label: 'Respostas', value: fmt.compact(st.replies), d: delta(st.replies, sp && sp.replies) },
        { label: 'Toques em figurinhas', value: fmt.compact(st.stickerTaps), d: delta(st.stickerTaps, sp && sp.stickerTaps) },
        { label: 'Visitas ao perfil', value: fmt.compact(st.profileVisits), d: delta(st.profileVisits, sp && sp.profileVisits) },
        pf ? pfTile('stories') : followTotal != null
          ? { label: 'Novos seguidores', value: '+' + fmt.compact(followTotal), sub: 'Export de público' }
          : { label: 'Seguidores', value: '+' + fmt.compact(st.follows), d: delta(st.follows, sp && sp.follows), sub: 'Atribuídos aos stories' },
        { label: 'Navegação', value: fmt.compact(st.navigation), d: delta(st.navigation, sp && sp.navigation), sub: 'Avançar, voltar, sair e próximo story' }
      ]));
      return;
    }

    // Feed e stories: o herói passa a ser tudo o que o público viu (feed + stories).
    // Visualizações é a métrica unificada do Meta, então a soma é legítima;
    // alcance não é somável entre canais e fica em cada bloco.
    const FEED_COLOR = 'var(--igr-axis-text)', STORY_COLOR = 'var(--igr-series-5)';
    const total = s.views + st.views;
    const prevTotal = p || sp ? (p ? p.views : 0) + (sp ? sp.views : 0) : null;
    const ov = card({ title: 'Visão geral: feed + stories', subtitle: 'Tudo o que o público viu do perfil no período' });
    const aside = html('div', { class: 'igr-split-aside' }, [
      html('div', { class: 'igr-kpi-label', text: 'Visualizações totais' }),
      html('div', { class: 'igr-kpi-value is-hero', text: fmt.compact(total) }),
      delta(total, prevTotal),
      html('div', { class: 'igr-kpi-sub', text: 'Feed ' + fmt.compact(s.views) + ' · Stories ' + fmt.compact(st.views) }),
      html('div', { class: 'igr-stat-row igr-overview-stats' }, [
        pf ? stat('Seguidores do perfil', fmt.int(pf.total), newFollowersNote(model, pf, 'todos'), 'is-big')
        : followTotal != null
          ? stat('Novos seguidores', '+' + fmt.int(followTotal), 'export de público')
          : stat('Seguidores', '+' + fmt.int(s.follows + st.follows), 'atribuídos a posts e stories'),
        stat('Publicações', fmt.int(s.n + st.n), fmt.int(s.n) + (s.n === 1 ? ' post' : ' posts') + ' · ' + fmt.int(st.n) + (st.n === 1 ? ' story' : ' stories'))
      ])
    ]);
    const mixChart = html('div', { class: 'igr-chart' });
    const main = html('div', { style: { minWidth: '0' } }, [
      C.legend([{ label: 'Feed', color: FEED_COLOR }, { label: 'Stories', color: STORY_COLOR }]),
      mixChart,
      html('p', { class: 'igr-footnote', text: 'Alcance não é somado entre feed e stories (a mesma pessoa pode ter visto os dois); veja cada bloco abaixo.' })
    ]);
    ov.body.appendChild(html('div', { class: 'igr-split' }, [aside, main]));
    grid.appendChild(ov.el);
    C.stack100(mixChart, {
      fmt: fmt.int,
      // Só métricas com a mesma definição nos dois canais
      bars: [['Visualizações', s.views, st.views], ['Publicações', s.n, st.n]]
        .map(([label, f, sv]) => ({ label, segments: [{ key: 'feed', label: 'Feed', value: f, color: FEED_COLOR }, { key: 'stories', label: 'Stories', value: sv, color: STORY_COLOR }] }))
    });
    ov.table([
      { key: 'canal', label: 'Canal' },
      { key: 'n', label: 'Publicações', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, fmt: fmt.int },
      { key: 'share', label: '% das visualizações', num: true, fmt: v => fmt.pct(v) },
      { key: 'avgReach', label: 'Alcance médio por publicação', num: true, fmt: fmt.int }
    ], [
      { canal: 'Feed', n: s.n, views: s.views, share: total ? s.views / total : null, avgReach: s.avgReach },
      { canal: 'Stories', n: st.n, views: st.views, share: total ? st.views / total : null, avgReach: st.avgReach }
    ], { sortable: false });

    grid.appendChild(subhead('Feed', 'Reels, carrosséis e imagens: base das seções 02 a 05 e dos totais de engajamento.'));
    grid.appendChild(kpiTiles([
      { label: 'Visualizações', value: fmt.compact(s.views), d: delta(s.views, p && p.views), sub: 'Média de ' + fmt.compact(s.avgViews) + ' por post · mediana ' + fmt.compact(s.medianViews) }
    ].concat(feedTiles, [postsTile])));

    grid.appendChild(subhead('Stories', 'Analisados à parte, com métricas próprias.', storiesLink));
    grid.appendChild(kpiTiles([
      { label: 'Stories publicados', value: fmt.int(st.n), d: delta(st.n, sp && sp.n), sub: fmt.dec(st.perActiveDay) + ' por dia ativo' },
      { label: 'Visualizações', value: fmt.compact(st.views), d: delta(st.views, sp && sp.views), sub: 'Média de ' + fmt.compact(st.avgViews) + ' por story' },
      { label: 'Alcance médio por story', value: fmt.compact(st.avgReach), d: delta(st.avgReach, sp && sp.avgReach), sub: 'Mediana de ' + fmt.compact(st.medianReach) + ' contas' },
      { label: 'Respostas', value: fmt.compact(st.replies), d: delta(st.replies, sp && sp.replies), sub: fmt.compact(st.stickerTaps) + ' toques em figurinhas' }
    ]));
  }

  /* ---------- Render: evolução (gráficos de linhas) ----------
     Três gráficos com o mesmo código: no fim do resumo (feed + stories e
     seguidores), no fim da seção do feed e no fim da seção de stories.
     Uma métrica por vez, escolhida nos chips; período atual × período anterior
     alinhados pela posição. Na impressão e no PDF fica a métrica selecionada. */
  const EVOLUTION_CHARTS = {
    all: { scope: 'all', grid: '#igr-sec-summary .igr-grid', id: 'igr-evolution', title: 'Evolução', color: 'var(--igr-series-1)' },
    feed: { scope: 'feed', grid: '#igr-sec-content .igr-grid', id: 'igr-evolution-feed', title: 'Evolução do feed', color: 'var(--igr-series-1)' },
    stories: { scope: 'stories', grid: '#igr-sec-stories .igr-grid', id: 'igr-evolution-stories', title: 'Evolução dos stories', color: 'var(--igr-series-5)' }
  };
  function evolutionInput(model) {
    const { range, posts, prevPosts, stories, prevStories, audience } = model;
    const pf = profileFollowers(model);
    return {
      range, prev: range.prev, posts, prevPosts, stories, prevStories,
      audienceFollowers: audience && audience.followers && audience.followers.length ? audience.followers : null,
      followerTotal: pf ? { total: pf.total, date: pf.date } : null
    };
  }

  function renderEvolution(model, cfg) {
    cfg = cfg || EVOLUTION_CHARTS.all;
    const grid = $(cfg.grid);
    if (!grid || !model.range) return;
    if (grid.closest('[hidden]')) return; // seção escondida (ex.: sem stories)
    const input = evolutionInput(model);
    const metrics = M.evolutionMetrics(input, cfg.scope);
    if (!metrics.length) return;
    const days = M.daysBetween(model.range.start, model.range.end) + 1;
    const evo = state.evo[cfg.scope];
    // A escolha fica guardada mesmo se a métrica sumir neste recorte (volta quando reaparecer)
    let metric = metrics.some(m => m.key === evo.metric) ? evo.metric : metrics[0].key;
    const canWeek = days >= 14; // menos de 2 semanas: só a visão diária
    let grain = canWeek ? (evo.grain || (days > 45 ? 'week' : 'day')) : 'day';

    const c = card({ title: cfg.title, subtitle: ' ' });
    c.el.id = cfg.id;
    const sub = c.el.querySelector('.igr-card-sub');
    const chips = html('div', { class: 'igr-chips igr-evo-metrics', role: 'group', 'aria-label': 'Métrica do gráfico' }, metrics.map(mt =>
      html('button', { type: 'button', class: 'igr-chip', 'data-key': mt.key, 'aria-pressed': 'false', text: mt.label, onclick: () => { metric = evo.metric = mt.key; draw(); } })));
    const grainBox = html('div', { class: 'igr-evo-grain', role: 'group', 'aria-label': 'Agrupar por' }, [['day', 'Dia'], ['week', 'Semana']].map(([k, t]) =>
      html('button', { type: 'button', class: 'igr-chip', 'data-grain': k, 'aria-pressed': 'false', text: t, disabled: k === 'week' && !canWeek,
        title: k === 'week' && !canWeek ? 'Período curto demais para agrupar por semana' : null, onclick: () => { grain = evo.grain = k; draw(); } })));
    const legendBox = html('div');
    const chart = html('div', { class: 'igr-chart' });
    const note = html('p', { class: 'igr-footnote' });
    c.body.appendChild(html('div', { class: 'igr-evo-controls' }, [chips, grainBox]));
    c.body.appendChild(legendBox);
    c.body.appendChild(chart);
    c.body.appendChild(note);
    grid.appendChild(c.el);

    const CUR = cfg.color, CMP = 'var(--igr-axis-text)';
    const blockLabel = p => (p.days > 1 ? fmt.dayKeyShort(p.start) + ' a ' + fmt.dayKey(p.end) : fmt.dayKey(p.start) + ' · ' + M.WEEKDAYS[(M.keyToDate(p.start).getDay() + 6) % 7].toLowerCase());

    function draw() {
      const e = M.evolution(input, metric, grain, cfg.scope);
      const mt = e.metric;
      const fmtV = mt.rate ? v => fmt.pct(v) : fmt.int;
      chips.querySelectorAll('.igr-chip').forEach(b => { const on = b.getAttribute('data-key') === metric; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
      grainBox.querySelectorAll('.igr-chip').forEach(b => { const on = b.getAttribute('data-grain') === grain; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
      sub.textContent = mt.desc + (grain === 'week' ? ' Visão semanal (blocos de 7 dias).' : ' Visão diária.');

      legendBox.textContent = '';
      legendBox.appendChild(C.legend([{ label: 'Período atual', color: CUR }].concat(e.prev ? [{ label: 'Comparação', color: CMP }] : []), 'line'));

      const pubNote = p => {
        if (mt.src === 'feed') return p.posts ? fmt.int(p.posts) + (p.posts === 1 ? ' post publicado' : ' posts publicados') : 'Nenhum post publicado';
        if (mt.src === 'story') return p.stories ? fmt.int(p.stories) + (p.stories === 1 ? ' story publicado' : ' stories publicados') : 'Nenhum story publicado';
        if (mt.src === 'pub') { const t = p.posts + p.stories; return t ? fmt.int(p.posts) + (p.posts === 1 ? ' post' : ' posts') + ' e ' + fmt.int(p.stories) + (p.stories === 1 ? ' story' : ' stories') : 'Nenhuma publicação'; }
        return null;
      };
      C.lines(chart, {
        values: e.points.map(p => p.value),
        compare: e.prev ? e.prev.map(p => p.value) : null,
        labels: e.points.map(p => fmt.dayMonth(p.start)),
        fmt: fmtV, fmtAxis: mt.rate ? (v, casas) => fmt.pct(v, casas) : fmt.compact, integer: !mt.rate,
        color: CUR, compareColor: CMP, height: 260,
        ariaLabel: 'Evolução de ' + mt.label.toLowerCase() + (e.prev ? ', com o período anterior' : ''),
        tip: i => {
          const p = e.points[i], q = e.prev && e.prev[i];
          return {
            title: blockLabel(p),
            rows: [{ label: 'período atual', value: p.value == null ? 'sem dado' : fmtV(p.value), color: CUR }]
              .concat(q ? [{ label: 'comparação · ' + blockLabel(q), value: q.value == null ? 'sem dado' : fmtV(q.value), color: CMP }] : []),
            note: pubNote(p)
          };
        }
      });

      const partial = grain === 'week' && e.points[0].days < 7 ? ' O primeiro bloco tem ' + e.points[0].days + (e.points[0].days === 1 ? ' dia.' : ' dias.') : '';
      note.textContent = (e.prev
        ? 'A linha cinza é o período anterior (' + fmt.dayKey(input.prev.start) + ' a ' + fmt.dayKey(input.prev.end) + '), alinhado pela posição no período.'
        : input.prev ? 'Sem dados do período anterior para esta métrica.'
          : 'Para comparar com o período anterior, escolha um período no filtro (por exemplo, "Últimos 30 dias").') + partial;

      c.table([
        { key: 'start', label: grain === 'week' ? 'Bloco' : 'Data', value: r => r.start, fmt: (v, r) => blockLabel(r) },
        { key: 'value', label: 'Período atual', num: true, fmt: v => (v == null ? '–' : fmtV(v)) }
      ].concat(e.prev ? [
        { key: 'prevStart', label: 'Comparação', value: r => r.prevStart, fmt: (v, r) => (r.prev ? blockLabel(r.prev) : '–') },
        { key: 'prevValue', label: 'Valor anterior', num: true, fmt: v => (v == null ? '–' : fmtV(v)) }
      ] : []), e.points.map((p, i) => Object.assign({}, p, e.prev ? { prev: e.prev[i], prevStart: e.prev[i].start, prevValue: e.prev[i].value } : {})),
      { sortKey: 'start', sortDir: 1 });
    }
    draw();
  }

  /* ---------- Render: conteúdo ---------- */
  const SORTS = {
    views: { label: 'Visualizações', get: p => p.views, show: p => fmt.compact(p.views) },
    reach: { label: 'Alcance', get: p => p.reach, show: p => fmt.compact(p.reach) },
    er: { label: 'Taxa de engajamento', get: p => (p.er == null ? -1 : p.er), show: p => fmt.pct(p.er) },
    shares: { label: 'Compartilhamentos', get: p => p.shares, show: p => fmt.int(p.shares) },
    saves: { label: 'Salvamentos', get: p => p.saves, show: p => fmt.int(p.saves) },
    comments: { label: 'Comentários', get: p => p.comments, show: p => fmt.int(p.comments) },
    follows: { label: 'Seguidores', get: p => p.follows, show: p => fmt.int(p.follows) }
  };

  // opts: { refLabel: texto do badge "× a mediana", showAuthor: exibe o @ de quem criou }
  function postCard(p, rank, s, opts) {
    opts = opts || {};
    const idx = s.medianViews ? p.views / s.medianViews : null;
    const metric = (label, value) => html('div', { class: 'igr-post-metric' }, [html('dt', { text: label }), html('dd', { text: value })]);
    return html('article', { class: 'igr-post' }, [
      html('div', { class: 'igr-post-top' }, [
        html('span', { class: 'igr-rank', text: String(rank) }),
        formatTag(p.format),
        opts.showAuthor ? html('span', { class: 'igr-post-author', text: '@' + p.username }) : null,
        html('span', { class: 'igr-post-date', text: M.WEEKDAYS_SHORT[p.weekday] + ', ' + fmt.date(p.ts) + ' · ' + fmt.time(p.ts) })
      ]),
      html('p', { class: 'igr-post-text', text: p.description || (p.format.key === 'story' ? 'Sem texto' : 'Sem legenda'), title: p.description || '' }),
      html('dl', { class: 'igr-post-metrics' }, opts.metrics ? opts.metrics.map(([label, value]) => metric(label, value)) : [
        metric('Visualizações', fmt.int(p.views)),
        metric('Alcance', fmt.int(p.reach)),
        metric('Engajamento', fmt.pct(p.er)),
        metric('Curtidas', fmt.int(p.likes)),
        metric('Compart.', fmt.int(p.shares)),
        metric('Salv.', fmt.int(p.saves)),
        metric('Coment.', fmt.int(p.comments)),
        metric('Seguim.', fmt.int(p.follows)),
        p.duration > 0 ? metric('Duração', fmt.seconds(p.duration)) : null
      ]),
      html('div', { class: 'igr-post-foot' }, [
        opts.badge !== undefined ? (opts.badge ? html('span', { class: 'igr-badge', text: opts.badge }) : html('span'))
          : idx != null && s.n >= 3 ? html('span', { class: 'igr-badge', text: fmt.times(idx) + ' ' + (opts.refLabel || 'a mediana') }) : html('span'),
        igLink(p, 'Abrir no Instagram ↗')
      ])
    ]);
  }

  function postsTableColumns() {
    return [
      { key: 'ts', label: 'Data', fmt: v => fmt.date(v) },
      { key: 'format', label: 'Formato', value: r => r.format.single },
      { key: 'description', label: 'Post', value: r => I.excerpt(r, 70), cls: 'is-text' },
      { key: 'views', label: 'Visualiz.', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engaj.', num: true, fmt: v => fmt.pct(v) }
    ];
  }

  function renderContent(model) {
    const sec = section('igr-sec-content');
    if (!sec) return;
    const { grid } = sec;
    const { posts, summary: s, range } = model;
    if (!posts.length) { grid.appendChild(callout('Nenhum post no feed no filtro atual. Carregue o export de conteúdos ou ajuste os filtros.')); return; }

    // Ranking
    const sortSel = html('select', { class: 'igr-select is-small', 'aria-label': 'Ordenar ranking por' },
      Object.entries(SORTS).map(([k, v]) => html('option', { value: k, text: v.label })));
    sortSel.value = state.top.sort;
    const orderSel = html('select', { class: 'igr-select is-small', 'aria-label': 'Maiores ou menores' },
      [html('option', { value: 'top', text: 'Maiores' }), html('option', { value: 'bottom', text: 'Menores' })]);
    orderSel.value = state.top.order;
    const rank = card({ title: 'Ranking de posts', subtitle: 'O que o público mais (ou menos) viu e engajou', actions: [orderSel, sortSel], table: false });
    const listBox = html('div', { class: 'igr-posts' });
    const drawRank = () => {
      const sdef = SORTS[state.top.sort];
      const sorted = posts.slice().sort((a, b) => (sdef.get(b) - sdef.get(a)) * (state.top.order === 'top' ? 1 : -1));
      listBox.textContent = '';
      sorted.slice(0, 6).forEach((p, i) => listBox.appendChild(postCard(p, i + 1, s)));
    };
    sortSel.addEventListener('change', () => { state.top.sort = sortSel.value; drawRank(); });
    orderSel.addEventListener('change', () => { state.top.order = orderSel.value; drawRank(); });
    drawRank();
    rank.body.appendChild(listBox);
    grid.appendChild(rank.el);

    // Linha do tempo por post
    const present = M.FORMATS.filter(f => posts.some(p => p.format.key === f.key));
    const tl = card({ title: 'Visualizações por post', subtitle: 'Cada coluna é um post do feed, em ordem de publicação' });
    if (present.length > 1) tl.body.appendChild(C.legend(present.map(f => ({ label: f.label, color: f.color }))));
    const tlChart = html('div', { class: 'igr-chart' });
    tl.body.appendChild(tlChart);
    grid.appendChild(tl.el);
    C.columns(tlChart, {
      height: 240,
      ariaLabel: 'Visualizações por post ao longo do tempo',
      data: posts.map(p => ({
        label: fmt.dateShort(p.ts), value: p.views, color: p.format.color,
        tip: {
          title: fmt.date(p.ts) + ' · ' + p.format.single,
          rows: [
            { label: 'visualizações', value: fmt.int(p.views), color: p.format.color },
            { label: 'alcance', value: fmt.int(p.reach) },
            { label: 'engajamento', value: fmt.pct(p.er) }
          ],
          note: I.excerpt(p, 70)
        }
      })),
      fmt: fmt.int, fmtAxis: fmt.compact,
      reference: posts.length >= 3 ? { value: s.medianViews, label: 'mediana ' + fmt.compact(s.medianViews) } : null
    });
    tl.table(postsTableColumns(), posts, { sortKey: 'ts', sortDir: 1 });

    // Semanal
    const weeks = M.weekly(posts, range.start, range.end);
    const wk = card({ title: 'Visualizações por semana', subtitle: 'Soma das visualizações dos posts publicados em cada semana', span: 'half' });
    const wkChart = html('div', { class: 'igr-chart' });
    wk.body.appendChild(wkChart);
    grid.appendChild(wk.el);
    C.columns(wkChart, {
      height: 220, ariaLabel: 'Visualizações por semana',
      data: weeks.map(w => ({
        label: fmt.dayKeyShort(w.week), value: w.views,
        tip: { title: 'Semana de ' + fmt.dayKey(w.week), rows: [{ label: 'visualizações', value: fmt.int(w.views), color: 'var(--igr-series-1)' }, { label: 'posts', value: fmt.int(w.n) }] }
      })),
      fmt: fmt.int, fmtAxis: fmt.compact
    });
    wk.table([
      { key: 'week', label: 'Semana de', fmt: v => fmt.dayKey(v) },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance', num: true, fmt: fmt.int },
      { key: 'interactions', label: 'Interações', num: true, fmt: fmt.int }
    ], weeks, { sortKey: 'week', sortDir: 1 });

    // Profundidade de consumo: visualizações por conta alcançada
    const depth = card({ title: 'Alcance × visualizações', subtitle: 'Quantas vezes, em média, cada conta alcançada viu o post', span: 'half' });
    const dChart = html('div', { class: 'igr-chart' });
    depth.body.appendChild(dChart);
    grid.appendChild(depth.el);
    const top8 = posts.slice().sort((a, b) => b.views - a.views).slice(0, 8);
    C.hbars(dChart, {
      ariaLabel: 'Visualizações por conta alcançada nos posts mais vistos',
      data: top8.map(p => ({
        label: fmt.dateShort(p.ts) + ' · ' + I.excerpt(p, 26), value: p.viewsPerReach || 0, color: p.format.color,
        valueLabel: fmt.dec(p.viewsPerReach) + '×',
        tip: { title: I.excerpt(p, 60), rows: [{ label: 'visualizações por conta', value: fmt.dec(p.viewsPerReach) + '×', color: p.format.color }, { label: 'visualizações', value: fmt.int(p.views) }, { label: 'alcance', value: fmt.int(p.reach) }] }
      }))
    });
    depth.el.appendChild(html('p', { class: 'igr-footnote', text: 'Mostra os 8 posts mais vistos. Valores altos indicam revisualização (reels assistidos mais de uma vez, carrosséis revisitados).' }));
    depth.table([
      { key: 'ts', label: 'Data', fmt: v => fmt.date(v) },
      { key: 'description', label: 'Post', value: r => I.excerpt(r, 50), cls: 'is-text' },
      { key: 'views', label: 'Visualiz.', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance', num: true, fmt: fmt.int },
      { key: 'viewsPerReach', label: 'Visualiz./conta', num: true, fmt: v => fmt.dec(v) + '×' }
    ], top8, { sortKey: 'viewsPerReach' });
  }

  /* ---------- Render: formatos e interações ---------- */
  function renderFormats(model) {
    const sec = section('igr-sec-formats');
    if (!sec) return;
    const { grid } = sec;
    const { formats, summary: s, posts } = model;
    if (!posts.length) { grid.appendChild(callout('Nenhum post no feed no filtro atual.')); return; }

    const compare = formats.length > 1;
    if (compare) renderFormatComparison(grid, formats);
    else {
      const f = formats[0];
      grid.appendChild(callout(`Todo o feed do período foi em **${(f.n === 1 ? f.format.single : f.format.label).toLowerCase()}** (${fmt.int(f.n)} ${f.n === 1 ? 'post' : 'posts'}): não há outros formatos para comparar. Os números deste formato são os mesmos do bloco Feed no Resumo.`));
    }
    renderInteractions(grid, s, compare ? 'half' : 'full');
  }

  // Comparação entre formatos (só quando o feed tem 2 ou mais formatos)
  function renderFormatComparison(grid, formats) {
    const perf = card({ title: 'Desempenho médio por formato', subtitle: 'Comparação entre Reels, carrosséis, imagens e demais formatos' });
    if (formats.length > 1) perf.body.appendChild(C.legend(formats.map(f => ({ label: f.format.label + ' (' + f.n + ')', color: f.format.color }))));
    const mini = html('div', { class: 'igr-mini-grid' });
    perf.body.appendChild(mini);
    grid.appendChild(perf.el);
    [
      { title: 'Visualizações médias por post', get: f => f.avgViews, show: fmt.compact },
      { title: 'Alcance médio por post', get: f => f.avgReach, show: fmt.compact },
      { title: 'Taxa de engajamento', get: f => f.er || 0, show: v => fmt.pct(v) },
      { title: 'Compartilhamentos a cada mil alcançadas', get: f => (f.shareRate || 0) * 1000, show: fmt.dec },
      { title: 'Salvamentos a cada mil alcançadas', get: f => (f.saveRate || 0) * 1000, show: fmt.dec },
      { title: 'Seguidores a cada mil alcançadas', get: f => f.followPer1k || 0, show: fmt.dec }
    ].forEach(mDef => {
      const box = html('div', { class: 'igr-mini' }, [html('h4', { class: 'igr-mini-title', text: mDef.title })]);
      const ch = html('div', { class: 'igr-chart' });
      box.appendChild(ch);
      mini.appendChild(box);
      C.hbars(ch, {
        rowHeight: 28,
        data: formats.map(f => ({
          label: f.format.label, value: mDef.get(f), color: f.format.color, valueLabel: mDef.show(mDef.get(f)),
          tip: { title: f.format.label + ' · ' + f.n + ' post(s)', rows: [{ label: mDef.title.toLowerCase(), value: mDef.show(mDef.get(f)), color: f.format.color }] }
        }))
      });
    });
    perf.table([
      { key: 'format', label: 'Formato', value: r => r.format.label },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, fmt: fmt.int },
      { key: 'medianViews', label: 'Visualiz. mediana', num: true, fmt: fmt.int },
      { key: 'avgReach', label: 'Alcance médio', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, fmt: v => fmt.pct(v) },
      { key: 'shareRate', label: 'Compart./mil', num: true, fmt: v => fmt.dec(v * 1000) },
      { key: 'saveRate', label: 'Salv./mil', num: true, fmt: v => fmt.dec(v * 1000) },
      { key: 'followPer1k', label: 'Seguim./mil', num: true, fmt: fmt.dec }
    ], formats, { sortKey: 'avgViews' });

    // Mix
    const mix = card({ title: 'Participação de cada formato', subtitle: 'Peso de cada formato no volume publicado e nos resultados', span: 'half' });
    if (formats.length > 1) mix.body.appendChild(C.legend(formats.map(f => ({ label: f.format.label, color: f.format.color }))));
    const mixChart = html('div', { class: 'igr-chart' });
    mix.body.appendChild(mixChart);
    grid.appendChild(mix.el);
    const mixRows = [['Publicações', 'n'], ['Visualizações', 'views'], ['Alcance', 'reach'], ['Interações', 'interactions'], ['Seguidores', 'follows']];
    C.stack100(mixChart, {
      fmt: fmt.int,
      bars: mixRows.map(([label, key]) => ({ label, segments: formats.map(f => ({ key: f.format.key, label: f.format.label, value: f[key], color: f.format.color })) }))
    });
    mix.table([{ key: 'm', label: 'Métrica' }].concat(formats.map(f => ({ key: f.format.key, label: f.format.label, num: true, fmt: v => fmt.pct(v) }))),
      mixRows.map(([label, key]) => {
        const tot = M.sum(formats, f => f[key]);
        const row = { m: label };
        formats.forEach(f => { row[f.format.key] = tot ? f[key] / tot : null; });
        return row;
      }), { sortable: false });
  }

  // Composição das interações do feed
  function renderInteractions(grid, s, span) {
    const inter = card({ title: 'Como as pessoas interagiram', subtitle: 'Composição das interações dos posts do feed no período', span });
    const iChart = html('div', { class: 'igr-chart' });
    inter.body.appendChild(iChart);
    grid.appendChild(inter.el);
    const items = [['Curtidas', s.likes], ['Comentários', s.comments], ['Compartilhamentos', s.shares], ['Salvamentos', s.saves]];
    if (s.profileVisits) items.push(['Visitas ao perfil', s.profileVisits]);
    C.hbars(iChart, {
      data: items.map(([label, v]) => ({
        label, value: v,
        valueLabel: fmt.compact(v) + (s.interactions && label !== 'Visitas ao perfil' ? ' · ' + fmt.pct(v / s.interactions, 0) : ''),
        tip: { title: label, rows: [{ label: 'total', value: fmt.int(v), color: 'var(--igr-series-1)' }, { label: 'a cada mil contas alcançadas', value: s.reach ? fmt.dec(v / s.reach * 1000) : '–' }] }
      }))
    });
    inter.el.appendChild(html('p', { class: 'igr-footnote', text: 'Compartilhamentos e salvamentos são sinais de valor mais fortes que curtidas: indicam conteúdo que as pessoas querem enviar a alguém ou rever depois.' }));
    inter.table([
      { key: 'label', label: 'Interação' },
      { key: 'v', label: 'Total', num: true, fmt: fmt.int },
      { key: 'share', label: '% das interações', num: true, fmt: v => fmt.pct(v) },
      { key: 'per1k', label: 'A cada mil alcançadas', num: true, fmt: fmt.dec }
    ], items.map(([label, v]) => ({ label, v, share: s.interactions ? v / s.interactions : null, per1k: s.reach ? v / s.reach * 1000 : null })), { sortKey: 'v' });
  }

  /* ---------- Render: temas ---------- */
  function renderThemes(model) {
    const sec = section('igr-sec-themes');
    if (!sec) return;
    const { grid } = sec;
    const { posts, summary: s } = model;
    if (!posts.length) { grid.appendChild(callout('Nenhum post no feed no filtro atual.')); return; }

    // Palavras-chave
    const kw = M.keywordStats(posts).slice(0, 10);
    const kc = card({ title: 'Termos dos posts mais vistos', subtitle: 'Visualizações somadas dos posts cuja legenda menciona cada termo', span: 'half' });
    const kChart = html('div', { class: 'igr-chart' });
    kc.body.appendChild(kChart);
    grid.appendChild(kc.el);
    C.hbars(kChart, {
      empty: 'As legendas não têm termos suficientes para análise.',
      data: kw.map(w => ({
        label: w.word, value: w.views, valueLabel: fmt.compact(w.views),
        tip: { title: '“' + w.word + '”', rows: [{ label: 'visualizações somadas', value: fmt.int(w.views), color: 'var(--igr-series-1)' }, { label: 'posts', value: fmt.int(w.n) }, { label: 'engajamento', value: fmt.pct(w.er) }] }
      }))
    });
    kc.table([
      { key: 'word', label: 'Termo' },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualiz. somadas', num: true, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, fmt: v => fmt.pct(v) }
    ], kw, { sortKey: 'views' });

    // Hashtags
    const tags = M.hashtagStats(posts).slice(0, 12);
    const hc = card({ title: 'Hashtags utilizadas', subtitle: 'Uso e desempenho médio dos posts com cada hashtag', span: 'half', table: false });
    grid.appendChild(hc.el);
    if (!tags.length) hc.body.appendChild(html('div', { class: 'igr-chart-empty', text: 'Nenhuma hashtag nas legendas do período.' }));
    else C.table(hc.body, [
      { key: 'tag', label: 'Hashtag', fmt: v => '#' + v },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, fmt: fmt.compact },
      { key: 'er', label: 'Engaj.', num: true, fmt: v => fmt.pct(v) },
      { key: 'idx', label: 'vs mediana', num: true, value: r => (s.medianViews ? r.avgViews / s.medianViews : null), fmt: v => fmt.times(v) }
    ], tags, { compact: true, sortKey: 'n' });

    // Duração de vídeos
    const dur = M.durationStats(posts);
    const dc = card({ title: 'Duração dos vídeos', subtitle: 'Mediana de visualizações por faixa de duração (Reels e vídeos)', span: 'half' });
    const dChart = html('div', { class: 'igr-chart' });
    dc.body.appendChild(dChart);
    grid.appendChild(dc.el);
    C.hbars(dChart, {
      empty: dur.length ? 'Todos os vídeos estão na faixa “' + dur[0].label + '” (' + dur[0].n + ' vídeo(s), mediana de ' + fmt.compact(dur[0].medianViews) + ' visualizações) — sem base para comparar.' : 'Nenhum vídeo com duração informada no período.',
      data: dur.length < 2 ? [] : dur.map(d => ({
        label: d.label, value: d.medianViews, valueLabel: fmt.compact(d.medianViews),
        tip: { title: d.label + ' · ' + d.n + ' vídeo(s)', rows: [{ label: 'mediana de visualizações', value: fmt.int(d.medianViews), color: 'var(--igr-series-1)' }, { label: 'engajamento', value: fmt.pct(d.er) }] }
      }))
    });
    dc.table([
      { key: 'label', label: 'Duração' },
      { key: 'n', label: 'Vídeos', num: true, fmt: fmt.int },
      { key: 'medianViews', label: 'Visualiz. mediana', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, fmt: v => fmt.pct(v) }
    ], dur, { sortable: false });

    // Tamanho da legenda
    const buckets = [
      { label: 'Curta (até 80 caract.)', test: p => p.captionLength <= 80 },
      { label: 'Média (81–300)', test: p => p.captionLength > 80 && p.captionLength <= 300 },
      { label: 'Longa (mais de 300)', test: p => p.captionLength > 300 }
    ].map(b => { const list = posts.filter(b.test); return list.length ? Object.assign({ label: b.label }, M.summarize(list)) : null; }).filter(Boolean);
    const lc = card({ title: 'Tamanho da legenda', subtitle: 'Taxa de engajamento por tamanho de legenda', span: 'half' });
    const lChart = html('div', { class: 'igr-chart' });
    lc.body.appendChild(lChart);
    grid.appendChild(lc.el);
    C.hbars(lChart, {
      empty: buckets.length ? 'Todas as legendas estão na mesma faixa (' + buckets[0].label.toLowerCase() + ') — sem base para comparar.' : undefined,
      data: buckets.length < 2 ? [] : buckets.map(b => ({
        label: b.label, value: b.er || 0, valueLabel: fmt.pct(b.er),
        tip: { title: b.label + ' · ' + b.n + ' post(s)', rows: [{ label: 'engajamento', value: fmt.pct(b.er), color: 'var(--igr-series-1)' }, { label: 'visualiz. mediana', value: fmt.int(b.medianViews) }] }
      }))
    });
    lc.table([
      { key: 'label', label: 'Legenda' },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'medianViews', label: 'Visualiz. mediana', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, fmt: v => fmt.pct(v) }
    ], buckets, { sortable: false });
  }

  /* ---------- Render: calendário ---------- */
  function renderCalendar(model) {
    const sec = section('igr-sec-calendar');
    if (!sec) return;
    const { grid } = sec;
    const { posts, range } = model;
    if (!posts.length) { grid.appendChild(callout('Nenhum post no feed no filtro atual.')); return; }

    const cells = M.heatmap(posts);
    const hm = card({ title: 'Dia e horário de publicação', subtitle: 'Média de visualizações por post em cada combinação (horário local do export)', span: 'wide' });
    const hChart = html('div', { class: 'igr-chart' });
    hm.body.appendChild(hChart);
    grid.appendChild(hm.el);
    C.heatmap(hChart, {
      rows: M.WEEKDAYS_SHORT, cols: M.TIME_BANDS.map(b => b.label), legendLabel: 'menor média',
      fmt: fmt.compact,
      cells: cells.map((row, i) => row.map((c, j) => ({
        value: c.avgViews, n: c.n,
        tip: c.n ? {
          title: M.WEEKDAYS[i] + ' · ' + M.TIME_BANDS[j].label,
          rows: [{ label: 'visualizações médias', value: fmt.int(c.avgViews) }, { label: 'posts', value: fmt.int(c.n) }, { label: 'engajamento mediano', value: fmt.pct(c.avgEr) }]
        } : null
      })))
    });
    const hmRows = [];
    cells.forEach((row, i) => row.forEach((c, j) => { if (c.n) hmRows.push({ day: M.WEEKDAYS[i], band: M.TIME_BANDS[j].label, n: c.n, avgViews: c.avgViews, er: c.avgEr, order: i * 10 + j }); }));
    hm.table([
      { key: 'day', label: 'Dia', value: r => r.day },
      { key: 'band', label: 'Horário' },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engaj. mediano', num: true, fmt: v => fmt.pct(v) }
    ], hmRows, { sortKey: 'avgViews' });

    // Por dia da semana
    const days = M.WEEKDAYS.map((name, i) => {
      const list = posts.filter(p => p.weekday === i);
      return { name, short: M.WEEKDAYS_SHORT[i], n: list.length, avg: list.length ? M.mean(list, p => p.views) : 0 };
    });
    const dw = card({ title: 'Por dia da semana', subtitle: 'Visualizações médias por post', span: 'narrow' });
    const dChart = html('div', { class: 'igr-chart' });
    dw.body.appendChild(dChart);
    grid.appendChild(dw.el);
    C.hbars(dChart, {
      data: days.map(d => ({
        label: d.short, value: d.avg, valueLabel: d.n ? fmt.compact(d.avg) : '—',
        tip: { title: d.name, rows: [{ label: 'visualizações médias', value: d.n ? fmt.int(d.avg) : '—', color: 'var(--igr-series-1)' }, { label: 'posts', value: fmt.int(d.n) }] }
      }))
    });
    dw.table([
      { key: 'name', label: 'Dia' },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int },
      { key: 'avg', label: 'Visualiz. média', num: true, fmt: fmt.int }
    ], days, { sortable: false });

    // Frequência
    const weeks = M.weekly(posts, range.start, range.end);
    const fq = card({ title: 'Frequência no feed', subtitle: 'Posts publicados por semana' });
    const fChart = html('div', { class: 'igr-chart' });
    fq.body.appendChild(fChart);
    grid.appendChild(fq.el);
    C.columns(fChart, {
      height: 180, ariaLabel: 'Posts publicados por semana',
      data: weeks.map(w => ({
        label: fmt.dayKeyShort(w.week), value: w.n,
        tip: { title: 'Semana de ' + fmt.dayKey(w.week), rows: [{ label: 'posts', value: fmt.int(w.n), color: 'var(--igr-series-1)' }].concat(
          M.FORMATS.filter(f => w.posts.some(p => p.format.key === f.key)).map(f => ({ label: f.label.toLowerCase(), value: fmt.int(w.posts.filter(p => p.format.key === f.key).length), color: f.color }))) }
      })),
      fmt: fmt.int, integer: true
    });
    fq.table([
      { key: 'week', label: 'Semana de', fmt: v => fmt.dayKey(v) },
      { key: 'n', label: 'Posts', num: true, fmt: fmt.int }
    ], weeks, { sortKey: 'week', sortDir: 1 });
  }

  /* ---------- Render: stories (separados do feed) ---------- */
  const STORY_SORTS = {
    reach: { label: 'Alcance', get: p => p.reach },
    views: { label: 'Visualizações', get: p => p.views },
    replies: { label: 'Respostas', get: p => p.replies },
    stickerTaps: { label: 'Toques em figurinhas', get: p => p.stickerTaps },
    profileVisits: { label: 'Visitas ao perfil', get: p => p.profileVisits },
    follows: { label: 'Seguidores', get: p => p.follows },
    shares: { label: 'Compartilhamentos', get: p => p.shares }
  };

  function kpiTiles(tiles) {
    return html('div', { class: 'igr-kpi-grid span-full' }, tiles.map(t => html('div', { class: 'igr-kpi' + (t.cls ? ' ' + t.cls : '') }, [
      html('div', { class: 'igr-kpi-label', text: t.label }),
      html('div', { class: 'igr-kpi-value', text: t.value }),
      t.d || null,
      t.sub ? html('div', { class: 'igr-kpi-sub', text: t.sub }) : null
    ])));
  }

  function renderStories(model) {
    const sec = $('#igr-sec-stories');
    if (!sec) return; // marcação antiga, sem a seção: ignora
    const { ds, stories, storySummary: s, prevStorySummary: p, range } = model;
    const show = ds.stories.length > 0;
    sec.hidden = !show;
    toggleNav('#igr-nav-stories', show);
    if (!show) return;
    const { grid } = section('igr-sec-stories'); // a existência já foi checada acima
    if (!stories.length) { grid.appendChild(callout('Nenhum story no período filtrado.')); return; }
    const per1k = v => (s.reach ? fmt.dec(v / s.reach * 1000) + ' a cada mil contas alcançadas' : '');

    // Números do período
    grid.appendChild(kpiTiles([
      { label: 'Stories publicados', value: fmt.int(s.n), d: delta(s.n, p && p.n), sub: fmt.dec(s.perActiveDay) + ' por dia ativo · ' + fmt.int(s.activeDays) + ' dias com stories' },
      { label: 'Visualizações', value: fmt.compact(s.views), d: delta(s.views, p && p.views), sub: 'Média de ' + fmt.compact(s.avgViews) + ' por story' },
      { label: 'Alcance médio por story', value: fmt.compact(s.avgReach), d: delta(s.avgReach, p && p.avgReach), sub: 'Mediana de ' + fmt.compact(s.medianReach) + ' contas' },
      { label: 'Respostas', value: fmt.compact(s.replies), d: delta(s.replies, p && p.replies), sub: per1k(s.replies) },
      { label: 'Toques em figurinhas', value: fmt.compact(s.stickerTaps), d: delta(s.stickerTaps, p && p.stickerTaps), sub: 'Enquetes, links, menções e demais figurinhas' },
      { label: 'Visitas ao perfil', value: fmt.compact(s.profileVisits), d: delta(s.profileVisits, p && p.profileVisits), sub: per1k(s.profileVisits) },
      { label: 'Seguidores', value: '+' + fmt.compact(s.follows), d: delta(s.follows, p && p.follows), sub: per1k(s.follows) },
      { label: 'Navegação', value: fmt.compact(s.navigation), d: delta(s.navigation, p && p.navigation), sub: 'Avançar, voltar, sair e próximo story' }
    ]));

    // Volume diário
    const perDay = new Map();
    stories.forEach(x => { if (!perDay.has(x.dateKey)) perDay.set(x.dateKey, []); perDay.get(x.dateKey).push(x); });
    const days = M.fillDaily(Array.from(perDay.keys()).map(k => ({ date: k, value: perDay.get(k).length })), range.start, range.end);
    const dc = card({ title: 'Stories por dia', subtitle: 'Quantidade publicada por dia no período' });
    const dChart = html('div', { class: 'igr-chart' });
    dc.body.appendChild(dChart);
    grid.appendChild(dc.el);
    C.columns(dChart, {
      height: 200, ariaLabel: 'Stories publicados por dia', integer: true, fmt: fmt.int,
      data: days.map(x => {
        const list = perDay.get(x.date) || [];
        return {
          label: fmt.dayKeyShort(x.date), value: x.value, color: 'var(--igr-series-5)',
          tip: {
            title: fmt.dayKey(x.date) + ' · ' + M.WEEKDAYS[(M.keyToDate(x.date).getDay() + 6) % 7].toLowerCase(),
            rows: [{ label: 'stories', value: fmt.int(x.value), color: 'var(--igr-series-5)' }].concat(list.length ? [
              { label: 'visualizações', value: fmt.int(M.sum(list, y => y.views)) },
              { label: 'alcance médio por story', value: fmt.int(M.mean(list, y => y.reach)) }] : [])
          }
        };
      })
    });
    dc.table([
      { key: 'date', label: 'Data', fmt: v => fmt.dayKey(v) },
      { key: 'value', label: 'Stories', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, value: r => M.sum(perDay.get(r.date) || [], y => y.views), fmt: fmt.int },
      { key: 'reach', label: 'Alcance médio', num: true, value: r => ((perDay.get(r.date) || []).length ? M.mean(perDay.get(r.date), y => y.reach) : null), fmt: fmt.int }
    ], days, { sortKey: 'date', sortDir: 1 });

    // Alcance por story conforme o volume do dia
    const buckets = M.storyDayStats(stories);
    const bc = card({ title: 'Alcance por story x stories no dia', subtitle: 'Alcance médio de cada story conforme quantos foram publicados no mesmo dia', span: 'half' });
    const bChart = html('div', { class: 'igr-chart' });
    bc.body.appendChild(bChart);
    grid.appendChild(bc.el);
    C.hbars(bChart, {
      empty: 'Todos os dias tiveram a mesma quantidade de stories — sem base para comparar.',
      data: buckets.length < 2 ? [] : buckets.map(b => ({
        label: b.label, value: b.avgReach, valueLabel: fmt.compact(b.avgReach), color: 'var(--igr-series-5)',
        tip: { title: b.label, rows: [{ label: 'alcance médio por story', value: fmt.int(b.avgReach), color: 'var(--igr-series-5)' }, { label: 'dias', value: fmt.int(b.days) }, { label: 'stories', value: fmt.int(b.stories) }] }
      }))
    });
    bc.el.appendChild(html('p', { class: 'igr-footnote', text: 'Ajuda a ver se sequências longas perdem público ao longo do dia.' }));
    bc.table([
      { key: 'label', label: 'Stories no dia' },
      { key: 'days', label: 'Dias', num: true, fmt: fmt.int },
      { key: 'stories', label: 'Stories', num: true, fmt: fmt.int },
      { key: 'avgReach', label: 'Alcance médio', num: true, fmt: fmt.int },
      { key: 'medianReach', label: 'Alcance mediano', num: true, fmt: fmt.int }
    ], buckets, { sortable: false });

    // Interações
    const items = [['Respostas', s.replies], ['Curtidas', s.likes], ['Compartilhamentos', s.shares], ['Toques em figurinhas', s.stickerTaps], ['Visitas ao perfil', s.profileVisits], ['Seguidores', s.follows]]
      .concat(s.linkClicks ? [['Cliques no link', s.linkClicks]] : []);
    const ic = card({ title: 'Como o público respondeu', subtitle: 'Ações geradas pelos stories no período', span: 'half' });
    const iChart = html('div', { class: 'igr-chart' });
    ic.body.appendChild(iChart);
    grid.appendChild(ic.el);
    C.hbars(iChart, {
      data: items.map(([label, v]) => ({
        label, value: v, color: 'var(--igr-series-5)',
        valueLabel: fmt.compact(v) + (s.reach ? ' · ' + fmt.dec(v / s.reach * 1000) + '/mil' : ''),
        tip: { title: label, rows: [{ label: 'total', value: fmt.int(v), color: 'var(--igr-series-5)' }, { label: 'a cada mil contas alcançadas', value: s.reach ? fmt.dec(v / s.reach * 1000) : '–' }] }
      }))
    });
    ic.table([
      { key: 'label', label: 'Ação' },
      { key: 'v', label: 'Total', num: true, fmt: fmt.int },
      { key: 'per1k', label: 'A cada mil alcançadas', num: true, fmt: fmt.dec },
      { key: 'perStory', label: 'Por story', num: true, fmt: fmt.dec }
    ], items.map(([label, v]) => ({ label, v, per1k: s.reach ? v / s.reach * 1000 : null, perStory: v / s.n })), { sortKey: 'v' });

    // Contas mencionadas (parceiros, marcas, amigos)
    const mentions = M.mentionStats(stories, ds.owner.username);
    const withMention = stories.filter(x => M.mentionsOf(x.description).some(u => u !== String(ds.owner.username || '').toLowerCase())).length;
    const mc = card({
      title: 'Contas mais mencionadas nos stories',
      subtitle: fmt.int(mentions.length) + (mentions.length === 1 ? ' conta mencionada' : ' contas mencionadas') + ' em ' + fmt.int(withMention) + ' de ' + fmt.int(s.n) +
        (s.n === 1 ? ' story' : ' stories') + ': ajuda a mapear parcerias, marcas e convidados frequentes'
    });
    const mChart = html('div', { class: 'igr-chart' });
    mc.body.appendChild(mChart);
    grid.appendChild(mc.el);
    const plural = n => fmt.int(n) + (n === 1 ? ' story' : ' stories');
    C.hbars(mChart, {
      empty: 'Nenhuma menção (@conta) no texto dos stories do período.',
      data: mentions.slice(0, 10).map(x => ({
        label: '@' + x.user, value: x.n, color: 'var(--igr-series-5)', valueLabel: plural(x.n),
        tip: { title: '@' + x.user, rows: [{ label: 'stories com menção', value: fmt.int(x.n), color: 'var(--igr-series-5)' }, { label: 'alcance médio desses stories', value: fmt.int(x.avgReach) }, { label: 'última menção', value: fmt.date(x.last) }] }
      }))
    });
    mc.el.appendChild(html('p', { class: 'igr-footnote', text: 'Menções lidas pelo @ no texto que o Meta exporta para cada story. Os 10 primeiros por número de stories; a tabela traz todos.' }));
    mc.table([
      { key: 'user', label: 'Conta', fmt: v => '@' + v },
      { key: 'n', label: 'Stories', num: true, fmt: fmt.int },
      { key: 'avgReach', label: 'Alcance médio', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, fmt: fmt.int },
      { key: 'last', label: 'Última menção', num: true, fmt: v => fmt.date(v) }
    ], mentions, { sortKey: 'n' });

    // Dia e horário
    const cells = M.heatmap(stories);
    const hm = card({ title: 'Dia e horário dos stories', subtitle: 'Alcance médio por story em cada combinação (horário local do export)' });
    const hChart = html('div', { class: 'igr-chart' });
    hm.body.appendChild(hChart);
    grid.appendChild(hm.el);
    const reachOf = c => (c.n ? M.mean(c.posts, y => y.reach) : null);
    C.heatmap(hChart, {
      rows: M.WEEKDAYS_SHORT, cols: M.TIME_BANDS.map(b => b.label), legendLabel: 'menor alcance', emptyLabel: 'sem stories', fmt: fmt.compact,
      cells: cells.map((row, i) => row.map((c, j) => ({
        value: reachOf(c), n: c.n,
        tip: c.n ? { title: M.WEEKDAYS[i] + ' · ' + M.TIME_BANDS[j].label, rows: [{ label: 'alcance médio', value: fmt.int(reachOf(c)) }, { label: 'stories', value: fmt.int(c.n) }] } : null
      })))
    });
    const hmRows = [];
    cells.forEach((row, i) => row.forEach((c, j) => { if (c.n) hmRows.push({ day: M.WEEKDAYS[i], band: M.TIME_BANDS[j].label, n: c.n, reach: reachOf(c) }); }));
    hm.table([
      { key: 'day', label: 'Dia' },
      { key: 'band', label: 'Horário' },
      { key: 'n', label: 'Stories', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance médio', num: true, fmt: fmt.int }
    ], hmRows, { sortKey: 'reach' });

    // Ranking
    const sortSel = html('select', { class: 'igr-select is-small', 'aria-label': 'Ordenar stories por' },
      Object.entries(STORY_SORTS).map(([k, v]) => html('option', { value: k, text: v.label })));
    sortSel.value = state.storySort || 'reach';
    const rank = card({ title: 'Stories de destaque', subtitle: 'Os 6 primeiros pela métrica escolhida', actions: [sortSel], table: false });
    const list = html('div', { class: 'igr-posts' });
    const draw = () => {
      const get = STORY_SORTS[sortSel.value].get;
      list.textContent = '';
      stories.slice().sort((a, b) => get(b) - get(a)).slice(0, 6).forEach((x, i) => list.appendChild(postCard(x, i + 1, s, {
        metrics: [
          ['Visualizações', fmt.int(x.views)], ['Alcance', fmt.int(x.reach)], ['Respostas', fmt.int(x.replies)], ['Curtidas', fmt.int(x.likes)],
          ['Compart.', fmt.int(x.shares)], ['Figurinhas', fmt.int(x.stickerTaps)], ['Visitas perfil', fmt.int(x.profileVisits)], ['Seguim.', fmt.int(x.follows)]
        ],
        badge: s.n >= 3 && s.medianReach ? fmt.times(x.reach / s.medianReach) + ' o alcance mediano' : null
      })));
    };
    sortSel.addEventListener('change', () => { state.storySort = sortSel.value; draw(); });
    draw();
    rank.body.appendChild(list);
    grid.appendChild(rank.el);

    // Base de stories
    const tc = card({ title: 'Todos os stories', subtitle: fmt.int(stories.length) + ' stories no período — clique nos títulos das colunas para ordenar', table: false, cls: 'is-scroll-table' });
    grid.appendChild(tc.el);
    C.table(tc.body, [
      { key: 'ts', label: 'Publicação', fmt: v => fmt.date(v) + ' ' + fmt.time(v) },
      { key: 'description', label: 'Story', cls: 'is-text', value: r => r.description, node: r => html('span', { class: 'igr-cell-text', title: r.description, text: I.excerpt(r, 70) }) },
      { key: 'views', label: 'Visualiz.', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance', num: true, fmt: fmt.int },
      { key: 'replies', label: 'Respostas', num: true, fmt: fmt.int },
      { key: 'likes', label: 'Curtidas', num: true, fmt: fmt.int },
      { key: 'shares', label: 'Compart.', num: true, fmt: fmt.int },
      { key: 'stickerTaps', label: 'Figurinhas', num: true, fmt: fmt.int },
      { key: 'profileVisits', label: 'Visitas perfil', num: true, fmt: fmt.int },
      { key: 'follows', label: 'Seguim.', num: true, fmt: fmt.int },
      { key: 'navigation', label: 'Navegação', num: true, fmt: fmt.int },
      { key: 'permalink', label: '', noSort: true, node: r => igLink(r, '↗') }
    ], stories, { sortKey: 'ts', sortDir: -1 });
  }

  /* ---------- Total de seguidores do perfil ----------
     Os exports do Meta só trazem os seguidores GANHOS por dia (e idade, países e
     cidades em %). O total vem do número que aparece no perfil, informado à mão
     (ou por IGR.app.setFollowers) e guardado por @, com a data em que foi informado. */
  const followerTotals = {}; // { usuario: { total, date } }
  try { Object.assign(followerTotals, JSON.parse(localStorage.getItem(FOLLOWERS_KEY) || '{}')); } catch (e) { /* ignora */ }

  // "12.345", "12 345", "12,3 mil", "1,2 mi", "12.3k"
  function parseFollowers(str) {
    const s = String(str || '').toLowerCase().replace(/\s+/g, '');
    const m = s.match(/^(\d[\d.,]*)(mil|k|mi|m)?$/);
    if (!m) return null;
    const n = m[2]
      ? parseFloat(m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6 }[m[2]]
      : parseInt(m[1].replace(/\D/g, ''), 10);
    return n > 0 && n < 1e10 ? Math.round(n) : null;
  }

  function setFollowerTotal(username, total, date) {
    if (!username) return;
    if (total == null) delete followerTotals[username];
    else followerTotals[username] = { total, date: date || P.dateKey(new Date()) };
    if (state.persist) try { localStorage.setItem(FOLLOWERS_KEY, JSON.stringify(followerTotals)); } catch (e) { /* ignora */ }
  }

  // Total informado + estimativa de crescimento no período (base no início ≈ total − ganhos)
  function profileFollowers(model) {
    const saved = model.ds.owner.username && followerTotals[model.ds.owner.username];
    if (!saved) return null;
    const gained = model.followers ? M.sum(model.followers, x => x.value) : null;
    const base = gained != null ? saved.total - gained : null;
    return { total: saved.total, date: saved.date, gained, growth: base > 0 ? gained / base : null };
  }

  // Linha de comparação: novos seguidores do período (export de público ou, sem ele, os atribuídos às publicações)
  function newFollowersNote(model, pf, via) {
    if (pf.gained != null) return '+' + fmt.int(pf.gained) + ' novos no período' + (pf.growth != null ? ' (≈ +' + fmt.pct(pf.growth) + ')' : '');
    const n = { posts: model.summary.follows, stories: model.storySummary.follows, todos: model.summary.follows + model.storySummary.follows }[via];
    return '+' + fmt.int(n) + ' novos via ' + { posts: 'posts', stories: 'stories', todos: 'posts e stories' }[via] + ' no período';
  }

  // Redesenha mantendo o card de seguidores no mesmo lugar da tela (os gráficos acima
  // são desenhados depois e mudariam a altura da página)
  function renderKeepingFollowers() {
    const el = $('#igr-followers');
    const top = el ? el.getBoundingClientRect().top : null;
    render();
    if (top == null) return;
    const keep = () => { const n = $('#igr-followers'); if (n) global.scrollBy(0, n.getBoundingClientRect().top - top); };
    keep();
    global.requestAnimationFrame(keep);
  }

  function followersCard(model) {
    const pf = profileFollowers(model);
    const user = model.ds.owner.username;
    const input = html('input', { type: 'text', class: 'igr-input', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 12.345', 'aria-label': 'Total de seguidores', value: pf ? String(pf.total) : null });
    // Com o total salvo, o formulário fica recolhido atrás de "Editar" (bom para apresentar)
    const form = html('form', { class: 'igr-inline-form igr-no-print', hidden: !!pf }, [
      html('label', { class: 'igr-field' }, [html('span', { class: 'igr-field-label', text: pf ? 'Atualizar total de seguidores' : 'Total de seguidores hoje' }), input]),
      html('button', { type: 'submit', class: 'igr-btn is-small is-primary', text: 'Salvar' }),
      pf ? html('button', { type: 'button', class: 'igr-link-btn', text: 'Remover', onclick: () => { setFollowerTotal(user, null); renderKeepingFollowers(); } }) : null
    ]);
    const edit = pf && html('button', { type: 'button', class: 'igr-link-btn', 'aria-expanded': 'false', text: 'Editar', onclick: () => {
      form.hidden = !form.hidden;
      edit.setAttribute('aria-expanded', String(!form.hidden));
      edit.textContent = form.hidden ? 'Editar' : 'Fechar';
      if (!form.hidden) input.focus();
    } });
    const c = card({ title: 'Seguidores do perfil', subtitle: pf ? 'Total informado a partir do perfil do Instagram' : 'Tamanho da base de seguidores',
      table: false, cls: pf ? '' : 'igr-no-print', actions: edit ? [edit] : [] });
    c.el.id = 'igr-followers';
    if (pf) {
      c.body.appendChild(html('div', { class: 'igr-followers-total' }, [
        html('div', { class: 'igr-kpi-value is-hero', text: fmt.int(pf.total) }),
        html('div', { class: 'igr-kpi-sub', text: newFollowersNote(model, pf, 'todos') }),
        html('div', { class: 'igr-kpi-sub', text: 'Total informado em ' + fmt.dayKey(pf.date) })
      ]));
      if (pf.gained != null) c.body.appendChild(html('p', { class: 'igr-footnote', text: 'O crescimento é uma estimativa: a base no início do período é o total informado menos os novos seguidores do export. O Meta não informa quem deixou de seguir, e seguidores ganhos depois do período (até a data informada) entram no total.' }));
    } else {
      c.body.appendChild(richText('p', 'Os exports do Meta Business Suite não trazem o **total de seguidores**, só os ganhos por dia. Informe o número que aparece no perfil' +
        (user ? ' de **@' + user + '**' : '') + ' para mostrar o tamanho da base e o crescimento no período. Ele fica guardado para este @.'));
    }
    form.addEventListener('submit', e => {
      e.preventDefault();
      const n = parseFollowers(input.value);
      if (n == null) { toast('Digite só o número de seguidores, por exemplo 12.345.', 5000); input.focus(); return; }
      setFollowerTotal(user, n);
      renderKeepingFollowers();
    });
    c.body.appendChild(form);
    return c.el;
  }

  /* ---------- Render: público ---------- */
  function renderAudience(model) {
    const sec = section('igr-sec-audience');
    if (!sec) return;
    const { grid } = sec;
    const { audience: a, followers, posts, stories } = model;
    if (model.ds.owner.username) grid.appendChild(followersCard(model));
    if (!a) {
      grid.appendChild(callout('Carregue o export **Público** do Meta Business Suite (Insights → Público → Exportar) para ver crescimento de seguidores, idade, gênero e localização.'));
      return;
    }

    // Seguidores
    if (followers && followers.length) {
      const total = M.sum(followers, x => x.value);
      const peak = followers.reduce((x, y) => (y.value > x.value ? y : x));
      const postDays = new Map();
      posts.forEach(p => { if (!postDays.has(p.dateKey)) postDays.set(p.dateKey, []); postDays.get(p.dateKey).push(p); });
      const storyDays = new Map();
      stories.forEach(p => storyDays.set(p.dateKey, (storyDays.get(p.dateKey) || 0) + 1));
      const fc = card({ title: 'Novos seguidores por dia', subtitle: 'Seguidores ganhos por dia, segundo o export de público' });
      fc.body.appendChild(html('div', { class: 'igr-stat-row' }, [
        stat('Total no período', '+' + fmt.int(total)),
        stat('Média por dia', fmt.dec(total / followers.length)),
        stat('Melhor dia', fmt.dayKey(peak.date) + ' (+' + fmt.int(peak.value) + ')'),
        stat('Dias com post no feed', fmt.int(followers.filter(x => postDays.has(x.date)).length) + ' de ' + fmt.int(followers.length)),
        storyDays.size ? stat('Dias com story', fmt.int(followers.filter(x => storyDays.has(x.date)).length) + ' de ' + fmt.int(followers.length)) : null
      ]));
      fc.body.appendChild(C.legend([
        { label: 'Novos seguidores', color: 'var(--igr-series-1)' },
        { label: 'Dia com post no feed', color: 'var(--igr-text-secondary)', shape: 'dot' }
      ].concat(storyDays.size ? [{ label: 'Dia com story', color: 'var(--igr-series-5)', shape: 'dot' }] : [])));
      const ch = html('div', { class: 'igr-chart' });
      fc.body.appendChild(ch);
      grid.appendChild(fc.el);
      C.columns(ch, {
        height: 230, ariaLabel: 'Novos seguidores por dia',
        data: followers.map(x => {
          const dayPosts = postDays.get(x.date) || [];
          return {
            label: fmt.dayKeyShort(x.date), value: x.value,
            tip: {
              title: fmt.dayKey(x.date) + ' · ' + M.WEEKDAYS[(M.keyToDate(x.date).getDay() + 6) % 7].toLowerCase(),
              rows: [{ label: 'novos seguidores', value: '+' + fmt.int(x.value), color: 'var(--igr-series-1)' }]
                .concat(storyDays.has(x.date) ? [{ label: 'stories no dia', value: fmt.int(storyDays.get(x.date)) }] : []),
              note: dayPosts.length ? 'Publicado: ' + dayPosts.map(p => p.format.single + ' “' + I.excerpt(p, 40) + '”').join(' · ') : null
            }
          };
        }),
        markers: followers.map(x => postDays.has(x.date)),
        markers2: followers.map(x => storyDays.has(x.date)), markers2Color: 'var(--igr-series-5)',
        fmt: fmt.int, integer: true
      });
      fc.table([
        { key: 'date', label: 'Data', fmt: v => fmt.dayKey(v) },
        { key: 'value', label: 'Novos seguidores', num: true, fmt: fmt.int },
        { key: 'posts', label: 'Posts no feed', value: r => (postDays.get(r.date) || []).length, num: true, fmt: fmt.int },
        { key: 'stories', label: 'Stories', value: r => storyDays.get(r.date) || 0, num: true, fmt: fmt.int }
      ], followers, { sortKey: 'date', sortDir: 1 });
    }

    // Idade e gênero
    if (a.ageGender && a.ageGender.rows.length) {
      const ag = a.ageGender;
      const totals = ag.genders.map((g, i) => ({ g, v: M.sum(ag.rows, r => r.values[i]) }));
      const all = M.sum(totals, t => t.v) || 1;
      const ageTot = ag.rows.map(r => ({ age: r.age, v: M.sum(r.values) }));
      const topAge = ageTot.slice().sort((x, y) => y.v - x.v)[0];
      const gc = card({ title: 'Idade e gênero dos seguidores', subtitle: '% do total de seguidores — retrato na data do export' });
      const reading = model.insights.find(it => it.title === 'Quem é o público');
      const aside = html('div', { class: 'igr-split-aside' }, [
        html('div', { class: 'igr-stat-row' }, totals.map(t => stat(t.g, fmt.pctPoints(t.v / all * 100)))
          .concat([stat('Faixa etária principal', topAge.age + ' anos (' + fmt.pctPoints(topAge.v) + ')')])),
        reading ? richText('p', reading.text) : null
      ]);
      const colors = ['var(--igr-series-1)', 'var(--igr-series-2)', 'var(--igr-series-3)'];
      const ch = html('div', { class: 'igr-chart' });
      const main = html('div', { style: { minWidth: '0' } }, [C.legend(ag.genders.map((g, i) => ({ label: g, color: colors[i] || 'var(--igr-series-7)' }))), ch]);
      gc.body.appendChild(html('div', { class: 'igr-split' }, [aside, main]));
      grid.appendChild(gc.el);
      if (ag.genders.length === 2) {
        C.butterfly(ch, {
          ariaLabel: 'Pirâmide etária por gênero',
          rows: ag.rows.map(r => ({ label: r.age, left: r.values[0], right: r.values[1] })),
          leftLabel: ag.genders[0], rightLabel: ag.genders[1], leftColor: colors[0], rightColor: colors[1],
          fmt: v => fmt.pctPoints(v)
        });
      } else {
        C.hbars(ch, { data: ageTot.map(r => ({ label: r.age, value: r.v, valueLabel: fmt.pctPoints(r.v) })) });
      }
      gc.table([{ key: 'age', label: 'Faixa etária' }].concat(ag.genders.map((g, i) => ({ key: 'g' + i, label: g, num: true, value: r => r.values[i], fmt: v => fmt.pctPoints(v) })))
        .concat([{ key: 'tot', label: 'Total', num: true, value: r => M.sum(r.values), fmt: v => fmt.pctPoints(v) }]), ag.rows, { sortable: false });
    }

    // noun: [rótulo da coluna, "Demais ___ somam"]
    const listCard = (title, subtitle, items, noun) => {
      if (!items || !items.length) return;
      noun = noun || ['Item', 'itens'];
      const c = card({ title, subtitle, span: 'half' });
      const ch = html('div', { class: 'igr-chart' });
      c.body.appendChild(ch);
      grid.appendChild(c.el);
      const top = items.slice(0, 10);
      C.hbars(ch, { data: top.map(d => ({ label: d.name, value: d.value, valueLabel: fmt.pctPoints(d.value) })) });
      const rest = 100 - M.sum(top, d => d.value);
      if (rest > 0.5 && rest < 100) c.el.appendChild(html('p', { class: 'igr-footnote', text: 'Demais ' + noun[1] + ' somam ' + fmt.pctPoints(rest) + '.' }));
      c.table([{ key: 'name', label: noun[0] }, { key: 'value', label: '% dos seguidores', num: true, fmt: v => fmt.pctPoints(v) }], items, { sortKey: 'value' });
    };
    listCard('Principais cidades', '% dos seguidores por cidade', a.cities, ['Cidade', 'cidades']);
    listCard('Principais países', '% dos seguidores por país', a.countries, ['País', 'países']);
    if (a.pages && a.pages.length) listCard('Principais páginas', 'Outras páginas que o público segue', a.pages, ['Página', 'páginas']);

    // Séries extras (ex.: export de visão geral)
    (a.series || []).forEach(sr => {
      if (!sr.points.length) return;
      const pts = model.range ? sr.points.filter(p => p.date >= model.range.start && p.date <= model.range.end) : sr.points;
      if (!pts.length) return;
      const c = card({ title: sr.title, subtitle: 'Série diária do export · total ' + fmt.int(M.sum(pts, p => p.value)) });
      const ch = html('div', { class: 'igr-chart' });
      c.body.appendChild(ch);
      grid.appendChild(c.el);
      C.columns(ch, { height: 200, data: pts.map(p => ({ label: fmt.dayKeyShort(p.date), value: p.value, tip: { title: fmt.dayKey(p.date), rows: [{ label: sr.title, value: fmt.int(p.value), color: 'var(--igr-series-1)' }] } })), fmt: fmt.int, fmtAxis: fmt.compact });
      c.table([{ key: 'date', label: 'Data', fmt: v => fmt.dayKey(v) }, { key: 'value', label: 'Valor', num: true, fmt: fmt.int }], pts, { sortKey: 'date', sortDir: 1 });
    });
    (a.other || []).forEach(o => {
      if (o.items && o.items.length) listCard(o.title, 'Seção adicional do export', o.items.map(i => ({ name: i.name, value: i.value })));
    });
  }

  function stat(label, value, sub, cls) {
    return html('div', { class: 'igr-stat' + (cls ? ' ' + cls : '') }, [
      html('div', { class: 'igr-stat-label', text: label }),
      html('div', { class: 'igr-stat-value', text: value }),
      sub ? html('div', { class: 'igr-stat-sub', text: sub }) : null
    ]);
  }

  /* ---------- Render: colaborações de terceiros ---------- */
  function renderCollabs(model) {
    const sec = $('#igr-sec-collabs');
    if (!sec) return; // marcação antiga, sem a seção: ignora
    const { ds, collabs, collabSummary: cs, summary: own } = model;
    const show = ds.collabs.length > 0;
    sec.hidden = !show;
    toggleNav('#igr-nav-collabs', show);
    if (!show) return;
    const { grid } = section('igr-sec-collabs'); // a existência já foi checada acima
    const who = ds.owner.username ? '@' + ds.owner.username : 'a dona da conta';
    if (!collabs.length) { grid.appendChild(callout('Nenhuma colaboração no filtro atual.')); return; }

    const vsOwn = (a, b, digits) => (own.n && b ? (a >= b ? '+' : '−') + fmt.pct(Math.abs(a / b - 1), digits == null ? 0 : digits) + ' vs posts próprios' : null);

    // Visão geral + comparação com os posts próprios
    const ov = card({ title: 'Colaborações x posts próprios', subtitle: 'Posts criados por outras contas em que ' + who + ' entrou como colaboradora' });
    ov.body.appendChild(html('div', { class: 'igr-stat-row' }, [
      stat('Colaborações', fmt.int(cs.n), new Set(collabs.map(p => p.accountId)).size + ' parceiro(s)'),
      stat('Visualizações', fmt.compact(cs.views), 'fora dos totais do relatório'),
      stat('Visualizações médias', fmt.compact(cs.avgViews), vsOwn(cs.avgViews, own.avgViews)),
      stat('Alcance médio', fmt.compact(cs.avgReach), vsOwn(cs.avgReach, own.avgReach)),
      stat('Taxa de engajamento', fmt.pct(cs.er), own.n && own.er != null ? 'posts próprios: ' + fmt.pct(own.er) : null)
    ]));
    const groups = [
      { label: 'Posts próprios', s: own, color: 'var(--igr-axis-text)' },
      { label: 'Colaborações', s: cs, color: 'var(--igr-series-7)' }
    ].filter(g => g.s.n);
    if (groups.length > 1) {
      ov.body.appendChild(C.legend(groups.map(g => ({ label: g.label + ' (' + g.s.n + ')', color: g.color }))));
      const mini = html('div', { class: 'igr-mini-grid' });
      ov.body.appendChild(mini);
      [
        { title: 'Visualizações médias por post', get: s => s.avgViews || 0, show: fmt.compact },
        { title: 'Alcance médio por post', get: s => s.avgReach || 0, show: fmt.compact },
        { title: 'Taxa de engajamento', get: s => s.er || 0, show: v => fmt.pct(v) }
      ].forEach(mDef => {
        const ch = html('div', { class: 'igr-chart' });
        mini.appendChild(html('div', { class: 'igr-mini' }, [html('h4', { class: 'igr-mini-title', text: mDef.title }), ch]));
        C.hbars(ch, {
          rowHeight: 28,
          data: groups.map(g => ({
            label: g.label, value: mDef.get(g.s), color: g.color, valueLabel: mDef.show(mDef.get(g.s)),
            tip: { title: g.label + ' · ' + g.s.n + ' post(s)', rows: [{ label: mDef.title.toLowerCase(), value: mDef.show(mDef.get(g.s)), color: g.color }] }
          }))
        });
      });
    }
    ov.table([
      { key: 'label', label: 'Grupo' },
      { key: 'n', label: 'Posts', num: true, value: r => r.s.n, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, value: r => r.s.views, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, value: r => r.s.avgViews, fmt: fmt.int },
      { key: 'avgReach', label: 'Alcance médio', num: true, value: r => r.s.avgReach, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, value: r => r.s.er, fmt: v => fmt.pct(v) }
    ], groups, { sortable: false });
    grid.appendChild(ov.el);

    // Parceiros
    const partners = new Map();
    collabs.forEach(p => {
      if (!partners.has(p.accountId)) partners.set(p.accountId, { username: p.username, name: p.accountName, posts: [] });
      partners.get(p.accountId).posts.push(p);
    });
    const prows = Array.from(partners.values()).map(x => Object.assign({ username: x.username, name: x.name, last: Math.max(...x.posts.map(p => p.ts)) }, M.summarize(x.posts)));
    const pc = card({ title: 'Parceiros', subtitle: 'Contas que convidaram ' + who + ' para colaborar', table: false });
    grid.appendChild(pc.el);
    C.table(pc.body, [
      { key: 'username', label: 'Conta', value: r => '@' + r.username, node: r => html('span', null, [html('strong', { text: '@' + r.username }), r.name ? html('span', { class: 'igr-muted', text: ' · ' + r.name }) : null]) },
      { key: 'n', label: 'Collabs', num: true, fmt: fmt.int },
      { key: 'views', label: 'Visualizações', num: true, fmt: fmt.int },
      { key: 'avgViews', label: 'Visualiz. média', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance somado', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engajamento', num: true, fmt: v => fmt.pct(v) },
      { key: 'last', label: 'Última collab', num: true, fmt: v => fmt.date(v) }
    ], prows, { sortKey: 'views', compact: true });

    // Ranking das collabs (badge relativo à mediana dos posts próprios)
    const rank = card({ title: 'Collabs mais vistas', subtitle: 'Ordenadas por visualizações', table: false });
    const list = html('div', { class: 'igr-posts' });
    const ref = own.n >= 3 ? own : { medianViews: null, n: 0 };
    collabs.slice().sort((a, b) => b.views - a.views).slice(0, 6)
      .forEach((p, i) => list.appendChild(postCard(p, i + 1, ref, { showAuthor: true, refLabel: 'a mediana dos posts próprios' })));
    rank.body.appendChild(list);
    grid.appendChild(rank.el);

    grid.appendChild(callout('As métricas de uma collab são **compartilhadas** entre as contas participantes e mostram o desempenho total do post, não só a parte de ' + who +
      '. Por isso elas ficam fora dos totais do relatório. Collabs criadas pela própria ' + who + ' não são identificáveis no export e aparecem como posts próprios.'));
  }

  /* ---------- Render: base completa ---------- */
  function renderTable(model) {
    const sec = section('igr-sec-posts');
    if (!sec) return;
    const { grid } = sec;
    const { posts } = model;
    const search = html('input', { type: 'search', class: 'igr-input', placeholder: 'Buscar na legenda…', 'aria-label': 'Buscar posts', value: state.search });
    const dl = html('button', { type: 'button', class: 'igr-btn is-small', text: 'Baixar CSV', onclick: () => downloadCSV(posts) });
    const c = card({ title: 'Todos os posts do feed', subtitle: fmt.int(posts.length) + (posts.length === 1 ? ' post' : ' posts') + ' no filtro atual — clique nos títulos das colunas para ordenar', actions: [search, dl], table: false });
    grid.appendChild(c.el);
    const tableBox = html('div');
    c.body.appendChild(tableBox);
    const cols = [
      { key: 'ts', label: 'Publicação', fmt: v => fmt.date(v) + ' ' + fmt.time(v) },
      { key: 'format', label: 'Formato', value: r => r.format.single, node: r => formatTag(r.format) },
      { key: 'description', label: 'Legenda', cls: 'is-text', value: r => r.description, node: r => html('span', { class: 'igr-cell-text', title: r.description, text: I.excerpt(r, 80) }) },
      { key: 'views', label: 'Visualiz.', num: true, fmt: fmt.int },
      { key: 'reach', label: 'Alcance', num: true, fmt: fmt.int },
      { key: 'likes', label: 'Curtidas', num: true, fmt: fmt.int },
      { key: 'comments', label: 'Coment.', num: true, fmt: fmt.int },
      { key: 'shares', label: 'Compart.', num: true, fmt: fmt.int },
      { key: 'saves', label: 'Salv.', num: true, fmt: fmt.int },
      { key: 'follows', label: 'Seguim.', num: true, fmt: fmt.int },
      { key: 'er', label: 'Engaj.', num: true, fmt: v => fmt.pct(v) },
      { key: 'permalink', label: '', noSort: true, node: r => igLink(r, '↗') }
    ];
    const draw = () => {
      const q = P.normKey(state.search);
      const rows = q ? posts.filter(p => P.normKey(p.description).includes(q)) : posts;
      C.table(tableBox, cols, rows, { sortKey: 'views' });
    };
    let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.search = search.value; draw(); }, 150); });
    draw();
  }

  function downloadCSV(posts) {
    const dec = v => (v == null || !isFinite(v) ? '' : String(Math.round(v * 10000) / 10000).replace('.', ','));
    const head = ['ID do post', 'Perfil', 'Publicação', 'Formato', 'Legenda', 'Duração (s)', 'Visualizações', 'Alcance', 'Curtidas', 'Comentários',
      'Compartilhamentos', 'Salvamentos', 'Seguimentos', 'Interações', 'Taxa de engajamento', 'Visualizações por conta', 'Link'];
    const rows = posts.map(p => [p.id, p.username, fmt.date(p.ts) + ' ' + fmt.time(p.ts), p.format.single, p.description, p.duration, p.views, p.reach, p.likes,
      p.comments, p.shares, p.saves, p.follows, p.interactions, dec(p.er), dec(p.viewsPerReach), P.safeUrl(p.permalink)]);
    const esc = v => {
      let s = String(v == null ? '' : v);
      // Texto que começa com = + - @ (ex.: legenda "@parceira ...") viraria fórmula no
      // Excel: o apóstrofo força texto. Números (inclusive decimais com vírgula) ficam como estão.
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = "'" + s;
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '\uFEFF' + [head].concat(rows).map(r => r.map(esc).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = html('a', { href: url, download: 'conteudos-instagram-consolidado.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Render principal ---------- */
  function render() {
    if (!state.root) return;
    C.Tip.hide(); // o gráfico sob o tooltip vai ser recriado; o "pointerleave" não dispararia
    const hasData = state.files.some(f => !f.error);
    const model = hasData ? buildModel() : null;
    state.model = model;
    renderFiles(model);
    setHidden('#igr-empty', hasData);
    setHidden('#igr-report', !hasData);
    state.root.classList.toggle('has-data', hasData);
    if (!hasData) {
      setHidden('#igr-hub-client', true);
      setText('#igr-title', 'Desempenho no Instagram');
      setText('#igr-subtitle', 'Carregue os exports do Meta Business Suite para gerar o relatório.');
      return;
    }
    renderHeader(model);
    renderAlert(model);
    renderFilters(model);
    renderSummary(model);
    renderEvolution(model, EVOLUTION_CHARTS.all);
    renderContent(model);
    renderEvolution(model, EVOLUTION_CHARTS.feed);
    renderFormats(model);
    renderThemes(model);
    renderCalendar(model);
    renderStories(model);
    renderEvolution(model, EVOLUTION_CHARTS.stories);
    renderAudience(model);
    renderCollabs(model);
    renderTable(model);
  }

  // Aviso quando o @ informado pela ferramenta não aparece nos exports
  function renderAlert(model) {
    const box = $('#igr-alert');
    if (!box) return;
    box.textContent = '';
    const { owner, accounts } = model.ds;
    box.hidden = !owner.missing;
    if (!owner.missing) return;
    box.appendChild(richText('p', 'Nenhum post de **@' + owner.username + '** nos exports carregados. Confira se os arquivos são da conta certa. ' +
      'Os posts encontrados (' + accounts.map(a => '@' + a.username).join(', ') + ') foram tratados como colaborações.'));
  }

  let toastTimer;
  function toast(msg, ms) {
    let el = $('#igr-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms || 3200);
  }

  /* ---------- Tema ---------- */
  function applyTheme(theme) {
    const docEl = document.documentElement;
    if (theme) docEl.setAttribute('data-igr-theme', theme); else docEl.removeAttribute('data-igr-theme');
    C.rerenderAll(state.root);
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-igr-theme') ||
      (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignora */ }
    applyTheme(next);
  }

  /* ---------- Envio do PDF ao Hub de Relatórios ----------
     O "Exportar PDF" usa a impressão do navegador (window.print), que não entrega
     o arquivo ao JavaScript. Para o envio, uma cópia do relatório com o mesmo
     recorte da impressão é convertida em PDF pelo html2pdf.js (html2canvas + jsPDF),
     carregado só na primeira vez que for usado. */
  const HTML2PDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  // Mesmos elementos que o @media print de dashboard.css esconde
  const PDF_HIDE = '.igr-header-actions, .igr-files, .igr-nav, .igr-card-actions, .igr-toast, .igr-drop-overlay, ' +
    '.igr-filters .igr-chip:not(.is-active), #igr-sec-posts, #igr-sec-method, .igr-card.is-scroll-table, .igr-no-print, ' +
    '.igr-evo-metrics .igr-chip:not(.is-active), .igr-evo-grain, [hidden]';
  // Propriedades que o SVG perde ao ser rasterizado fora da folha de estilos
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'opacity', 'visibility',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'shape-rendering'];

  let html2pdfLoading = null;
  function loadHtml2pdf() {
    if (global.html2pdf) return Promise.resolve(global.html2pdf);
    if (!html2pdfLoading) {
      html2pdfLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HTML2PDF_SRC;
        s.onload = () => (global.html2pdf ? resolve(global.html2pdf) : reject(new Error('html2pdf indisponível')));
        s.onerror = () => { html2pdfLoading = null; s.remove(); reject(new Error('Falha ao carregar html2pdf.js')); };
        document.head.appendChild(s);
      });
    }
    return html2pdfLoading;
  }

  // Cópia do relatório com o recorte da impressão
  function printableCopy() {
    const copy = state.root.cloneNode(true);
    // cloneNode não leva o valor atual de selects e inputs (só os atributos)
    const srcFields = state.root.querySelectorAll('select, input');
    copy.querySelectorAll('select, input').forEach((el, i) => {
      const src = srcFields[i];
      if (!src) return;
      if (el.tagName === 'SELECT') Array.from(el.options).forEach((o, j) => o.toggleAttribute('selected', j === src.selectedIndex));
      else el.setAttribute('value', src.value);
    });
    copy.querySelectorAll(PDF_HIDE).forEach(el => el.remove());
    copy.removeAttribute('data-igr-root');
    copy.style.maxWidth = 'none';
    copy.style.padding = '0';
    copy.querySelectorAll('.igr-grid > .span-half, .igr-grid > .span-wide, .igr-grid > .span-narrow').forEach(el => { el.style.gridColumn = 'span 12'; });
    return copy;
  }

  function buildPdfBlob() {
    return loadHtml2pdf().then(html2pdf => html2pdf().set({
      margin: 12,
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      image: { type: 'jpeg', quality: 0.92 },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.igr-card', '.igr-kpi', '.igr-post', '.igr-insight', '.igr-section-head'] },
      html2canvas: {
        scale: 2,
        backgroundColor: '#ffffff',
        onclone(doc) {
          // Tema claro, como na impressão, e estilos calculados gravados nos SVGs
          doc.documentElement.setAttribute('data-igr-theme', 'light');
          const view = doc.defaultView;
          doc.querySelectorAll('svg, svg *').forEach(el => {
            const cs = view.getComputedStyle(el);
            SVG_PROPS.forEach(p => { const v = cs.getPropertyValue(p); if (v) el.style.setProperty(p, v); });
          });
        }
      }
    }).from(printableCopy()).outputPdf('blob'));
  }

  // url: o servidor da plataforma (servidor/hub-relatorios.js), que guarda o segredo e repassa à API.
  // O segredo da API nunca vem para o navegador.
  function hubConfig() {
    return Object.assign({ url: '', tipo: 'conteudo', cliente: '' }, IGR.hubConfig || {}, state.hub || {});
  }

  /* Nome da cliente no Hub: o hub só aceita o nome inteiro, igual ao cadastro (ignora acentos,
     maiúsculas, pontuação e "Dr."/"Dra." no começo). O nome do perfil no Instagram costuma
     trazer complementos ("Dr. Fulano | Cardiologia"), então o campo sugere o nome sem eles e
     guarda a correção feita à mão para cada @. */
  const hubNames = {};
  try { Object.assign(hubNames, JSON.parse(localStorage.getItem(HUB_NAMES_KEY) || '{}')); } catch (e) { /* ignora */ }

  function hubNameGuess(name) {
    return String(name || '')
      .split(/\s+[-–—]\s+|\s*[|•·/(\[{,:;]\s*/)[0]   // corta "Nome | Especialidade", "Nome - ...", "Nome (..."
      .replace(/[^\p{L}\p{N}\s.'-]/gu, '')             // tira emojis e símbolos
      .replace(/\s+/g, ' ').trim();
  }

  function hubClientFor(model) {
    const cfg = hubConfig();
    if (cfg.cliente) return cfg.cliente;
    const { username, account } = model.ds.owner;
    return hubNames[username] || hubNameGuess(account && account.name) || username || '';
  }

  function renderHubClient(model) {
    const box = $('#igr-hub-client'), input = $('#igr-hub-cliente');
    if (!box || !input) return;
    box.hidden = !hubConfig().url; // sem envio configurado (ex.: demonstração), o campo não aparece
    input.readOnly = !!hubConfig().cliente; // nome fixado pela ferramenta na integração
    if (document.activeElement !== input) input.value = hubClientFor(model);
  }

  function saveHubName(value) {
    const user = state.model && state.model.ds.owner.username;
    if (!user || hubConfig().cliente) return;
    const v = value.replace(/\s+/g, ' ').trim();
    // Igual à sugestão automática: não precisa guardar
    if (!v || v === hubNameGuess(state.model.ds.owner.account && state.model.ds.owner.account.name)) delete hubNames[user];
    else hubNames[user] = v;
    if (state.persist) try { localStorage.setItem(HUB_NAMES_KEY, JSON.stringify(hubNames)); } catch (e) { /* ignora */ }
  }

  // FNV-1a: id_externo estável para o mesmo relatório (reenvio não duplica no hub)
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // Campos da API de Relatórios do Hub de Relatórios (ver EXPORTAR-PDF.md)
  function reportMeta() {
    const { ds, range, summary, storySummary } = state.model;
    const cfg = hubConfig();
    const user = ds.owner.username || '';
    const period = range ? fmt.dayKey(range.start) + ' a ' + fmt.dayKey(range.end) : '';
    const day = range ? range.end : new Date().toISOString().slice(0, 10);
    const input = $('#igr-hub-cliente');
    const cliente = ((input && input.value) || hubClientFor(state.model)).replace(/\s+/g, ' ').trim();
    // O cliente entra no id: corrigir o nome gera um envio novo (o hub devolveria o anterior com o mesmo id)
    const pf = profileFollowers(state.model);
    const sig = JSON.stringify([cliente, user, range && range.start, day, state.filters, summary.n, storySummary.n, pf && pf.total,
      state.files.filter(f => !f.error).map(f => f.name).sort()]);
    return {
      cliente: cliente.slice(0, 200),
      titulo: ['Desempenho no Instagram', user && '@' + user, period].filter(Boolean).join(' — ').slice(0, 200),
      data: day, // dia a que o relatório se refere (fim do período), AAAA-MM-DD
      tipo: cfg.tipo,
      id_externo: 'igr-' + (user || 'conta') + '-' + day + '-' + hash(sig),
      arquivo: 'relatorio-instagram-' + (user || 'conta') + '-' + day + '.pdf'
    };
  }

  function sendToHub() {
    const cfg = hubConfig();
    if (!state.model) return Promise.resolve();
    if (!cfg.url) return Promise.resolve(); // sem envio configurado: o botão só imprime
    if (location.protocol === 'file:' && !/^https?:/i.test(cfg.url)) {
      toast('Envio ao Hub de Relatórios não configurado: abra o relatório pelo servidor da plataforma.', 6000);
      return Promise.resolve();
    }
    const meta = reportMeta();
    if (!meta.cliente) {
      toast('Preencha o nome da cliente no Hub antes de exportar.', 6000);
      const input = $('#igr-hub-cliente'); if (input) input.focus();
      return Promise.resolve();
    }
    return buildPdfBlob().then(blob => {
      const body = new FormData();
      body.append('arquivo', new File([blob], meta.arquivo, { type: 'application/pdf' }));
      ['cliente', 'titulo', 'data', 'tipo', 'id_externo'].forEach(k => body.append(k, meta[k]));
      return fetch(cfg.url, { method: 'POST', headers: { 'X-IGR-Hub': '1' }, body });
    }).then(res => res.json().catch(() => ({})).then(json => {
      // 201 = publicado; 200 com "repetido" = o hub já tinha este id_externo
      if (!res.ok || !json.ok) throw new Error(json.motivo || 'HTTP ' + res.status);
      toast('Relatório enviado com sucesso para o Hub de Relatórios.');
    })).catch(err => {
      console.error('[IGR] Envio ao Hub de Relatórios:', err);
      toast('Não foi possível enviar o relatório para o Hub de Relatórios. ' + err.message, 8000);
    });
  }

  /* ---------- Inicialização ---------- */
  function init(root, options) {
    options = options || {};
    root = typeof root === 'string' ? document.querySelector(root) : root;
    // Chamar init de novo na mesma raiz (ex.: auto-init + chamada manual, ou
    // re-montagem numa SPA) só atualiza as opções: não duplica os listeners.
    if (root._igrInit) {
      state.root = root;
      if ('persist' in options) state.persist = options.persist !== false;
      if ('owner' in options) state.ownerFixed = normUser(options.owner) || null;
      if ('hub' in options) state.hub = options.hub || null;
      render();
      return;
    }
    root._igrInit = true;
    state.root = root;
    state.persist = options.persist !== false;
    state.ownerFixed = normUser(options.owner || state.root.getAttribute('data-igr-owner')) || null;
    state.hub = options.hub || null; // { url, tipo, cliente } — sobrepõe IGR.hubConfig
    try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.setAttribute('data-igr-theme', t); } catch (e) { /* ignora */ }

    let input = $('#igr-file-input');
    if (!input) { // sem o <input> no HTML, cria um oculto para os botões de upload funcionarem
      input = html('input', { type: 'file', id: 'igr-file-input', accept: '.csv,text/csv', multiple: true, hidden: true });
      state.root.appendChild(input);
    }
    input.addEventListener('change', () => { loadFiles(input.files).then(() => { input.value = ''; }); });
    state.root.querySelectorAll('[data-igr-upload]').forEach(b => b.addEventListener('click', () => input.click()));
    const printBtn = $('#igr-print');
    if (printBtn) printBtn.addEventListener('click', () => {
      global.print();
      // Depois da impressão (que segue igual), envia uma cópia em PDF ao Hub de Relatórios
      if (printBtn.disabled) return;
      printBtn.disabled = true;
      sendToHub().then(() => { printBtn.disabled = false; });
    });
    const themeBtn = $('#igr-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const hubInput = $('#igr-hub-cliente');
    if (hubInput) hubInput.addEventListener('change', () => { saveHubName(hubInput.value); if (state.model) hubInput.value = hubClientFor(state.model); });

    // Arrastar e soltar em qualquer ponto do relatório
    let depth = 0;
    state.root.addEventListener('dragenter', e => { e.preventDefault(); depth++; state.root.classList.add('is-dragging'); });
    state.root.addEventListener('dragover', e => e.preventDefault());
    state.root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) state.root.classList.remove('is-dragging'); });
    state.root.addEventListener('drop', e => { e.preventDefault(); depth = 0; state.root.classList.remove('is-dragging'); loadFiles(e.dataTransfer.files); });

    // Impressão: força tema claro e reajusta gráficos à largura da página
    let themeBeforePrint = null;
    global.addEventListener('beforeprint', () => {
      themeBeforePrint = document.documentElement.getAttribute('data-igr-theme');
      document.documentElement.setAttribute('data-igr-theme', 'light');
      C.rerenderAll(state.root);
    });
    global.addEventListener('afterprint', () => {
      if (themeBeforePrint) document.documentElement.setAttribute('data-igr-theme', themeBeforePrint);
      else document.documentElement.removeAttribute('data-igr-theme');
      C.rerenderAll(state.root);
    });

    restore();
    render();
  }

  IGR.app = {
    init, loadFiles, loadText, clear, render,
    // Troca a dona da conta sem recarregar a página (ex.: ao mudar de cliente na ferramenta)
    setOwner(username) { state.ownerFixed = normUser(username) || null; render(); },
    // Total de seguidores vindo da ferramenta (ex.: API do Instagram). date = AAAA-MM-DD da contagem
    setFollowers(total, date, username) {
      const user = normUser(username) || (state.model && state.model.ds.owner.username) || state.ownerFixed;
      setFollowerTotal(user, total > 0 ? Math.round(total) : null, date);
      render();
    },
    getModel: () => state.model,
    get files() { return state.files.slice(); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-igr-root]');
    if (root && root.getAttribute('data-igr-autoinit') !== 'false') init(root);
  });
})(window);
