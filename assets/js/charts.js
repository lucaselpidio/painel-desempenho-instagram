/* ==========================================================================
   IGR.charts — gráficos SVG sem dependências
   --------------------------------------------------------------------------
   Todos os gráficos:
   - medem a largura real do container e re-renderizam ao redimensionar;
   - usam cores via CSS custom properties (tema claro/escuro automático);
   - inserem textos de dados com textContent (nunca innerHTML);
   - têm tooltip por marca (hover e foco de teclado).
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR = global.IGR || {};
  const NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) {
      if (attrs[k] == null) continue;
      if (k === 'style') el.setAttribute('style', attrs[k]);
      else if (k === 'text') el.textContent = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  function html(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (Array.isArray(children) ? children : children != null ? [children] : []).forEach(c => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  /* ---------- Escalas ---------- */
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    const step = niceStep(max / (count || 4));
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
    if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
    return ticks;
  }

  // Estimativa de largura de texto (fonte de sistema). Evita medir no DOM.
  const textWidth = (s, size) => String(s).length * (size || 12) * 0.56;

  function truncate(s, maxPx, size) {
    s = String(s);
    if (textWidth(s, size) <= maxPx) return s;
    const chars = Math.max(1, Math.floor(maxPx / ((size || 12) * 0.56)) - 1);
    return s.slice(0, chars) + '…';
  }

  /* Cor de texto legível sobre um preenchimento (hex ou var(--igr-...)).
     Abaixo de ~0,18 de luminância o branco contrasta mais; acima, a tinta escura. */
  function luminance(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 1;
    const c = [m[1], m[2], m[3]].map(h => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function inkOn(host, color) {
    const m = String(color).match(/^var\((--[\w-]+)\)$/);
    const hex = m ? getComputedStyle(host).getPropertyValue(m[1]) : color;
    return luminance(hex) < 0.18 ? '#ffffff' : '#0b0b0b';
  }

  /* Data-end arredondado (4px), base reta */
  function colPath(x, y0, w, y1) {
    const h = y0 - y1;
    const r = Math.min(4, w / 2, h);
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  function barPath(x0, y, x1, h) { // cresce para a direita
    const w = x1 - x0;
    const r = Math.min(4, h / 2, w);
    return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  }
  function barPathLeft(x0, y, x1, h) { // cresce para a esquerda (x1 < x0)
    const w = x0 - x1;
    const r = Math.min(4, h / 2, w);
    return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
  }

  /* ---------- Tooltip (singleton) ---------- */
  const Tip = {
    el: null,
    ensure() {
      if (this.el) return this.el;
      this.el = html('div', { class: 'igr-tooltip', role: 'tooltip', 'aria-hidden': 'true' });
      document.body.appendChild(this.el);
      return this.el;
    },
    // content: { title, rows: [{ label, value, color }], note }
    show(content, evt, anchor) {
      const el = this.ensure();
      el.textContent = '';
      if (content.title) el.appendChild(html('div', { class: 'igr-tooltip-title', text: content.title }));
      (content.rows || []).forEach(r => {
        el.appendChild(html('div', { class: 'igr-tooltip-row' }, [
          r.color ? html('span', { class: 'igr-key-line', style: { background: r.color } }) : null,
          html('strong', { text: r.value }),
          html('span', { class: 'igr-tooltip-label', text: r.label })
        ]));
      });
      if (content.note) el.appendChild(html('div', { class: 'igr-tooltip-note', text: content.note }));
      el.classList.add('is-visible');
      let x, y;
      if (evt && evt.clientX != null && evt.type !== 'focus') { x = evt.clientX; y = evt.clientY; }
      else { const b = anchor.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
      const tw = el.offsetWidth, th = el.offsetHeight, vw = document.documentElement.clientWidth;
      let left = x + 14, top = y - th - 12;
      if (left + tw > vw - 8) left = x - tw - 14;
      if (left < 8) left = 8;
      if (top < 8) top = y + 18;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    },
    hide() { if (this.el) this.el.classList.remove('is-visible'); }
  };

  function bindHover(target, mark, getContent) {
    const on = e => { if (mark) mark.classList.add('is-hover'); Tip.show(getContent(), e, target); };
    const off = () => { if (mark) mark.classList.remove('is-hover'); Tip.hide(); };
    target.addEventListener('pointerenter', on);
    target.addEventListener('pointermove', on);
    target.addEventListener('pointerleave', off);
    target.addEventListener('focus', on);
    target.addEventListener('blur', off);
  }

  /* ---------- Montagem responsiva ---------- */
  function mount(el, render) {
    el._igrRender = render;
    el._igrW = null;
    const run = () => {
      const w = Math.floor(el.clientWidth);
      if (!w || w === el._igrW) return;
      if (!el._igrRender) return;
      el._igrW = w;
      el.textContent = '';
      el._igrRender(el, w);
      fitSvgs(el);
    };
    if (!el._igrRO && global.ResizeObserver) {
      el._igrRO = new ResizeObserver(run);
      el._igrRO.observe(el);
    }
    run();
  }

  // viewBox permite que o SVG encolha proporcionalmente (impressão / PDF)
  function fitSvgs(el) {
    el.querySelectorAll(':scope > svg').forEach(s => {
      if (!s.getAttribute('viewBox')) s.setAttribute('viewBox', '0 0 ' + s.getAttribute('width') + ' ' + s.getAttribute('height'));
    });
  }

  function emptyState(el, msg) {
    if (el._igrRO) { el._igrRO.disconnect(); el._igrRO = null; }
    el._igrRender = null;
    el.textContent = '';
    el.appendChild(html('div', { class: 'igr-chart-empty', text: msg || 'Sem dados suficientes para este gráfico.' }));
  }

  /* ---------- Legenda ---------- */
  function legend(items, shape) {
    return html('ul', { class: 'igr-legend' }, items.map(it =>
      html('li', null, [
        html('span', { class: 'igr-swatch igr-swatch-' + (it.shape || shape || 'rect'), style: { background: it.color } }),
        html('span', { text: it.label })
      ])
    ));
  }

  /* ==========================================================================
     Colunas verticais
     opt: { data:[{label, value, color, tip}], height, fmt, xLabel(d,i), markers:[bool],
            markers2:[bool], markers2Color, reference:{value,label}, ariaLabel }
     ========================================================================== */
  function columns(el, opt) {
    if (!opt.data.length || !opt.data.some(d => d.value > 0)) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const H = opt.height || 220;
      // Linhas de marcadores abaixo do eixo (ex.: dias com post no feed, dias com story)
      const markerRows = [
        opt.markers && { flags: opt.markers, color: null },
        opt.markers2 && { flags: opt.markers2, color: opt.markers2Color || 'var(--igr-series-5)' }
      ].filter(r => r && r.flags.some(Boolean));
      const markerH = markerRows.length ? markerRows.length * 9 + 3 : 0;
      const fmtY = opt.fmtAxis || opt.fmt || (v => v);
      const max = Math.max(...opt.data.map(d => d.value), opt.reference ? opt.reference.value : 0);
      let ticks = niceTicks(max, 4);
      // Contagens: passo inteiro (2,5 vira 2; menor que 1 vira 1)
      if (opt.integer && !Number.isInteger(ticks[1])) {
        const step = ticks[1] < 1 ? 1 : ticks[1] === 2.5 ? 2 : Math.ceil(ticks[1]);
        ticks = [0];
        while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
        if (ticks.length === 1) ticks.push(step);
      }
      const yMax = ticks[ticks.length - 1];
      const labelW = Math.max(...ticks.map(t => textWidth(fmtY(t), 11))) + 10;
      const m = { t: 10, r: 8, b: 28 + markerH, l: Math.max(32, labelW) };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const y = v => m.t + ph - (v / yMax) * ph;
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);

      ticks.forEach(t => {
        svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'igr-axis' : 'igr-gridline' }, root);
        svg('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'igr-tick', text: fmtY(t) }, root);
      });

      const n = opt.data.length;
      const band = pw / n;
      const bw = Math.max(1, Math.min(24, band - 2));
      const base = y(0);
      const marks = svg('g', null, root);
      const hits = svg('g', null, root);
      const focusable = n <= 40;

      opt.data.forEach((d, i) => {
        const x = m.l + i * band + (band - bw) / 2;
        let mark = null;
        if (d.value > 0) {
          const top = Math.min(y(d.value), base - 1);
          mark = svg('path', { d: colPath(x, base, bw, top), class: 'igr-mark', style: 'fill:' + (d.color || 'var(--igr-series-1)') }, marks);
        }
        const hit = svg('rect', { x: m.l + i * band, y: m.t, width: band, height: ph + (markerH ? markerH + 2 : 0), class: 'igr-hit', tabindex: focusable ? 0 : null }, hits);
        bindHover(hit, mark, () => d.tip || { title: d.label, rows: [{ label: '', value: (opt.fmt || String)(d.value) }] });
        markerRows.forEach((row, r) => {
          if (row.flags[i]) svg('circle', { cx: x + bw / 2, cy: base + 8 + r * 9, r: 2.5, class: 'igr-marker-dot', style: row.color ? 'fill:' + row.color : null }, root);
        });
      });

      if (opt.reference && opt.reference.value > 0) {
        const ry = y(opt.reference.value);
        svg('line', { x1: m.l, x2: W - m.r, y1: ry, y2: ry, class: 'igr-ref' }, root);
        const label = opt.reference.label;
        const lw = textWidth(label, 11) + 10;
        svg('rect', { x: W - m.r - lw, y: ry - 17, width: lw, height: 15, rx: 3, class: 'igr-ref-bg' }, root);
        svg('text', { x: W - m.r - 5, y: ry - 6, 'text-anchor': 'end', class: 'igr-ref-label', text: label }, root);
      }

      // Rótulos do eixo X sem colisão
      const xl = opt.xLabel || (d => d.label);
      const labels = opt.data.map((d, i) => xl(d, i));
      const maxLabel = Math.max(...labels.map(l => textWidth(l || '', 11))) + 12;
      const every = Math.max(1, Math.ceil(maxLabel / band));
      labels.forEach((l, i) => {
        if (!l || i % every) return;
        // Centralizado na coluna, mas sem passar das bordas do gráfico (último dia, por exemplo)
        const half = textWidth(l, 11) / 2;
        const lx = Math.min(Math.max(m.l + i * band + band / 2, m.l + half), W - half);
        svg('text', { x: lx, y: H - 8, 'text-anchor': 'middle', class: 'igr-tick', text: l }, root);
      });
    });
  }

  /* ==========================================================================
     Barras horizontais (valor na ponta)
     opt: { data:[{label, value, color, valueLabel, tip}], fmt, max, labelWidth }
     ========================================================================== */
  function hbars(el, opt) {
    if (!opt.data.length) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const rowH = opt.rowHeight || 30, barH = Math.min(16, rowH - 10);
      const H = opt.data.length * rowH + 4;
      const fmtV = opt.fmt || String;
      const labelW = Math.min(W * 0.42, opt.labelWidth || Math.max(...opt.data.map(d => textWidth(d.label, 12))) + 18);
      const valueW = Math.max(...opt.data.map(d => textWidth(d.valueLabel != null ? d.valueLabel : fmtV(d.value), 12))) + 12;
      const pw = Math.max(20, W - labelW - valueW);
      const max = opt.max || Math.max(...opt.data.map(d => d.value)) || 1;
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);
      svg('line', { x1: labelW, x2: labelW, y1: 0, y2: H, class: 'igr-axis' }, root);

      opt.data.forEach((d, i) => {
        const y0 = i * rowH + 2;
        const yb = y0 + (rowH - barH) / 2;
        const shown = truncate(d.label, labelW - 16, 12);
        const label = svg('text', { x: labelW - 10, y: y0 + rowH / 2 + 4, 'text-anchor': 'end', class: 'igr-label', text: shown }, root);
        if (shown !== d.label) svg('title', { text: d.label }, label);
        const w = Math.max(0, (d.value / max) * pw);
        let mark = null;
        if (w > 0.5) mark = svg('path', { d: barPath(labelW, yb, labelW + Math.max(w, 2), barH), class: 'igr-mark', style: 'fill:' + (d.color || 'var(--igr-series-1)') }, root);
        svg('text', { x: labelW + w + 6, y: y0 + rowH / 2 + 4, class: 'igr-value', text: d.valueLabel != null ? d.valueLabel : fmtV(d.value) }, root);
        const hit = svg('rect', { x: 0, y: y0, width: W, height: rowH, class: 'igr-hit', tabindex: 0 }, root);
        bindHover(hit, mark, () => d.tip || { title: d.label, rows: [{ label: '', value: d.valueLabel != null ? d.valueLabel : fmtV(d.value) }] });
      });
    });
  }

  /* ==========================================================================
     Pirâmide (borboleta) — ex.: faixa etária × gênero
     opt: { rows:[{label, left, right}], leftLabel, rightLabel, leftColor, rightColor, fmt }
     ========================================================================== */
  function butterfly(el, opt) {
    if (!opt.rows.length) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const rowH = 30, barH = 16, H = opt.rows.length * rowH + 4;
      const fmtV = opt.fmt || String;
      const centerW = 64, valueW = 46;
      const half = (W - centerW) / 2;
      const pw = Math.max(20, half - valueW);
      const max = Math.max(...opt.rows.map(r => Math.max(r.left, r.right))) || 1;
      const cxL = half, cxR = half + centerW;
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);
      svg('line', { x1: cxL, x2: cxL, y1: 0, y2: H, class: 'igr-axis' }, root);
      svg('line', { x1: cxR, x2: cxR, y1: 0, y2: H, class: 'igr-axis' }, root);

      opt.rows.forEach((r, i) => {
        const y0 = i * rowH + 2, yb = y0 + (rowH - barH) / 2, ty = y0 + rowH / 2 + 4;
        svg('text', { x: W / 2, y: ty, 'text-anchor': 'middle', class: 'igr-label', text: r.label }, root);
        const wl = (r.left / max) * pw, wr = (r.right / max) * pw;
        const ml = wl > 0.5 ? svg('path', { d: barPathLeft(cxL, yb, cxL - Math.max(wl, 2), barH), class: 'igr-mark', style: 'fill:' + opt.leftColor }, root) : null;
        const mr = wr > 0.5 ? svg('path', { d: barPath(cxR, yb, cxR + Math.max(wr, 2), barH), class: 'igr-mark', style: 'fill:' + opt.rightColor }, root) : null;
        svg('text', { x: cxL - wl - 6, y: ty, 'text-anchor': 'end', class: 'igr-value', text: fmtV(r.left) }, root);
        svg('text', { x: cxR + wr + 6, y: ty, class: 'igr-value', text: fmtV(r.right) }, root);
        const tip = () => ({
          title: r.label + ' anos',
          rows: [
            { label: opt.leftLabel, value: fmtV(r.left), color: opt.leftColor },
            { label: opt.rightLabel, value: fmtV(r.right), color: opt.rightColor }
          ]
        });
        bindHover(svg('rect', { x: 0, y: y0, width: half, height: rowH, class: 'igr-hit', tabindex: 0 }, root), ml, tip);
        bindHover(svg('rect', { x: half, y: y0, width: W - half, height: rowH, class: 'igr-hit' }, root), mr, tip);
      });
    });
  }

  /* ==========================================================================
     Barras 100% empilhadas — ex.: mix de formatos
     opt: { bars:[{label, segments:[{key,label,value,color}]}], fmt }
     ========================================================================== */
  function stack100(el, opt) {
    if (!opt.bars.length) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const rowH = 44, barH = 22, gap = 2;
      const labelW = Math.min(W * 0.36, Math.max(...opt.bars.map(b => textWidth(b.label, 12))) + 16);
      const pw = W - labelW - 4;
      const H = opt.bars.length * rowH;
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);
      opt.bars.forEach((b, i) => {
        const y0 = i * rowH, yb = y0 + (rowH - barH) / 2;
        svg('text', { x: labelW - 10, y: y0 + rowH / 2 + 4, 'text-anchor': 'end', class: 'igr-label', text: b.label }, root);
        const total = b.segments.reduce((s, x) => s + x.value, 0);
        if (!total) {
          svg('text', { x: labelW, y: y0 + rowH / 2 + 4, class: 'igr-tick', text: 'sem dados' }, root);
          return;
        }
        const segs = b.segments.filter(s => s.value > 0);
        const usable = pw - gap * (segs.length - 1);
        let x = labelW;
        segs.forEach((s, j) => {
          const w = Math.max(1, (s.value / total) * usable);
          const first = j === 0, last = j === segs.length - 1;
          const r = Math.min(4, w / 2);
          // cantos arredondados só nas extremidades da barra
          const d = `M${x + (first ? r : 0)},${yb}H${x + w - (last ? r : 0)}` +
            (last ? `Q${x + w},${yb} ${x + w},${yb + r}V${yb + barH - r}Q${x + w},${yb + barH} ${x + w - r},${yb + barH}` : `V${yb + barH}`) +
            `H${x + (first ? r : 0)}` +
            (first ? `Q${x},${yb + barH} ${x},${yb + barH - r}V${yb + r}Q${x},${yb} ${x + r},${yb}` : `V${yb}`) + 'Z';
          const mark = svg('path', { d, class: 'igr-mark', style: 'fill:' + s.color }, root);
          const share = s.value / total;
          // Não arredonda para 0% / 100% quando o outro segmento existe
          const label = share >= 0.995 && share < 1 ? '>99%' : share > 0 && share < 0.005 ? '<1%' : Math.round(share * 100) + '%';
          if (textWidth(label, 11) + 12 < w) {
            svg('text', { x: x + w / 2, y: yb + barH / 2 + 4, 'text-anchor': 'middle', class: 'igr-inbar', style: 'fill:' + inkOn(host, s.color), text: label }, root);
          }
          const hit = svg('rect', { x, y: y0, width: w + gap, height: rowH, class: 'igr-hit', tabindex: 0 }, root);
          bindHover(hit, mark, () => ({
            title: b.label + ' · ' + s.label,
            rows: [{ label: 'do total', value: (Math.round(share * 1000) / 10).toLocaleString('pt-BR') + '%', color: s.color },
              { label: '', value: (opt.fmt || String)(s.value) }]
          }));
          x += w + gap;
        });
      });
    });
  }

  /* ==========================================================================
     Heatmap (rampa sequencial em 6 passos)
     opt: { rows:[label], cols:[label], cells:[[{value, n, tip}]], fmt, legendLabel, emptyLabel }
     ========================================================================== */
  function heatmap(el, opt) {
    const values = [].concat(...opt.cells).filter(c => c && c.value != null).map(c => c.value);
    if (!values.length) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const rowLabelW = 44, headH = 22, gap = 2;
      const cols = opt.cols.length;
      const cellW = Math.max(28, (W - rowLabelW - gap * (cols - 1)) / cols);
      const cellH = 34;
      // Legenda: "menor ■■■■■■ maior  □ sem posts". Em telas estreitas o
      // trecho "□ sem posts" desce para uma segunda linha em vez de ser cortado.
      const legendLabel = opt.legendLabel || 'menor', emptyText = opt.emptyLabel || 'sem posts';
      // Rótulo longo ("menor alcance") em tela estreita: a escala começa na borda, sem o recuo dos dias da semana
      const lx0 = rowLabelW + textWidth(legendLabel, 11) + 8 + 6 * 22 + 6 + textWidth('maior', 11) > W ? 0 : rowLabelW;
      const lx = lx0 + textWidth(legendLabel, 11) + 8;
      const legendW = lx + 6 * 22 + 52 + 26 + textWidth(emptyText, 11);
      const wrapLegend = legendW > W;
      const H = headH + opt.rows.length * (cellH + gap) + 34 + (wrapLegend ? 18 : 0);
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);
      // Passos por quantil: um único viral não achata as demais células
      const sorted = values.slice().sort((a, b) => a - b);
      const step = v => {
        if (sorted[0] === sorted[sorted.length - 1]) return 4;
        const below = sorted.filter(x => x < v).length, equal = sorted.filter(x => x === v).length;
        const q = (below + (equal - 1) / 2) / (sorted.length - 1);
        return 1 + Math.min(5, Math.floor(q * 6));
      };
      const inkFor = k => inkOn(host, 'var(--igr-seq-' + k + ')');

      opt.cols.forEach((c, j) => {
        svg('text', { x: rowLabelW + j * (cellW + gap) + cellW / 2, y: 14, 'text-anchor': 'middle', class: 'igr-tick', text: c }, root);
      });
      opt.rows.forEach((r, i) => {
        const y0 = headH + i * (cellH + gap);
        svg('text', { x: rowLabelW - 8, y: y0 + cellH / 2 + 4, 'text-anchor': 'end', class: 'igr-label', text: r }, root);
        opt.cols.forEach((c, j) => {
          const cell = opt.cells[i][j];
          const x0 = rowLabelW + j * (cellW + gap);
          const has = cell && cell.value != null;
          const k = has ? step(cell.value) : 0;
          const rect = svg('rect', { x: x0, y: y0, width: cellW, height: cellH, rx: 4, class: 'igr-cell' + (has ? '' : ' is-empty'), style: 'fill:var(--igr-seq-' + k + ')' }, root);
          if (has && cellW >= 40) {
            svg('text', { x: x0 + cellW / 2, y: y0 + cellH / 2 + 4, 'text-anchor': 'middle', class: 'igr-cell-label', style: 'fill:' + inkFor(k), text: (opt.fmt || String)(cell.value) }, root);
          }
          if (has) {
            rect.setAttribute('tabindex', 0);
            bindHover(rect, rect, () => cell.tip || { title: r + ' · ' + c, rows: [{ label: '', value: (opt.fmt || String)(cell.value) }] });
          }
        });
      });
      // Legenda da escala
      const ly = H - 18 - (wrapLegend ? 18 : 0);
      svg('text', { x: lx0, y: ly + 10, class: 'igr-tick', text: legendLabel }, root);
      for (let k = 1; k <= 6; k++) svg('rect', { x: lx + (k - 1) * 22, y: ly, width: 20, height: 12, rx: 2, style: 'fill:var(--igr-seq-' + k + ')' }, root);
      svg('text', { x: lx + 6 * 22 + 6, y: ly + 10, class: 'igr-tick', text: 'maior' }, root);
      const ex = wrapLegend ? rowLabelW : lx + 6 * 22 + 52, ey = wrapLegend ? ly + 18 : ly;
      svg('rect', { x: ex, y: ey, width: 20, height: 12, rx: 2, class: 'igr-cell is-empty', style: 'fill:var(--igr-seq-0)' }, root);
      svg('text', { x: ex + 26, y: ey + 10, class: 'igr-tick', text: emptyText }, root);
    });
  }

  /* ==========================================================================
     Sparkline (tile de KPI) — linha 2px + área 10%
     ========================================================================== */
  function sparkline(el, values, color) {
    if (!values || values.length < 2) { el.textContent = ''; return; }
    mount(el, (host, W) => {
      const H = 40, pad = 3;
      const max = Math.max(...values) || 1;
      const x = i => pad + (i / (values.length - 1)) * (W - pad * 2);
      const y = v => H - pad - (v / max) * (H - pad * 2);
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', 'aria-hidden': 'true' }, host);
      const pts = values.map((v, i) => x(i) + ',' + y(v));
      svg('path', { d: 'M' + x(0) + ',' + (H - pad) + 'L' + pts.join('L') + 'L' + x(values.length - 1) + ',' + (H - pad) + 'Z', style: 'fill:' + color + ';opacity:.1' }, root);
      svg('path', { d: 'M' + pts.join('L'), class: 'igr-line', style: 'stroke:' + color }, root);
      svg('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 4, class: 'igr-end-dot', style: 'fill:' + color }, root);
    });
  }

  /* ==========================================================================
     Tabela ordenável
     columns: [{ key, label, num, fmt(v,row), value(row), node(row), width }]
     ========================================================================== */
  function table(el, columns, rows, options) {
    options = options || {};
    let sortKey = options.sortKey || null, dir = options.sortDir || -1;
    const wrap = html('div', { class: 'igr-table-wrap' });
    const t = html('table', { class: 'igr-table' + (options.compact ? ' is-compact' : '') });
    wrap.appendChild(t);
    el.textContent = '';
    el.appendChild(wrap);
    const val = (c, r) => (c.value ? c.value(r) : r[c.key]);

    function draw() {
      t.textContent = '';
      const thead = html('thead');
      const tr = html('tr');
      columns.forEach(c => {
        const sortable = options.sortable !== false && !c.noSort;
        const th = html('th', { class: (c.num ? 'is-num' : '') + (sortKey === c.key ? ' is-sorted' : ''), scope: 'col', style: c.width ? { width: c.width } : null });
        if (sortable) {
          const btn = html('button', { type: 'button', class: 'igr-th-btn', onclick: () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = c.num ? -1 : 1; } draw(); } },
            [c.label, html('span', { class: 'igr-sort-ind', 'aria-hidden': 'true', text: sortKey === c.key ? (dir < 0 ? ' ↓' : ' ↑') : '' })]);
          th.setAttribute('aria-sort', sortKey === c.key ? (dir < 0 ? 'descending' : 'ascending') : 'none');
          th.appendChild(btn);
        } else th.textContent = c.label;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      t.appendChild(thead);
      let data = rows.slice();
      if (sortKey) {
        const c = columns.find(x => x.key === sortKey);
        data.sort((a, b) => {
          const va = val(c, a), vb = val(c, b);
          if (va == null) return 1; if (vb == null) return -1;
          return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')) * dir;
        });
      }
      if (options.limit) data = data.slice(0, options.limit);
      const tbody = html('tbody');
      data.forEach(r => {
        const row = html('tr');
        columns.forEach(c => {
          const td = html('td', { class: c.num ? 'is-num' : c.cls || null });
          if (c.node) { const n = c.node(r); if (n) td.appendChild(n); }
          else td.textContent = c.fmt ? c.fmt(val(c, r), r) : (val(c, r) == null ? '–' : String(val(c, r)));
          row.appendChild(td);
        });
        tbody.appendChild(row);
      });
      if (!data.length) tbody.appendChild(html('tr', null, html('td', { colspan: columns.length, class: 'igr-table-empty', text: 'Nenhum registro.' })));
      t.appendChild(tbody);
    }
    draw();
  }

  /* ==========================================================================
     Linhas (evolução): período atual com área + linha de comparação
     opt: { values:[number|null], compare:[number|null]|null, labels:[string],
            tip(i) → conteúdo do tooltip, fmt, fmtAxis(v, casas), integer, height,
            ariaLabel, color, compareColor }
     null (ou valor não numérico) = sem dado naquele ponto: a linha é
     interrompida, não cai a zero. Valores negativos ganham eixo abaixo do zero.
     fmtAxis recebe as casas decimais: o gráfico aumenta até os rótulos do eixo
     não se repetirem (ex.: taxa de 0,5% a 1,5% → "0,5%", "1,0%", "1,5%").
     ========================================================================== */
  function lines(el, opt) {
    const clean = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const vals = opt.values.map(clean);
    const n = vals.length;
    const cmp = opt.compare ? opt.compare.slice(0, n).map(clean) : null;
    while (cmp && cmp.length < n) cmp.push(null);
    const known = vals.filter(v => v != null);
    if (!known.length || !known.some(v => v !== 0) && !(cmp && cmp.some(v => v != null && v !== 0))) return emptyState(el, opt.empty);
    mount(el, (host, W) => {
      const H = opt.height || 260;
      const fmtV = opt.fmt || String, fmtAxis = opt.fmtAxis || (v => fmtV(v));
      const color = opt.color || 'var(--igr-series-1)', cColor = opt.compareColor || 'var(--igr-axis-text)';
      const all = known.concat(cmp ? cmp.filter(v => v != null) : []);
      const max = Math.max(...all, 0), min = Math.min(...all, 0);
      let ticks;
      if (min < 0) {
        // Eixo com negativos: passo "redondo" cobrindo de min a max, sempre passando pelo zero
        let step = niceStep((max - min) / 4 || 1);
        if (opt.integer) step = Math.max(1, Math.ceil(step));
        ticks = [];
        for (let t = Math.floor(min / step) * step; t < max + step * 0.999; t += step) ticks.push(+t.toFixed(10));
        if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
      } else {
        ticks = niceTicks(max, 4);
        if (opt.integer && !Number.isInteger(ticks[1])) {
          const step = ticks[1] < 1 ? 1 : ticks[1] === 2.5 ? 2 : Math.ceil(ticks[1]);
          ticks = [0];
          while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
          if (ticks.length === 1) ticks.push(step);
        }
      }
      const yMin = ticks[0], yMax = ticks[ticks.length - 1] > yMin ? ticks[ticks.length - 1] : yMin + 1;
      // Casas decimais do eixo: o mínimo que deixa todos os rótulos diferentes
      let digits = 0;
      while (digits < 4 && new Set(ticks.map(t => fmtAxis(t, digits))).size < ticks.length) digits++;
      const fmtY = t => fmtAxis(t, digits);
      // Rótulo do último valor à direita da linha (como no relatório do TikTok)
      let lastI = n - 1;
      while (lastI >= 0 && vals[lastI] == null) lastI--;
      const endText = lastI >= 0 ? fmtV(vals[lastI]) : '';
      const labelW = Math.max(...ticks.map(t => textWidth(fmtY(t), 11))) + 10;
      const m = { t: 12, r: Math.max(12, textWidth(endText, 12) + 18), b: 28, l: Math.max(34, labelW) };
      const pw = Math.max(10, W - m.l - m.r), ph = H - m.t - m.b;
      const x = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = v => m.t + ph - ((v - yMin) / (yMax - yMin)) * ph;
      const root = svg('svg', { width: W, height: H, class: 'igr-svg', role: 'img', 'aria-label': opt.ariaLabel || '' }, host);

      ticks.forEach(t => {
        svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'igr-axis' : 'igr-gridline' }, root);
        svg('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'igr-tick', text: fmtY(t) }, root);
      });

      // Trechos contínuos (null interrompe a linha)
      const segments = series => {
        const out = []; let cur = null;
        series.forEach((v, i) => {
          if (v == null) { cur = null; return; }
          if (!cur) out.push(cur = []);
          cur.push([x(i), y(v)]);
        });
        return out;
      };
      const linePath = seg => seg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
      const base = y(0);

      if (cmp) segments(cmp).forEach(seg => {
        if (seg.length === 1) svg('circle', { cx: seg[0][0], cy: seg[0][1], r: 2, class: 'igr-line-dot', style: 'fill:' + cColor }, root);
        else svg('path', { d: linePath(seg), class: 'igr-line is-compare', style: 'stroke:' + cColor }, root);
      });
      const segs = segments(vals);
      segs.forEach(seg => {
        if (seg.length > 1) {
          svg('path', { d: linePath(seg) + 'L' + seg[seg.length - 1][0].toFixed(1) + ',' + base + 'L' + seg[0][0].toFixed(1) + ',' + base + 'Z', class: 'igr-area', style: 'fill:' + color }, root);
          svg('path', { d: linePath(seg), class: 'igr-line', style: 'stroke:' + color }, root);
        } else {
          svg('circle', { cx: seg[0][0], cy: seg[0][1], r: 3, class: 'igr-line-dot', style: 'fill:' + color }, root);
        }
      });
      if (lastI >= 0) {
        svg('circle', { cx: x(lastI), cy: y(vals[lastI]), r: 4, class: 'igr-line-end', style: 'fill:' + color }, root);
        svg('text', { x: x(lastI) + 8, y: y(vals[lastI]) + 4, class: 'igr-end-label', text: endText }, root);
      }

      // Destaque do ponto sob o cursor: guia vertical + marcadores
      const guide = svg('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, class: 'igr-guide', visibility: 'hidden' }, root);
      const dotCur = svg('circle', { r: 4, class: 'igr-line-focus', style: 'stroke:' + color, visibility: 'hidden' }, root);
      const dotCmp = cmp ? svg('circle', { r: 3.5, class: 'igr-line-focus', style: 'stroke:' + cColor, visibility: 'hidden' }, root) : null;
      const place = (dot, v, i) => {
        if (!dot) return;
        if (v == null) { dot.setAttribute('visibility', 'hidden'); return; }
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(v)); dot.setAttribute('visibility', 'visible');
      };
      const band = n === 1 ? pw : pw / (n - 1);
      const hits = svg('g', null, root);
      const focusable = n <= 60;
      vals.forEach((v, i) => {
        const x0 = Math.max(m.l, x(i) - band / 2), x1 = Math.min(W - m.r, x(i) + band / 2);
        const hit = svg('rect', { x: x0, y: m.t, width: Math.max(1, x1 - x0), height: ph, class: 'igr-hit', tabindex: focusable ? 0 : null }, hits);
        const on = e => {
          guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible');
          place(dotCur, v, i); place(dotCmp, cmp && cmp[i], i);
          Tip.show(opt.tip ? opt.tip(i) : { title: opt.labels[i], rows: [{ label: '', value: v == null ? '–' : fmtV(v) }] }, e, hit);
        };
        const off = () => { guide.setAttribute('visibility', 'hidden'); place(dotCur, null); place(dotCmp, null); Tip.hide(); };
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('pointermove', on);
        hit.addEventListener('pointerleave', off);
        hit.addEventListener('focus', on);
        hit.addEventListener('blur', off);
      });

      // Rótulos do eixo X sem colisão; o primeiro e o último sempre aparecem
      const labels = opt.labels || [];
      const maxLabel = Math.max(...labels.map(l => textWidth(l || '', 11))) + 14;
      const every = Math.max(1, Math.ceil(maxLabel / (n === 1 ? pw : pw / (n - 1))));
      const show = labels.map((l, i) => !!l && (i % every === 0));
      if (n > 1 && labels[n - 1]) {
        show[n - 1] = true;
        // Tira o rótulo anterior que encostaria no último
        for (let i = n - 2; i >= 0 && x(n - 1) - x(i) < maxLabel; i--) show[i] = false;
        show[0] = !!labels[0] && x(n - 1) - x(0) >= maxLabel;
      }
      labels.forEach((l, i) => {
        if (!show[i]) return;
        const half = textWidth(l, 11) / 2;
        const lx = Math.min(Math.max(x(i), half), W - half);
        svg('text', { x: lx, y: H - 8, 'text-anchor': 'middle', class: 'igr-tick', text: l }, root);
      });
    });
  }

  function rerenderAll(root) {
    (root || document).querySelectorAll('*').forEach(el => {
      if (el._igrRender) { el._igrW = null; const w = Math.floor(el.clientWidth); if (w) { el._igrW = w; el.textContent = ''; el._igrRender(el, w); fitSvgs(el); } }
    });
  }

  IGR.charts = { svg, html, columns, hbars, butterfly, stack100, heatmap, sparkline, lines, table, legend, emptyState, Tip, rerenderAll, niceTicks };
})(window);
