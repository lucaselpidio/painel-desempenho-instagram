#!/usr/bin/env node
/**
 * Valida os exports fictícios de demo/dados-demo.js com o parser real do relatório (assets/js/parsers.js)
 * e grava os arquivos em dados-ficticios/, com a mesma codificação do Meta Business Suite
 * (conteúdos em UTF-8 com BOM; Público em UTF-16 LE com BOM).
 *
 *   node scripts/exportar-dados.mjs              data de referência: hoje
 *   node scripts/exportar-dados.mjs 2026-11-09   outra data
 *
 * Sem dependências. Sai com código 1 se alguma verificação falhar.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {}; ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['assets/js/parsers.js', 'demo/dados-demo.js']) vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx);
const { IGR, IGRDemo } = ctx;

const referencia = process.argv[2] || IGRDemo.hoje();
const demo = IGRDemo.gerar(referencia);
const falhas = [];
const conferir = (ok, msg) => { if (!ok) falhas.push(msg); };

conferir(JSON.stringify(IGRDemo.gerar(referencia)) === JSON.stringify(demo), 'a mesma data precisa gerar os mesmos arquivos');
const ids = new Set(), legendas = new Set();
let nPosts = 0, nStories = 0, nPublico = 0;
for (const a of demo.arquivos) {
  const p = IGR.parsers.parseText(a.nome, a.texto);
  if (p.kind === 'audience') {
    nPublico++;
    conferir(p.followers && p.followers.length > 60 && p.ageGender && p.ageGender.rows.length === 6 && p.cities && p.countries, a.nome + ': público incompleto');
    continue;
  }
  conferir(p.kind === 'posts' && p.period, a.nome + ': não foi reconhecido como export de conteúdos com período');
  for (const x of p.posts) {
    // O parser devolve os campos brutos; dia e interações são calculados depois, no app (metrics.js)
    const d = new Date(x.ts), dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const interacoes = x.likes + x.comments + x.shares + x.saves;
    conferir(!ids.has(x.id), 'ID repetido: ' + x.id); ids.add(x.id);
    conferir(dia >= p.period.start && dia <= p.period.end, x.id + ': fora do período do arquivo (' + dia + ')');
    conferir(x.reach <= x.views && x.likes <= x.reach && interacoes <= x.reach, x.id + ': métricas incoerentes (alcance > visualizações ou interações > alcance)');
    if (x.type === 'story') nStories++;
    else {
      nPosts++;
      if (x.username === demo.dona) { conferir(!legendas.has(x.description), 'legenda repetida: ' + x.description); legendas.add(x.description); }
    }
  }
}
conferir(nPosts > 40 && nStories > 300 && nPublico === 2, 'volume inesperado: ' + [nPosts, nStories, nPublico]);

const pasta = path.join(RAIZ, 'dados-ficticios');
fs.rmSync(pasta, { recursive: true, force: true });
fs.mkdirSync(pasta, { recursive: true });
for (const a of demo.arquivos) {
  const bytes = a.utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(a.texto, 'utf16le')]) : Buffer.from('﻿' + a.texto, 'utf8');
  fs.writeFileSync(path.join(pasta, a.nome), bytes);
}

console.log('Referência: ' + referencia + ' · perfil @' + demo.dona + ' · ' + demo.periodo.inicio + ' a ' + demo.periodo.fim);
console.log(nPosts + ' posts do feed (inclui collabs) · ' + nStories + ' stories · ' + nPublico + ' exports de público · ' + demo.seguidores.total + ' seguidores');
if (falhas.length) { console.error(falhas.length + ' verificação(ões) falharam:\n  ' + falhas.slice(0, 10).join('\n  ')); process.exit(1); }
console.log('Todas as verificações passaram. Arquivos gravados em dados-ficticios/.');
