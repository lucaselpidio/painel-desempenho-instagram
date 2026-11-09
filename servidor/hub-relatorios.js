/* ==========================================================================
   Servidor do relatório + repasse ao Hub de Relatórios (Node.js 18+, sem dependências)
   --------------------------------------------------------------------------
   - Serve a pasta relatorio-instagram/ (menos esta pasta servidor/).
   - POST /api/hub-relatorios/relatorios: recebe o multipart do botão "Exportar PDF"
     e repassa, sem alterar, à API de Relatórios do Hub de Relatórios com o segredo.

   O segredo fica só aqui, na variável de ambiente (nunca no navegador nem no código):
     PowerShell:  $env:HUB_SEGREDO = '<segredo>'; node servidor/hub-relatorios.js
     bash:        HUB_SEGREDO='<segredo>' node servidor/hub-relatorios.js

   Variáveis opcionais: PORT (8080), HOST (127.0.0.1), HUB_URL (API oficial).
   ========================================================================== */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const SEGREDO = process.env.HUB_SEGREDO || '';
const HUB_URL = process.env.HUB_URL || 'https://hub.example.com/api/integracoes/relatorios';
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const ROTA = '/api/hub-relatorios/relatorios';
const LIMITE = 201 * 1024 * 1024; // 200 MB de PDF + campos
const TIMEOUT = 180 * 1000;       // a API pede no mínimo 120 s

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > LIMITE) { reject(Object.assign(new Error('Arquivo acima de 200 MB.'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function repassar(req, res) {
  // Só aceita chamadas do próprio relatório: o cabeçalho X-IGR-Hub obriga o navegador a
  // pedir permissão (CORS) a outros sites, e este servidor não concede.
  const origem = req.headers.origin;
  if (req.headers['x-igr-hub'] !== '1' || (origem && origem !== 'http://' + req.headers.host)) {
    return json(res, 403, { ok: false, motivo: 'Origem não autorizada.' });
  }
  if (!SEGREDO) return json(res, 503, { ok: false, motivo: 'Servidor sem HUB_SEGREDO configurado.' });
  const tipo = req.headers['content-type'] || '';
  if (!tipo.startsWith('multipart/form-data')) return json(res, 400, { ok: false, motivo: 'Envie multipart/form-data.' });

  let corpo;
  try { corpo = await lerCorpo(req); } catch (e) { return json(res, e.status || 400, { ok: false, motivo: e.message }); }

  try {
    const r = await fetch(HUB_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + SEGREDO, 'Content-Type': tipo },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT)
    });
    const texto = await r.text();
    let resposta;
    try { resposta = JSON.parse(texto); } catch (e) { resposta = { ok: false, motivo: 'Resposta inesperada do hub (HTTP ' + r.status + ').' }; }
    console.log('[hub-relatorios]', r.status, resposta.ok ? 'ok ' + (resposta.repetido ? '(repetido) ' : '') + (resposta.id || '') + ' → ' + (resposta.conta || '') : resposta.motivo);
    json(res, r.status, resposta);
  } catch (e) {
    // Falha de rede ou timeout: o mesmo id_externo pode ser reenviado sem duplicar no hub
    console.error('[hub-relatorios] falha de rede:', e.message);
    json(res, 502, { ok: false, motivo: 'Sem resposta do Hub de Relatórios. Tente de novo em alguns minutos.' });
  }
}

function estatico(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const arquivo = path.resolve(ROOT, '.' + rel);
  const dentro = arquivo.startsWith(ROOT + path.sep);
  if (!dentro || arquivo.startsWith(__dirname + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream' });
    res.end(dados);
  });
}

http.createServer((req, res) => {
  const rota = req.url.split('?')[0];
  if (rota === ROTA) {
    if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Use POST.' });
    return repassar(req, res).catch(e => { console.error(e); json(res, 500, { ok: false, motivo: 'Erro interno.' }); });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  estatico(req, res);
}).listen(PORT, HOST, () => {
  console.log('Relatório em http://' + HOST + ':' + PORT + '/');
  if (!SEGREDO) console.warn('Aviso: HUB_SEGREDO não definido — o envio ao Hub de Relatórios vai falhar.');
});
