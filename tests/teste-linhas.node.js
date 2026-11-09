// Rodar: node tests/teste-linhas.node.js
// Testes do desenho do gráfico de linhas (IGR.charts.lines) com um DOM mínimo
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..'); // pasta relatorio-instagram

/* ---------- DOM mínimo: só o que charts.js usa ---------- */
class Node_ {
  constructor(tag, ns) { this.tagName = tag.toUpperCase(); this.ns = ns; this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.style = {}; this._text = ''; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  set textContent(t) { this.children = []; this._text = String(t); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  get classList() { const self = this; return { add: c => { self.className = (self.className + ' ' + c).trim(); }, remove: c => { self.className = self.className.split(' ').filter(x => x !== c).join(' '); }, contains: c => self.className.split(' ').includes(c), toggle() {} }; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { (this.listeners[t] || []).forEach(f => f(e || { type: t })); }
  all() { return this.children.reduce((a, c) => a.concat([c], c.all()), []); }
  find(pred) { return this.all().filter(pred); }
  querySelectorAll(sel) { if (sel === ':scope > svg') return this.children.filter(c => c.tagName === 'SVG'); return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  get offsetWidth() { return 120; } get offsetHeight() { return 40; }
}
global.document = {
  createElement: t => new Node_(t), createElementNS: (ns, t) => new Node_(t, ns), createTextNode: t => { const n = new Node_('#text'); n._text = String(t); return n; },
  body: new Node_('body'), documentElement: { clientWidth: 1280 }
};
global.window = globalThis;
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
require(path.join(ROOT, 'assets/js/charts.js'));
const C = IGR.charts;

let total = 0, falhas = 0;
function check(nome, ok, det) { total++; if (!ok) falhas++; console.log((ok ? '  ok   ' : '  FALHA ') + nome + (ok ? '' : '  → ' + det)); }

const textWidth = (s, size) => String(s).length * (size || 12) * 0.56; // mesma estimativa do charts.js
function draw(W, opt) {
  const host = new Node_('div');
  Object.defineProperty(host, 'clientWidth', { value: W });
  C.lines(host, Object.assign({ fmt: v => String(v), labels: opt.values.map((_, i) => (i + 1) + ' out') }, opt));
  const svgEl = host.children.find(c => c.tagName === 'SVG');
  return { host, svg: svgEl };
}
const cls = (svg, c) => svg.find(n => (n.attrs.class || '').split(' ').includes(c));
const coords = d => (d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) || []).map(p => p.split(',').map(Number));

/* ---------- Casos ---------- */
const W = 900, H = 260;
const vals = [174000, 146000, 113000, 112000, 121000, 116000, 112849];
const cmpv = [195000, 188000, 266000, 235000, 296000, 241000, 172000];
let { svg } = draw(W, { values: vals, compare: cmpv, height: H });
check('desenha um SVG do tamanho pedido', svg && svg.attrs.width === String(W) && svg.attrs.height === String(H));
const line = cls(svg, 'igr-line').filter(n => !n.attrs.class.includes('is-compare'));
const cmpLine = cls(svg, 'is-compare');
check('uma linha do período atual + área', line.length === 1 && cls(svg, 'igr-area').length === 1);
check('uma linha de comparação', cmpLine.length === 1);
const pts = coords(line[0].attrs.d);
check('7 pontos na linha', pts.length === 7, pts.length);
check('pontos dentro do SVG', pts.every(([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H));
check('x crescente da esquerda para a direita', pts.every((p, i) => !i || p[0] > pts[i - 1][0]));
check('valor maior fica mais alto (y menor)', pts[0][1] < pts[1][1]);
const cpts = coords(cmpLine[0].attrs.d);
check('comparação alinhada pela posição (mesmos x)', cpts.every((p, i) => Math.abs(p[0] - pts[i][0]) < 0.11));
const endLabel = cls(svg, 'igr-end-label')[0];
check('rótulo do último valor', endLabel && endLabel.textContent === '112849', endLabel && endLabel.textContent);
check('rótulo do último valor cabe no SVG', +endLabel.attrs.x + textWidth('112849', 12) <= W, endLabel.attrs.x);
const ticks = cls(svg, 'igr-tick');
const xLabels = ticks.filter(t => t.attrs['text-anchor'] === 'middle');
check('rótulos do eixo x: primeiro e último aparecem', xLabels[0].textContent === '1 out' && xLabels[xLabels.length - 1].textContent === '7 out', xLabels.map(t => t.textContent));
const yTicks = ticks.filter(t => t.attrs['text-anchor'] === 'end');
check('eixo y vai até acima do maior valor (296 mil)', yTicks.some(t => +t.textContent >= 296000), yTicks.map(t => t.textContent));

// Muitos pontos: rótulos sem sobreposição e sem sair do SVG
for (const w of [340, 600, 1200]) {
  const many = Array.from({ length: 92 }, (_, i) => 100 + (i % 7) * 30);
  ({ svg } = draw(w, { values: many, labels: many.map((_, i) => (i % 31 + 1) + ' ' + ['jul', 'ago', 'set'][Math.floor(i / 31)]) }));
  const xl = cls(svg, 'igr-tick').filter(t => t.attrs['text-anchor'] === 'middle').map(t => ({ x: +t.attrs.x, w: textWidth(t.textContent, 11) }));
  const overlap = xl.some((l, i) => i && l.x - l.w / 2 < xl[i - 1].x + xl[i - 1].w / 2);
  const outside = xl.some(l => l.x - l.w / 2 < -0.5 || l.x + l.w / 2 > w + 0.5);
  check('92 pontos em ' + w + 'px: ' + xl.length + ' rótulos, sem sobreposição e dentro do SVG', !overlap && !outside && xl.length >= 2, JSON.stringify(xl));
  check('92 pontos em ' + w + 'px: foco por teclado desligado (muitos pontos)', cls(svg, 'igr-hit').every(h => h.attrs.tabindex == null));
}

// Buracos (null): linha interrompida, sem cair a zero
({ svg } = draw(W, { values: [10, 20, null, 40, 50, null, 70] }));
const segs = cls(svg, 'igr-line').filter(n => !n.attrs.class.includes('is-compare'));
check('null interrompe a linha (2 trechos + 1 ponto solto)', segs.length === 2 && cls(svg, 'igr-line-dot').length === 1, segs.length + ' trechos');
check('nenhum ponto desenhado no y do zero por causa de null', segs.every(s => coords(s.attrs.d).every(([, y]) => y < H - 28 - 0.5)));

// Último valor nulo: rótulo vai para o último ponto com dado
({ svg } = draw(W, { values: [5, 6, 7, null] }));
check('último valor nulo: rótulo no último ponto com dado', cls(svg, 'igr-end-label')[0].textContent === '7');

// Um ponto só
({ svg } = draw(W, { values: [42], labels: ['8 out'] }));
check('um ponto só: desenha ponto, sem linha', cls(svg, 'igr-line').length === 0 && cls(svg, 'igr-line-dot').length === 1);

// Tudo nulo ou zero: estado vazio, sem SVG
let r = draw(W, { values: [null, null] });
check('tudo nulo: mensagem de "sem dados"', !r.svg && r.host.textContent.length > 0);
r = draw(W, { values: [0, 0, 0] });
check('tudo zero: mensagem de "sem dados"', !r.svg);

// Taxas (0–1) com formatação de porcentagem no eixo
({ svg } = draw(W, { values: [0.031, 0.045, null, 0.052], fmt: v => (v * 100).toFixed(1) + '%', fmtAxis: v => Math.round(v * 100) + '%' }));
check('taxa: eixo em % e rótulo final em %', cls(svg, 'igr-tick').some(t => /%$/.test(t.textContent)) && cls(svg, 'igr-end-label')[0].textContent === '5.2%');

// Inteiros pequenos: passos inteiros no eixo y
({ svg } = draw(W, { values: [0, 1, 3, 2, 1], integer: true }));
const yv = cls(svg, 'igr-tick').filter(t => t.attrs['text-anchor'] === 'end').map(t => +t.textContent);
check('contagens pequenas: eixo y só com inteiros', yv.every(Number.isInteger), yv);

// Interação: guia e marcadores aparecem no hover e somem ao sair
({ svg } = draw(W, { values: vals, compare: cmpv, tip: i => ({ title: 'dia ' + i, rows: [] }) }));
const hits = cls(svg, 'igr-hit');
check('uma área de hover por ponto', hits.length === 7, hits.length);
check('foco por teclado em poucos pontos', hits.every(h => h.attrs.tabindex === '0'));
const guide = cls(svg, 'igr-guide')[0];
check('guia começa escondida', guide.attrs.visibility === 'hidden');
hits[3].fire('pointerenter', { type: 'pointerenter', clientX: 400, clientY: 100 });
const x3 = coords(line[0] ? cls(svg, 'igr-line').find(n => !n.attrs.class.includes('is-compare')).attrs.d : '')[3][0];
check('hover: guia aparece no x do ponto', guide.attrs.visibility === 'visible' && Math.abs(+guide.attrs.x1 - x3) < 0.11, guide.attrs.x1 + ' vs ' + x3);
const focus = cls(svg, 'igr-line-focus');
check('hover: marcadores dos dois períodos aparecem', focus.length === 2 && focus.every(f => f.attrs.visibility === 'visible'));
const tipEl = document.body.children.find(c => (c.className || '').includes('igr-tooltip'));
check('hover: tooltip com o conteúdo do ponto', tipEl && tipEl.className.includes('is-visible') && tipEl.textContent.includes('dia 3'));
hits[3].fire('pointerleave');
check('saída: guia, marcadores e tooltip somem', guide.attrs.visibility === 'hidden' && focus.every(f => f.attrs.visibility === 'hidden') && !tipEl.className.includes('is-visible'));
check('áreas de hover não se sobrepõem', hits.every((h, i) => !i || +h.attrs.x >= +hits[i - 1].attrs.x + +hits[i - 1].attrs.width - 0.01));

// Redesenho no mesmo elemento (troca de métrica): substitui o SVG anterior
const host = new Node_('div'); Object.defineProperty(host, 'clientWidth', { value: W });
C.lines(host, { values: [1, 2, 3], labels: ['a', 'b', 'c'] });
C.lines(host, { values: [4, 5, 6, 7], labels: ['a', 'b', 'c', 'd'] });
check('troca de métrica: um SVG só, com os dados novos', host.children.filter(c => c.tagName === 'SVG').length === 1 && cls(host.children[0], 'igr-end-label')[0].textContent === '7');
check('viewBox definido (o SVG encolhe na impressão/PDF)', host.children[0].attrs.viewBox === '0 0 ' + W + ' 260');

console.log('\n' + (total - falhas) + '/' + total + ' ok' + (falhas ? ' — ' + falhas + ' FALHA(S)' : ''));
process.exit(falhas ? 1 : 0);
