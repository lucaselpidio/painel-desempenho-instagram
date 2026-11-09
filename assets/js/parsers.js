/* ==========================================================================
   IGR.parsers — leitura dos exports do Meta Business Suite (Instagram)
   --------------------------------------------------------------------------
   Suporta dois tipos de arquivo, detectados pelo CONTEÚDO (não pelo nome):

   1. Export de conteúdo/posts  (ex.: "Jul-03-2026_Sep-30-2026_<id>.csv")
      UTF-8 com BOM, uma linha por post (ou por post×dia), colunas como
      "Identificação do post", "Visualizações", "Alcance"...

   2. Export de público / seções  (ex.: "Público.csv")
      UTF-16 LE com BOM, linha "sep=,", blocos separados por linha em branco:
      "Seguidores" (série diária), "Faixa etária e gênero", "Principais
      países", "Principais cidades", "Principais Páginas"... Blocos
      desconhecidos são preservados de forma genérica.

   Cabeçalhos em português e inglês são aceitos.
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR = global.IGR || {};

  /* ---------- Texto / encoding ---------- */

  function decodeBuffer(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
    // Sem BOM: UTF-16 LE tem muitos bytes nulos nas posições ímpares
    const n = Math.min(b.length, 512);
    let zeros = 0;
    for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
    if (n > 16 && zeros > n / 4) return new TextDecoder('utf-16le').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
    catch (e) { return new TextDecoder('windows-1252').decode(b); }
  }

  function normKey(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- CSV ---------- */

  function detectDelimiter(text) {
    const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const c of firstLine) {
      if (c === '"') q = !q;
      else if (!q && c in counts) counts[c]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }

  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    let delim = null;
    const sep = text.match(/^sep=(.)\r?\n/i);
    if (sep) { delim = sep[1]; text = text.slice(sep[0].length); }
    if (!delim) delim = detectDelimiter(text);

    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ---------- Números e datas ---------- */

  // integer=true: "1.400" vira 1400 (contagens); senão vira 1.4 (percentuais)
  function parseNum(v, integer) {
    if (v == null) return null;
    let s = String(v).trim().replace(/[\s\u00a0%]/g, '');
    if (s === '' || s === '-' || s === '--') return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const hasComma = s.includes(','), hasDot = s.includes('.');
    if (hasComma && hasDot) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (hasComma) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot && (integer ? /^-?\d{1,3}(\.\d{3})+$/ : /^-?\d{1,3}(\.\d{3}){2,}$/).test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // Só links http(s): um CSV adulterado com "javascript:..." não pode virar link clicável
  const safeUrl = s => (/^https?:\/\//i.test(String(s || '').trim()) ? String(s).trim() : '');

  const pad2 = n => String(n).padStart(2, '0');
  const dateKey = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

  function detectDateOrder(values) {
    let order = null;
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
      if (!m) continue;
      if (+m[1] > 12) { order = 'dmy'; break; }
      if (+m[2] > 12) { order = 'mdy'; break; }
    }
    return order || 'mdy'; // Meta exporta no padrão americano (MM/DD/AAAA)
  }

  // Retorna timestamp (ms) em horário local, ou null
  function parseDateTime(v, order) {
    const s = String(v || '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/);
    if (m) {
      let [day, month] = order === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]];
      let year = +m[3]; if (year < 100) year += 2000;
      let hh = +(m[4] || 0);
      const ampm = (m[6] || '').toLowerCase();
      if (ampm === 'pm' && hh < 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
      return new Date(year, month - 1, day, hh, +(m[5] || 0)).getTime();
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  const MONTHS = {
    jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7,
    aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12
  };

  // "Jul-03-2026_Sep-30-2026_123.csv" → { start: '2026-07-03', end: '2026-09-30' }
  function parseFilenamePeriod(name) {
    const m = String(name || '').match(/([A-Za-z]{3})-(\d{1,2})-(\d{4})_([A-Za-z]{3})-(\d{1,2})-(\d{4})/);
    if (!m) return null;
    const a = MONTHS[m[1].toLowerCase()], b = MONTHS[m[4].toLowerCase()];
    if (!a || !b) return null;
    return {
      start: m[3] + '-' + pad2(a) + '-' + pad2(+m[2]),
      end: m[6] + '-' + pad2(b) + '-' + pad2(+m[5])
    };
  }

  /* ---------- Export de posts ---------- */

  const POST_COLUMNS = {
    id: ['identificacao do post', 'id do post', 'post id'],
    accountId: ['identificacao da conta', 'id da conta', 'account id'],
    username: ['nome de usuario da conta', 'account username', 'username'],
    accountName: ['nome da conta', 'account name'],
    description: ['descricao', 'description', 'legenda', 'caption'],
    duration: ['duracao (s)', 'duracao (seg)', 'duracao', 'duration (sec)', 'duration (secs)', 'duration'],
    publishedAt: ['horario de publicacao', 'data de publicacao', 'publish time', 'published time'],
    permalink: ['link permanente', 'permalink', 'link'],
    type: ['tipo de post', 'tipo de publicacao', 'post type'],
    dataComment: ['comentario de dados', 'data comment'],
    date: ['data', 'date'],
    views: ['visualizacoes', 'views'],
    impressions: ['impressoes', 'impressions'],
    reach: ['alcance', 'reach'],
    likes: ['curtidas', 'likes'],
    shares: ['compartilhamentos', 'shares'],
    follows: ['seguimentos', 'follows', 'novos seguidores'],
    comments: ['comentarios', 'comments'],
    saves: ['salvamentos', 'saves'],
    profileVisits: ['visitas ao perfil', 'profile visits'],
    replies: ['respostas', 'replies'],
    linkClicks: ['cliques no link', 'toques no link', 'link clicks'],
    stickerTaps: ['toques em figurinhas', 'toques nas figurinhas', 'sticker taps'],
    navigation: ['navegacao', 'navigation']
  };
  const METRIC_FIELDS = ['views', 'impressions', 'reach', 'likes', 'shares', 'follows', 'comments', 'saves', 'profileVisits', 'replies', 'linkClicks', 'stickerTaps', 'navigation'];

  function mapColumns(header) {
    const idx = {};
    header.forEach((h, i) => {
      const k = normKey(h);
      for (const field in POST_COLUMNS) {
        if (idx[field] == null && POST_COLUMNS[field].includes(k)) { idx[field] = i; break; }
      }
    });
    return idx;
  }

  function normType(raw) {
    const k = normKey(raw);
    if (/reel/.test(k)) return 'reel';
    if (/carrossel|carousel|album/.test(k)) return 'carrossel';
    if (/stor/.test(k)) return 'story';
    if (/imagem|image|foto|photo/.test(k)) return 'imagem';
    if (/video/.test(k)) return 'video';
    return 'outro';
  }

  const isTotalRow = v => ['', 'total', 'lifetime', 'vitalicio', 'todo o periodo'].includes(normKey(v));

  // Várias linhas do mesmo post (export diário): usa a linha "Total" se houver,
  // senão soma as métricas aditivas e usa o MAIOR alcance (alcance não é somável).
  function collapsePostRows(rows) {
    if (rows.length === 1) return rows[0];
    const total = rows.find(r => isTotalRow(r.dateCol) && normKey(r.dateCol) !== '');
    if (total) return total;
    const out = Object.assign({}, rows[0]);
    METRIC_FIELDS.forEach(f => {
      if (f === 'reach') out.reach = Math.max(...rows.map(r => r.reach || 0));
      else out[f] = rows.reduce((s, r) => s + (r[f] || 0), 0);
    });
    out.dateCol = 'Total (agregado)';
    return out;
  }

  function parsePosts(rows) {
    const headerIdx = rows.findIndex((r, i) => {
      if (i > 10) return false;
      const m = mapColumns(r);
      return m.id != null && (m.views != null || m.reach != null || m.impressions != null);
    });
    if (headerIdx < 0) return null;
    const map = mapColumns(rows[headerIdx]);
    const body = rows.slice(headerIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
    const order = detectDateOrder(body.map(r => r[map.publishedAt]));
    const get = (r, f) => (map[f] != null ? r[map[f]] : undefined);
    const str = (r, f) => String(get(r, f) == null ? '' : get(r, f)).trim();

    const raw = body.map(r => {
      const p = {
        id: str(r, 'id'),
        accountId: str(r, 'accountId'),
        username: str(r, 'username'),
        accountName: str(r, 'accountName'),
        description: String(get(r, 'description') || '').replace(/\r\n/g, '\n').trim(),
        duration: parseNum(get(r, 'duration')) || 0,
        ts: parseDateTime(get(r, 'publishedAt'), order),
        permalink: safeUrl(str(r, 'permalink')),
        typeRaw: str(r, 'type'),
        dataComment: str(r, 'dataComment'),
        dateCol: str(r, 'date')
      };
      p.type = normType(p.typeRaw);
      METRIC_FIELDS.forEach(f => { p[f] = parseNum(get(r, f), true) || 0; });
      if (map.views == null && map.impressions != null) p.views = p.impressions;
      if (!p.accountId) p.accountId = p.username || 'conta';
      return p;
    }).filter(p => p.id);

    const byId = new Map();
    raw.forEach(p => {
      if (!byId.has(p.id)) byId.set(p.id, []);
      byId.get(p.id).push(p);
    });
    const posts = Array.from(byId.values()).map(collapsePostRows).filter(p => p.ts != null);

    return {
      posts,
      columns: Object.keys(map),
      dateOrder: order,
      skipped: byId.size - posts.length
    };
  }

  /* ---------- Export de público (seções) ---------- */

  const isIsoDate = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || '').trim());
  const isNumeric = s => parseNum(s) != null;

  function splitBlocks(rows) {
    const blocks = [];
    let cur = null;
    rows.forEach(r => {
      const cells = r.map(c => String(c).trim());
      const filled = cells.filter(Boolean);
      if (!filled.length) { cur = null; return; }
      if (!cur) {
        cur = { title: filled.length === 1 ? filled[0] : '', rows: [] };
        blocks.push(cur);
        if (filled.length === 1) return;
      }
      cur.rows.push(cells);
    });
    return blocks;
  }

  function parseList(rows) {
    if (!rows.length) return [];
    // Horizontal: linha de nomes + linha de valores
    if (rows.length >= 2 && rows[1].filter(Boolean).every(isNumeric)) {
      return rows[0].map((name, i) => ({ name, value: parseNum(rows[1][i]) }))
        .filter(d => d.name && d.value != null);
    }
    // Vertical: nome,valor por linha
    if (rows.every(r => r.filter(Boolean).length === 2 && isNumeric(r.filter(Boolean)[1]))) {
      return rows.map(r => { const f = r.filter(Boolean); return { name: f[0], value: parseNum(f[1]) }; });
    }
    return null;
  }

  function parseSeries(block) {
    const header = isIsoDate(block.rows[0] && block.rows[0][0]) ? null : block.rows[0];
    const valueLabel = header && header[1] && normKey(header[1]) !== 'primary' ? header[1] : '';
    const points = block.rows
      .filter(r => isIsoDate(r[0]))
      .map(r => ({ date: r[0].slice(0, 10), value: parseNum(r[1]) || 0 }));
    return { title: block.title + (valueLabel ? ' · ' + valueLabel : ''), points };
  }

  function parseSectioned(rows) {
    const out = {
      followers: null, series: [], ageGender: null,
      countries: null, cities: null, pages: null, other: [], recognized: 0
    };
    splitBlocks(rows).forEach(b => {
      const key = normKey(b.title);
      const firstData = b.rows.find(r => r.some(Boolean));
      const looksSeries = b.rows.filter(r => isIsoDate(r[0])).length >= 2;

      if (/^seguidores|followers/.test(key) && looksSeries) {
        out.followers = parseSeries(b).points; out.recognized++;
      } else if (/pagina|\bpages?\b/.test(key)) {
        out.pages = parseList(b.rows) || []; out.recognized++;
      } else if (/cidade|cities|city/.test(key)) { // antes de "idade": "cidades" contém "idade"
        out.cities = parseList(b.rows) || []; out.recognized++;
      } else if (/pais|countr/.test(key)) {
        out.countries = parseList(b.rows) || []; out.recognized++;
      } else if (/faixa etaria|^idade|\bage\b/.test(key) && firstData) {
        const header = b.rows[0];
        const genders = header.slice(1).filter(Boolean);
        out.ageGender = {
          genders,
          rows: b.rows.slice(1).filter(r => r[0]).map(r => ({
            age: r[0],
            values: genders.map((_, i) => parseNum(r[i + 1]) || 0)
          }))
        };
        out.recognized++;
      } else if (looksSeries) {
        out.series.push(parseSeries(b)); out.recognized++;
      } else if (b.title && b.rows.length) {
        const list = parseList(b.rows);
        out.other.push(list ? { title: b.title, items: list } : { title: b.title, table: b.rows });
      }
    });
    const allDates = [].concat(out.followers || [], ...out.series.map(s => s.points)).map(p => p.date).sort();
    out.range = allDates.length ? { start: allDates[0], end: allDates[allDates.length - 1] } : null;
    return out;
  }

  /* ---------- Entrada principal ---------- */

  function parseText(name, text) {
    const rows = parseCSV(text);
    const posts = parsePosts(rows);
    if (posts) {
      if (!posts.posts.length) throw new Error('Nenhum post válido encontrado no arquivo.');
      return Object.assign({ kind: 'posts', period: parseFilenamePeriod(name) }, posts);
    }
    const sections = parseSectioned(rows);
    if (sections.recognized > 0) {
      return Object.assign({ kind: 'audience', period: sections.range || parseFilenamePeriod(name) }, sections);
    }
    throw new Error('Formato não reconhecido. Use o export de conteúdo (posts) ou o export "Público" do Meta Business Suite.');
  }

  function readFile(file) {
    return file.arrayBuffer().then(buf => parseText(file.name, decodeBuffer(buf)));
  }

  IGR.parsers = {
    decodeBuffer, parseCSV, parseNum, parseDateTime, parseFilenamePeriod,
    parsePosts, parseSectioned, parseText, readFile, normKey, normType, dateKey, safeUrl
  };
})(window);
