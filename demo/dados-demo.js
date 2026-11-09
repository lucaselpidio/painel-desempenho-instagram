/* ==========================================================================
   IGRDemo — exports 100% fictícios do Meta Business Suite para a demonstração
   --------------------------------------------------------------------------
   Perfil, pessoas, marcas e números são inventados. Qualquer semelhança com
   perfis reais é coincidência.

   Gera os mesmos arquivos que o Meta exporta (mesmas colunas, datas e codificação):
     - conteúdos do feed, em duas janelas de 90 dias (como quem exporta duas vezes);
     - conteúdos dos stories, nas mesmas duas janelas;
     - público (seguidores por dia, idade × gênero, cidades e países), um por janela.

   As datas são relativas a hoje (o último dia exportado é ontem) e o resultado é
   determinístico: a mesma data de referência gera sempre os mesmos arquivos.

   Uso: IGRDemo.gerar()              → { dona, seguidores, arquivos: [{ nome, texto, utf16 }] }
        IGRDemo.gerar('2026-11-09')  → com outra data de referência
   ========================================================================== */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ datas (UTC, sem fuso)
  const DIA = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const data = (s) => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const iso = (d) => d.toISOString().slice(0, 10);
  const somar = (s, n) => iso(new Date(data(s).getTime() + n * DIA));
  const diaSemana = (s) => (data(s).getUTCDay() + 6) % 7; // 0 = segunda
  const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nomeData = (s) => MESES[+s.slice(5, 7) - 1] + '-' + s.slice(8, 10) + '-' + s.slice(0, 4); // Oct-07-2026
  const horario = (s, h, m) => s.slice(5, 7) + '/' + s.slice(8, 10) + '/' + s.slice(0, 4) + ' ' + pad(h) + ':' + pad(m); // MM/DD/AAAA HH:mm
  function hojeLocal() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ------------------------------------------------------------------ aleatoriedade com semente
  function sorteio(chave) {
    let h = 2166136261;
    for (let i = 0; i < chave.length; i++) { h ^= chave.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    const r = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.item = (l) => l[Math.floor(r() * l.length)];
    r.entre = (a1, b1) => a1 + r() * (b1 - a1);
    r.int = (a1, b1) => Math.floor(r.entre(a1, b1 + 1));
    r.normal = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    r.lognormal = (s) => Math.exp(s * r.normal());
    r.poisson = (m) => { const L = Math.exp(-m); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
    return r;
  }

  // ------------------------------------------------------------------ perfil fictício
  const DONA = { id: '17841400000000001', usuario: 'clara.nutri.demo', nome: 'Dra. Clara Nogueira | Nutrição Descomplicada' };
  const PARCEIROS = [
    { id: '17841400000000101', usuario: 'mercado.verde.demo', nome: 'Mercado Verde (demo)' },
    { id: '17841400000000102', usuario: 'studio.movimento.demo', nome: 'Studio Movimento | Pilates (demo)' },
    { id: '17841400000000103', usuario: 'chef.lia.demo', nome: 'Chef Lia (demo)' },
  ];

  /* Temas das legendas: formato preferido, peso no desempenho e modelos de texto.
     A história que os dados contam: rótulos e mitos são os temas mais fortes; bastidores, os mais fracos. */
  const TEMAS = [
    { chave: 'rotulos', fator: 1.55, formatos: ['carrossel', 'carrossel', 'reel'], textos: [
      'Como ler o rótulo do {produto} sem cair em pegadinha #rotulos #nutricao #alimentacaosaudavel',
      'Lista de ingredientes: o que vem primeiro importa 👀 #rotulos #nutricao',
      '"Zero açúcar" não é sinônimo de saudável. Entenda o rótulo do {produto} #rotulos #nutricao'] },
    { chave: 'mitos', fator: 1.4, formatos: ['reel', 'reel', 'carrossel'], textos: [
      'Mito ou verdade: {mito}? #mitosdanutricao #nutricao',
      'Você acredita nisso? {mito} #mitosdanutricao',
      '{mito}: o que a ciência diz de verdade #mitosdanutricao #nutricao']},
    { chave: 'receitas', fator: 1.2, formatos: ['reel', 'reel', 'imagem'], textos: [
      'Lanche da tarde em 5 minutos: {receita} 🥣 #receitasaudavel #lanche',
      'Café da manhã sem pressa: {receita} #receitasaudavel #cafedamanha',
      'Testei e aprovei: {receita} com 4 ingredientes #receitasaudavel',
      'Receita de hoje: {receita}, sem complicação #receitasaudavel #nutricao',
      '{receita} para a semana toda #receitasaudavel #marmita'] },
    { chave: 'marmitas', fator: 1.1, formatos: ['carrossel', 'reel'], textos: [
      'Marmitas da semana: {n} combinações para não enjoar #marmita #organizacao',
      'Como montar uma marmita equilibrada em 4 passos #marmita #nutricao',
      'Quanto tempo a marmita dura na geladeira? #marmita #organizacao',
      'Marmita congelada: o que pode e o que não pode #marmita'] },
    { chave: 'hidratacao', fator: 0.9, formatos: ['imagem', 'reel'], textos: [
      'Quanta água você precisa por dia? 💧 #hidratacao #saude',
      'Três sinais de que você está bebendo pouca água #hidratacao',
      'Água com gás hidrata igual? #hidratacao #mitosdanutricao',
      'Dicas para lembrar de beber água no trabalho 💧 #hidratacao',
      'Chás contam como hidratação? #hidratacao #saude'] },
    { chave: 'duvidas', fator: 0.85, formatos: ['reel', 'imagem'], textos: [
      'Respondendo suas dúvidas sobre {tema} 💬',
      'Caixinha de perguntas: {tema} 💬 #nutricao'] },
    { chave: 'bastidores', fator: 0.7, formatos: ['imagem', 'reel'], textos: [
      'Um dia no consultório 🩺 #bastidores #nutricionista',
      'Bastidores da gravação de hoje ✨ #bastidores',
      'Como é uma primeira consulta comigo 🩺 #nutricionista',
      'Meu lanche entre um atendimento e outro #bastidores #lanche'] },
  ];
  const SUBST = {
    produto: ['iogurte', 'pão integral', 'granola', 'suco de caixinha', 'biscoito de arroz', 'barrinha de proteína', 'requeijão light', 'molho de tomate pronto', 'bebida vegetal'],
    mito: ['Comer à noite engorda', 'Carboidrato à noite atrapalha a dieta', 'Açúcar mascavo é muito mais saudável', 'Ovo aumenta o colesterol', 'Fruta tem açúcar demais', 'Pão integral emagrece', 'Glúten faz mal para todo mundo', 'Tomar café em jejum faz mal'],
    receita: ['overnight oats de banana', 'panqueca de aveia', 'bolo de caneca de cacau', 'wrap de frango', 'salada de grão-de-bico', 'muffin de legumes', 'omelete de forno', 'creme de abacate', 'hambúrguer de lentilha', 'cookie de aveia'],
    tema: ['proteína', 'lanches para o trabalho', 'jejum intermitente', 'suplementos', 'doces na dieta', 'fibras', 'refeições fora de casa', 'sono e fome'],
    n: ['5', '7', '10'],
  };
  const preencher = (r, t) => t.replace(/\{(\w+)\}/g, (m, k) => r.item(SUBST[k]));

  const TIPO = { reel: 'Reel do Instagram', carrossel: 'Carrossel do Instagram', imagem: 'Imagem do Instagram', story: 'Story do Instagram' };
  const BASE_VIEWS = { reel: 3300, carrossel: 1500, imagem: 650 };

  // ------------------------------------------------------------------ CSV no formato do Meta
  const celula = (v) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const CAB_FEED = '"Identificação do post","Identificação da conta","Nome de usuário da conta","Nome da conta",Descrição,"Duração (s)","Horário de publicação","Link permanente","Tipo de post","Comentário de dados",Data,Visualizações,Alcance,Curtidas,Compartilhamentos,Seguimentos,Comentários,Salvamentos';
  const CAB_STORIES = '"Identificação do post","Identificação da conta","Nome de usuário da conta","Nome da conta",Descrição,"Duração (s)","Horário de publicação","Link permanente","Tipo de post","Comentário de dados",Data,Visualizações,Alcance,Curtidas,Compartilhamentos,"Visitas ao perfil",Respostas,Navegação,"Cliques no link",Seguimentos,"Toques em figurinhas"';

  function gerar(hojeISO) {
    const hoje = hojeISO || hojeLocal();
    const fim = somar(hoje, -1);           // o export vai até ontem
    const inicio = somar(fim, -179);       // 180 dias = duas janelas de 90
    const meio = somar(fim, -89);          // início da janela mais recente
    const pausa = [somar(fim, -62), somar(fim, -51)]; // férias: 12 dias sem posts no feed
    const viralDesde = somar(fim, -22);    // o primeiro reel depois daqui viraliza (cai nos "Últimos 30 dias", onde a demo abre)
    const r0 = sorteio('ids|' + hoje);
    let seqPost = 0;
    const idPost = (pref) => pref + String(1e15 + (++seqPost) * 7919 + r0.int(0, 999)).slice(-16);
    const progresso = (d) => (data(d) - data(inicio)) / (data(fim) - data(inicio)); // 0 → 1

    // ---------------------------------------------------------------- feed
    const posts = [];
    let viralFeito = false;
    const legendasUsadas = new Set(); // contas reais não repetem a mesma legenda
    const legenda = (r, tema) => {
      for (let i = 0; i < 20; i++) { const l = preencher(r, r.item(tema.textos)); if (!legendasUsadas.has(l)) { legendasUsadas.add(l); return l; } }
      return null; // tema esgotado
    };
    const slots = [ // [probabilidade, horas possíveis, fator de horário]
      [0.25, [12, 13, 18], 0.95], [0.85, [19, 20, 21], 1.15], [0.25, [12, 13, 18], 0.95],
      [0.85, [19, 20, 21], 1.15], [0.25, [12, 18], 0.95], [0.1, [10, 11], 0.8], [0.5, [9, 10, 11], 1.05]];
    for (let d = inicio; d <= fim; d = somar(d, 1)) {
      if (d >= pausa[0] && d <= pausa[1]) continue;
      const r = sorteio('feed|' + d);
      const [prob, horas, fatorHora] = slots[diaSemana(d)];
      if (r() > prob) continue;
      let tema = r.item(TEMAS), desc = legenda(r, tema);
      // Tema sem legenda nova: o post muda de assunto (em vez de repetir uma legenda)
      for (const outro of TEMAS.slice().sort(() => r() - 0.5)) { if (desc) break; desc = legenda(r, outro); if (desc) tema = outro; }
      if (!desc) desc = preencher(r, r.item(tema.textos));
      const formato = r() < 0.15 ? r.item(['reel', 'carrossel', 'imagem']) : r.item(tema.formatos);
      const crescimento = 0.75 + 0.6 * progresso(d);
      const viral = !viralFeito && formato === 'reel' && d >= viralDesde;
      if (viral) viralFeito = true;
      const views = Math.round(BASE_VIEWS[formato] * tema.fator * fatorHora * crescimento * r.lognormal(0.42) * (viral ? 6 : 1));
      const revisualizacao = formato === 'carrossel' ? r.entre(1.6, 2.1) : formato === 'reel' ? r.entre(1.15, 1.45) : r.entre(1.05, 1.2);
      const alcance = Math.round(views / revisualizacao);
      const taxa = (a1, b1) => Math.round(alcance * r.entre(a1, b1));
      posts.push({
        id: idPost('18'), conta: DONA, desc,
        duracao: formato === 'reel' ? r.int(18, 75) : 0,
        data: d, hora: r.item(horas), minuto: r.int(0, 59), tipo: TIPO[formato],
        views, alcance,
        curtidas: taxa(formato === 'carrossel' ? 0.05 : 0.035, formato === 'carrossel' ? 0.07 : 0.05),
        compart: taxa(viral ? 0.035 : 0.006, viral ? 0.045 : formato === 'imagem' ? 0.008 : 0.014),
        seguimentos: taxa(viral ? 0.005 : 0.0008, viral ? 0.007 : 0.0022),
        comentarios: taxa(tema.chave === 'duvidas' ? 0.01 : 0.002, tema.chave === 'duvidas' ? 0.016 : 0.006),
        salvamentos: taxa(formato === 'carrossel' ? 0.04 : formato === 'reel' ? 0.01 : 0.002, formato === 'carrossel' ? 0.065 : formato === 'reel' ? 0.018 : 0.006),
      });
    }
    // Collabs: posts de parceiros em que a dona entrou como colaboradora (ficam fora dos totais do relatório)
    const rc = sorteio('collabs|' + hoje);
    const textosCollab = ['Collab com @clara.nutri.demo: compras inteligentes no mercado 🛒', 'Treino e alimentação andam juntos, com @clara.nutri.demo 🧘',
      'Receita a quatro mãos com @clara.nutri.demo 👩‍🍳', 'O que levar na lancheira, com @clara.nutri.demo'];
    for (let i = 0; i < 7; i++) {
      const p = PARCEIROS[i % PARCEIROS.length], d = somar(inicio, rc.int(5, 175));
      if (d >= pausa[0] && d <= pausa[1]) continue;
      const views = Math.round(5200 * rc.lognormal(0.5)), alcance = Math.round(views / rc.entre(1.2, 1.4));
      posts.push({ id: idPost('18'), conta: p, desc: rc.item(textosCollab), duracao: rc.int(20, 60), data: d, hora: rc.int(11, 20), minuto: rc.int(0, 59),
        tipo: TIPO.reel, views, alcance, curtidas: Math.round(alcance * 0.045), compart: Math.round(alcance * 0.01), seguimentos: Math.round(alcance * 0.0015),
        comentarios: Math.round(alcance * 0.004), salvamentos: Math.round(alcance * 0.012) });
    }

    // ---------------------------------------------------------------- stories
    const stories = [];
    const STORY_TEXTOS = [
      ['', 0], ['Bom dia! Café da manhã de hoje ☕', 0], ['Enquete: você lê o rótulo antes de comprar?', 'enquete'],
      ['Caixinha de perguntas aberta 💬', 'caixinha'], ['Link do e-book de lanches na figurinha 👆', 'link'],
      ['Compras da semana no @mercado.verde.demo 🛒', 'mencao'], ['Aula de hoje no @studio.movimento.demo', 'mencao'],
      ['Testei a granola da @granola.caseira.demo', 'mencao'], ['Quiz: qual tem mais açúcar?', 'enquete'], ['Novo post no feed! 👀', 0]];
    for (let d = inicio; d <= fim; d = somar(d, 1)) {
      const r = sorteio('stories|' + d);
      if (r() > (diaSemana(d) >= 5 ? 0.55 : 0.85)) continue;
      const n = Math.max(1, Math.min(12, r.poisson(4.5)));
      const crescimento = 0.8 + 0.4 * progresso(d);
      const base = 1150 * crescimento * r.entre(0.85, 1.15);
      let hora = r.int(7, 10);
      for (let k = 0; k < n; k++) {
        const [desc, tipo] = r.item(STORY_TEXTOS);
        const alcance = Math.round(base * Math.pow(0.9, k) * r.entre(0.92, 1.08)); // cada story a mais no dia perde audiência
        const views = Math.round(alcance * r.entre(1.05, 1.18));
        stories.push({
          id: idPost('17'), desc, data: d, hora: Math.min(23, hora), minuto: r.int(0, 59), views, alcance,
          curtidas: Math.round(alcance * r.entre(0.01, 0.025)), compart: r.poisson(alcance * 0.002),
          visitas: Math.round(alcance * r.entre(0.006, 0.014)),
          respostas: tipo === 'caixinha' ? r.int(18, 45) : r.poisson(alcance * 0.002),
          navegacao: Math.round(views * r.entre(0.68, 0.82)),
          cliques: tipo === 'link' ? Math.round(alcance * r.entre(0.02, 0.045)) : 0,
          seguimentos: r() < 0.15 ? r.int(1, 3) : 0,
          figurinhas: tipo === 'enquete' ? Math.round(alcance * r.entre(0.12, 0.22)) : tipo === 'mencao' ? r.int(3, 15) : tipo === 'link' ? r.int(5, 20) : 0,
        });
        hora += r.int(1, 3);
      }
    }

    // ---------------------------------------------------------------- público
    const novos = {};
    const diaViral = (posts.find((p) => p.conta === DONA && p.views > 15000) || {}).data;
    for (let d = inicio; d <= fim; d = somar(d, 1)) {
      const r = sorteio('seguidores|' + d);
      let m = (6 + 8 * progresso(d)) * (diaSemana(d) >= 5 ? 0.75 : 1);
      if (d >= pausa[0] && d <= pausa[1]) m *= 0.45;
      let v = r.poisson(m);
      if (diaViral) { const k = (data(d) - data(diaViral)) / DIA; if (k >= 0 && k < 4) v += [160, 95, 40, 15][k]; }
      novos[d] = v;
    }
    const totalSeguidores = 14200 + Object.values(novos).reduce((a, b) => a + b, 0);

    function publico(de, ate, variacao) {
      const linhas = ['sep=,', '"Seguidores"', '"Data","Primary"'];
      for (let d = de; d <= ate; d = somar(d, 1)) if (novos[d] > 0) linhas.push('"' + d + 'T00:00:00","' + novos[d] + '"');
      const idade = [['18-24', 1.6, 7.9], ['25-34', 4.9, 31.4], ['35-44', 3.8, 26.2], ['45-54', 1.9, 13.1], ['55-64', 0.8, 5.6], ['65+', 0.4, 2.4]];
      linhas.push('', '"Faixa etária e gênero"', '"","Mulheres","Homens"');
      idade.forEach(([f, h, m]) => linhas.push('"' + f + '","' + (m + variacao).toFixed(1) + '","' + Math.max(0.1, h - variacao / 2).toFixed(1) + '"'));
      const cidades = [['São Paulo, SP', 21.4], ['Campinas, SP', 6.8], ['Rio de Janeiro, RJ', 6.1], ['Belo Horizonte, MG', 4.2], ['Curitiba, PR', 3.5],
        ['Ribeirão Preto, SP', 2.9], ['Santos, SP', 2.2], ['Porto Alegre, RS', 1.9], ['Salvador, BA', 1.6], ['Sorocaba, SP', 1.4]];
      const paises = [['Brasil', 96.1], ['Portugal', 1.6], ['Estados Unidos', 0.9], ['Japão', 0.3], ['Irlanda', 0.2]];
      const bloco = (titulo, lista) => linhas.push('', '"' + titulo + '"', lista.map((x) => '"' + x[0] + '"').join(','), lista.map((x) => '"' + (x[1] + variacao / 3).toFixed(1) + '"').join(','));
      bloco('Principais cidades', cidades);
      bloco('Principais países', paises);
      linhas.push('', '"Principais Páginas"', '', '');
      return linhas.join('\n') + '\n';
    }

    // ---------------------------------------------------------------- arquivos
    const linhaFeed = (p) => [p.id, p.conta.id, p.conta.usuario, p.conta.nome, p.desc, p.duracao, horario(p.data, p.hora, p.minuto), '', p.tipo, '', 'Total',
      p.views, p.alcance, p.curtidas, p.compart, p.seguimentos, p.comentarios, p.salvamentos].map(celula).join(',');
    const linhaStory = (s) => [s.id, DONA.id, DONA.usuario, DONA.nome, s.desc, 0, horario(s.data, s.hora, s.minuto), '', TIPO.story, '', 'Total',
      s.views, s.alcance, s.curtidas, s.compart, s.visitas, s.respostas, s.navegacao, s.cliques, s.seguimentos, s.figurinhas].map(celula).join(',');
    const ordem = (a, b) => (b.data + pad(b.hora) + pad(b.minuto)).localeCompare(a.data + pad(a.hora) + pad(a.minuto)); // como o Meta: mais recente primeiro
    const janela = (lista, de, ate) => lista.filter((x) => x.data >= de && x.data <= ate).sort(ordem);
    const nome = (de, ate, sufixo) => nomeData(de) + '_' + nomeData(ate) + '_' + sufixo + '.csv';
    const arquivos = [];
    [[inicio, somar(meio, -1), 'a'], [meio, fim, 'b']].forEach(([de, ate, j]) => {
      const rid = sorteio('arquivo|' + hoje + j);
      const sufixo = () => String(rid.int(1e8, 9e8)) + String(rid.int(1e6, 9e6));
      arquivos.push({ nome: nome(de, ate, sufixo()), texto: [CAB_FEED].concat(janela(posts, de, ate).map(linhaFeed)).join('\n') + '\n', utf16: false });
      arquivos.push({ nome: nome(de, ate, sufixo()), texto: [CAB_STORIES].concat(janela(stories, de, ate).map(linhaStory)).join('\n') + '\n', utf16: false });
      arquivos.push({ nome: j === 'a' ? 'Público (anterior).csv' : 'Público.csv', texto: publico(de, ate, j === 'a' ? -0.4 : 0), utf16: true });
    });

    return { dona: DONA.usuario, seguidores: { total: totalSeguidores, data: fim }, periodo: { inicio, fim }, arquivos };
  }

  global.IGRDemo = { gerar, hoje: hojeLocal };
})(typeof window !== 'undefined' ? window : globalThis);
