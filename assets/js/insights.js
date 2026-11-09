/* ==========================================================================
   IGR.insights — leitura automática dos dados (regras determinísticas)
   --------------------------------------------------------------------------
   Cada regra só gera texto quando há dados suficientes. Trechos entre **...**
   são renderizados em destaque (como nós de texto — nunca como HTML).
   tone: 'destaque' | 'oportunidade' | 'atencao' | 'contexto'
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR = global.IGR || {};
  const M = IGR.metrics;
  const { fmt } = M;

  function excerpt(p, max) {
    max = max || 60;
    const firstLine = String(p.description || '').split('\n').map(s => s.trim()).find(s => s && !/^#/.test(s)) || '';
    const clean = firstLine.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ')
      .replace(/\*{2,}/g, '*') // "**" da legenda não pode virar marcador de negrito das leituras
      .trim();
    if (!clean) return p.format && p.format.key === 'story' ? 'sem texto' : 'sem legenda';
    return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
  }

  const pctDiff = (a, b) => (b > 0 ? (a - b) / b : null);
  const signedPct = v => (v >= 0 ? '+' : '−') + fmt.pct(Math.abs(v), 0);

  function generate(ctx) {
    const { posts, summary: s, prevSummary: prev, formats, audience, followers } = ctx;
    const out = [];
    // Sem posts no feed (ex.: só stories + público), as regras de feed se
    // desligam sozinhas; público, seguidores e stories continuam valendo.
    const hasFeed = posts.length > 0;
    const median = s.medianViews || 0;

    /* 1. Panorama (feed — stories têm leitura própria) */
    if (hasFeed) {
      const one = s.n === 1;
      let text = `**${fmt.int(s.n)} ${one ? 'post' : 'posts'} no feed** ${one ? 'gerou' : 'geraram'} **${fmt.compact(s.views)} visualizações** e **${fmt.compact(s.interactions)} interações**, ` +
        `com taxa de engajamento de **${fmt.pct(s.er)}** sobre o alcance.`;
      if (s.viewsPerReach) text += ` Em média, cada conta alcançada viu ${one ? 'o post' : 'os posts'} ${fmt.dec(s.viewsPerReach)} vezes.`;
      if (prev && prev.n) {
        const dv = pctDiff(s.views, prev.views);
        if (dv != null) text += ` Visualizações ${dv >= 0 ? 'cresceram' : 'caíram'} **${fmt.pct(Math.abs(dv), 0)}** frente ao período anterior (${fmt.int(prev.n)} ${prev.n === 1 ? 'post' : 'posts'}).`;
      }
      out.push({ tone: 'contexto', title: 'Panorama do período', text });
    }

    /* 2. Conteúdo mais visto */
    const byViews = posts.slice().sort((a, b) => b.views - a.views);
    const top = byViews[0];
    if (top && top.views > 0) {
      const k = median > 0 ? top.views / median : null;
      let text = `${top.format.single} de ${fmt.dateShort(top.ts)} — “${excerpt(top)}” — somou **${fmt.compact(top.views)} visualizações**` +
        (posts.length >= 3 && k ? `, **${fmt.times(k)} a mediana** do período.` : '.');
      if (posts.length >= 3 && k >= 2) text += ' Ponto fora da curva: vale entender o gancho, tema e formato para replicar.';
      out.push({ tone: 'destaque', title: 'O que as pessoas mais viram', text });
    }

    /* 3. Formatos */
    const comparable = formats.filter(f => f.n >= (posts.length >= 6 ? 2 : 1));
    if (comparable.length >= 2) {
      const byAvg = comparable.slice().sort((a, b) => b.avgViews - a.avgViews);
      const [best, second] = byAvg;
      const d = pctDiff(best.avgViews, second.avgViews);
      let text = `**${best.format.label}** entregam em média **${fmt.compact(best.avgViews)} visualizações** por post` +
        (d != null && d > 0.05 ? `, ${fmt.pct(d, 0)} acima de ${second.format.label.toLowerCase()}.` : `, próximo de ${second.format.label.toLowerCase()}.`);
      const byEr = comparable.filter(f => f.er != null).sort((a, b) => b.er - a.er);
      if (byEr.length && byEr[0].format.key !== best.format.key) {
        text += ` Já em engajamento, **${byEr[0].format.label.toLowerCase()}** lideram (${fmt.pct(byEr[0].er)} vs ${fmt.pct(best.er)}).`;
      }
      const postShare = best.n / s.n, viewShare = s.views ? best.views / s.views : 0;
      let tone = 'destaque';
      if (viewShare - postShare > 0.15) {
        tone = 'oportunidade';
        text += ` São ${fmt.pct(postShare, 0)} das publicações e ${fmt.pct(viewShare, 0)} das visualizações — aumentar a frequência deste formato tende a ampliar o alcance.`;
      }
      out.push({ tone, title: 'Formato que mais entrega', text });
    }

    /* 4. Seguidores */
    const followTotal = followers && followers.length ? M.sum(followers, p => p.value) : null;
    if (followTotal != null && followTotal > 0) {
      const peak = followers.reduce((a, b) => (b.value > a.value ? b : a));
      const avg = followTotal / followers.length;
      let text = `**+${fmt.int(followTotal)} novos seguidores** no período (média de ${fmt.dec(avg)} por dia). Pico em **${fmt.dayKey(peak.date)} (+${fmt.int(peak.value)})**`;
      const near = posts.filter(p => p.dateKey === peak.date || p.dateKey === M.addDays(peak.date, -1));
      if (peak.value >= avg * 2.5 && near.length) {
        text += `, logo após a publicação de “${excerpt(near[0], 50)}” (${near[0].format.single.toLowerCase()}).`;
      } else if (peak.value >= avg * 2.5) {
        const dayStories = (ctx.stories || []).filter(p => p.dateKey === peak.date).sort((a, b) => b.reach - a.reach);
        const topStory = dayStories[0];
        const topLabel = topStory && String(topStory.description || '').trim()
          ? `“${excerpt(topStory, 50)}”` : topStory ? `um story sem texto, às ${fmt.time(topStory.ts)}` : '';
        text += dayStories.length
          ? ` — sem post no feed no dia ou na véspera, mas com ${dayStories.length} ${dayStories.length === 1 ? 'story' : 'stories'} no dia (o de maior alcance: ${topLabel}).`
          : ` — sem publicação no dia ou na véspera; o ganho pode ter vindo de menções, colaborações ou mídia paga.`;
      } else text += '.';
      out.push({ tone: 'destaque', title: 'Crescimento da base', text });
    } else if (s.follows > 0) {
      const bestF = posts.slice().sort((a, b) => b.follows - a.follows)[0];
      out.push({
        tone: 'destaque', title: 'Conversão em seguidores',
        text: `Os posts geraram **${fmt.int(s.follows)} seguidores** diretos (${fmt.dec(s.followPer1k)} a cada mil contas alcançadas). Quem mais converteu: “${excerpt(bestF, 50)}” (+${fmt.int(bestF.follows)}).`
      });
    }

    /* 5. Público — gênero e idade */
    if (audience && audience.ageGender && audience.ageGender.rows.length) {
      const ag = audience.ageGender;
      const totals = ag.genders.map((g, i) => ({ g, v: M.sum(ag.rows, r => r.values[i]) }));
      const all = M.sum(totals, t => t.v) || 1;
      const lead = totals.slice().sort((a, b) => b.v - a.v)[0];
      const ageTotals = ag.rows.map(r => ({ age: r.age, v: M.sum(r.values) }));
      // melhor par de faixas consecutivas
      let bestPair = null;
      for (let i = 0; i < ageTotals.length - 1; i++) {
        const v = ageTotals[i].v + ageTotals[i + 1].v;
        if (!bestPair || v > bestPair.v) bestPair = { from: ageTotals[i].age, to: ageTotals[i + 1].age, v };
      }
      let biggest = null;
      ag.rows.forEach(r => r.values.forEach((v, i) => { if (!biggest || v > biggest.v) biggest = { v, age: r.age, g: ag.genders[i] }; }));
      const lo = bestPair ? bestPair.from.split(/[-–]/)[0] : '', hi = bestPair ? bestPair.to.split(/[-–]/).pop().replace('+', '') : '';
      // Faixa aberta (ex.: "55-64" + "65+") vira "a partir de 55 anos", não "entre 55 e 65"
      const openEnded = bestPair && bestPair.to.includes('+');
      const genderWord = /homem|homens|men|male/i.test(lead.g) ? 'masculino' : /mulher|women|female/i.test(lead.g) ? 'feminino' : lead.g.toLowerCase();
      const balanced = lead.v / all < 0.55;
      out.push({
        tone: 'contexto', title: 'Quem é o público',
        text: (balanced ? `Público equilibrado entre gêneros (${totals.map(t => t.g.toLowerCase() + ' ' + fmt.pctPoints(t.v / all * 100)).join(', ')})` :
          `Público majoritariamente **${genderWord} (${fmt.pctPoints(lead.v / all * 100)})**`) +
          (bestPair ? (openEnded
            ? `, concentrado a partir de **${lo} anos (${fmt.pctPoints(bestPair.v / all * 100)})**.`
            : `, concentrado entre **${lo} e ${hi} anos (${fmt.pctPoints(bestPair.v / all * 100)})**.`) : '.') +
          (biggest ? ` Maior grupo: ${biggest.g.toLowerCase()} de ${biggest.age} (${fmt.pctPoints(biggest.v)}).` : '')
      });
    }

    /* 6. Público — geografia */
    if (audience && (audience.cities && audience.cities.length || audience.countries && audience.countries.length)) {
      const c0 = audience.countries && audience.countries[0];
      const city = audience.cities && audience.cities[0];
      let text = '';
      if (c0) text += `**${fmt.pctPoints(c0.value)}** do público está em **${c0.name}**`;
      if (city) text += (text ? ' e ' : '') + `**${fmt.pctPoints(city.value)}** em **${city.name}**`;
      text += '.';
      let tone = 'contexto';
      if (city && city.value >= 30) {
        tone = 'oportunidade';
        text += ' Base fortemente local: conteúdos com referências, parcerias e eventos da região tendem a ter maior aderência.';
      }
      out.push({ tone, title: 'Onde o público está', text });
    }

    /* 7. Dia e horário */
    if (posts.length >= 6) {
      const days = M.WEEKDAYS.map((name, i) => {
        const list = posts.filter(p => p.weekday === i);
        return { name, n: list.length, avg: list.length ? M.mean(list, p => p.views) : 0 };
      }).filter(d => d.n >= 2);
      const bands = M.TIME_BANDS.map((b, i) => {
        const list = posts.filter(p => p.band === i);
        return { b, n: list.length, avg: list.length ? M.mean(list, p => p.views) : 0 };
      }).filter(d => d.n >= 2);
      if (days.length >= 2 || bands.length >= 2) {
        const bd = days.sort((a, b) => b.avg - a.avg)[0];
        const bb = bands.sort((a, b) => b.avg - a.avg)[0];
        const parts = [];
        if (bd && days.length >= 2) parts.push(`às **${bd.name.toLowerCase()}s** (média de ${fmt.compact(bd.avg)} visualizações, ${bd.n} posts)`);
        if (bb && bands.length >= 2) parts.push(`no horário **${bb.b.label}** (${fmt.compact(bb.avg)}, ${bb.n} posts)`);
        out.push({
          tone: 'oportunidade', title: 'Quando publicar',
          text: `Melhor desempenho médio ${parts.join(' e ')}. Use como hipótese para testes de calendário — a amostra é de ${posts.length} posts no feed.`
        });
      }
    }

    /* 8. Tipo de interação */
    if (s.interactions > 0 && s.reach > 0) {
      const per1k = v => fmt.dec(v / s.reach * 1000);
      const deep = (s.shares + s.saves + s.comments) / s.interactions;
      let text = `A cada mil contas alcançadas: **${per1k(s.likes)} curtidas**, ${per1k(s.comments)} comentários, **${per1k(s.shares)} compartilhamentos** e ${per1k(s.saves)} salvamentos.`;
      let tone = 'contexto';
      if (s.shares > s.saves * 2 && s.shares > s.comments) text += ' Compartilhamento é a ação mais forte além da curtida — sinal de conteúdo com potencial de distribuição orgânica.';
      else if (s.saves > s.shares && s.saves > s.comments) text += ' Salvamentos se destacam — o público trata o conteúdo como referência para consultar depois.';
      if (deep < 0.15) {
        tone = 'oportunidade';
        text += ` Apenas ${fmt.pct(deep, 0)} das interações vão além da curtida: chamadas para comentar, salvar ou enviar podem aprofundar a relação.`;
      }
      out.push({ tone, title: 'Como as pessoas reagiram', text });
    }

    /* 9. Concentração */
    const conc = M.concentration(posts);
    if (conc && conc.share >= 0.45) {
      out.push({
        tone: conc.share >= 0.6 ? 'atencao' : 'contexto', title: 'Concentração de resultados',
        text: `Os **${conc.k} posts** mais vistos (20% do total) concentram **${fmt.pct(conc.share, 0)} das visualizações**.` +
          (conc.share >= 0.6 ? ' O resultado depende de poucos hits — vale ter uma linha de conteúdos recorrentes mais consistente.' : '')
      });
    }

    /* 10. Melhor engajamento proporcional */
    if (posts.length >= 4) {
      const eligible = posts.filter(p => p.reach >= (s.medianReach || 0) * 0.3 && p.er != null);
      const bestEr = eligible.sort((a, b) => b.er - a.er)[0];
      if (bestEr && bestEr.id !== (top && top.id) && s.er && bestEr.er > s.er * 1.3) {
        out.push({
          tone: 'destaque', title: 'Maior engajamento proporcional',
          text: `“${excerpt(bestEr)}” (${bestEr.format.single.toLowerCase()}, ${fmt.dateShort(bestEr.ts)}) engajou **${fmt.pct(bestEr.er)}** do alcance — ${fmt.times(bestEr.er / s.er)} a média. Temas assim mobilizam a base mesmo com alcance menor.`
        });
      }
    }

    /* 11. Hashtags */
    const withTags = posts.filter(p => p.hashtags.length), noTags = posts.filter(p => !p.hashtags.length);
    if (withTags.length >= 3 && noTags.length >= 3) {
      const a = M.median(withTags.map(p => p.views)), b = M.median(noTags.map(p => p.views));
      const d = pctDiff(a, b);
      if (d != null && Math.abs(d) >= 0.15) {
        out.push({
          tone: 'contexto', title: 'Hashtags',
          text: `Posts com hashtags tiveram mediana de ${fmt.compact(a)} visualizações vs ${fmt.compact(b)} sem hashtags (${signedPct(d)}). Correlação, não causa: o tema do post costuma pesar mais.`
        });
      }
    }

    /* 12. Duração de vídeos */
    const dur = M.durationStats(posts).filter(d => d.n >= 2);
    if (dur.length >= 2) {
      const best = dur.slice().sort((a, b) => b.medianViews - a.medianViews)[0];
      out.push({
        tone: 'oportunidade', title: 'Duração dos vídeos',
        text: `Vídeos de **${best.label}** tiveram a maior mediana de visualizações (${fmt.compact(best.medianViews)}, ${best.n} vídeos).`
      });
    }

    /* 13. Frequência */
    const weeks = M.weekly(posts, ctx.range && ctx.range.start, ctx.range && ctx.range.end);
    if (weeks.length >= 3) {
      const emptyWeeks = weeks.filter(w => !w.n);
      const empty = emptyWeeks.length;
      const perWeek = posts.length / weeks.length;
      if (empty > 0) {
        // Semanas sem post no feed, mas com stories: o perfil não ficou parado
        const storyWeeks = new Set((ctx.stories || []).map(p => p.weekKey));
        const coveredByStories = emptyWeeks.filter(w => storyWeeks.has(w.week)).length;
        const mostlyCovered = coveredByStories >= empty / 2;
        let text = `Média de ${fmt.dec(perWeek)} ${perWeek === 1 ? 'post' : 'posts'} no feed por semana; **${empty} de ${weeks.length} semanas** ficaram sem post no feed.`;
        if (coveredByStories) {
          text += ` Em ${coveredByStories} delas o perfil se manteve ativo por stories` +
            (mostlyCovered ? ', mas o feed é o que alcança quem ainda não segue a conta: vale manter uma cadência mínima de posts.' : '.');
        } else {
          text += ' Lacunas reduzem a distribuição contínua do perfil.';
        }
        out.push({ tone: mostlyCovered ? 'contexto' : 'atencao', title: 'Consistência no feed', text });
      }
    }

    /* 14. Colaborações de terceiros (fora dos totais) */
    const collabs = ctx.collabs || [];
    if (collabs.length && s.avgViews) {
      const cs = ctx.collabSummary;
      const ratio = cs.avgViews / s.avgViews;
      const byPartner = new Map();
      collabs.forEach(p => byPartner.set(p.username, (byPartner.get(p.username) || 0) + p.views));
      const [bestUser, bestViews] = Array.from(byPartner.entries()).sort((a, b) => b[1] - a[1])[0];
      let text = `**${fmt.int(cs.n)} colaboraç${cs.n === 1 ? 'ão' : 'ões'}** a convite de ${byPartner.size} conta(s), fora dos totais. ` +
        `Em média tiveram **${fmt.compact(cs.avgViews)} visualizações**, ` +
        (Math.abs(ratio - 1) < 0.1 ? 'em linha com os posts próprios.' : `${fmt.pct(Math.abs(ratio - 1), 0)} ${ratio > 1 ? 'acima' : 'abaixo'} dos posts próprios.`) +
        ` Parceria de maior alcance: **@${bestUser}** (${fmt.compact(bestViews)} visualizações).`;
      let tone = 'contexto';
      if (ratio >= 1.2) { tone = 'oportunidade'; text += ' Parcerias se mostram um bom canal de alcance para o perfil.'; }
      out.push({ tone, title: 'Colaborações', text });
    }

    out.push(...storyInsights(ctx));

    /* 15. Qualidade / amostra */
    const flagged = posts.filter(p => p.dataComment).length;
    if (hasFeed && (posts.length < 5 || flagged)) {
      out.push({
        tone: 'atencao', title: 'Leia com cautela',
        text: (posts.length < 5 ? `Amostra pequena (${posts.length} ${posts.length === 1 ? 'post' : 'posts'} no feed): comparações são apenas indicativas. ` : '') +
          (flagged ? `${flagged} post(s) vieram com observação do Meta sobre os dados.` : '')
      });
    }

    return out;
  }

  /* ---------- Stories (separados do feed) ---------- */
  function storyInsights(ctx) {
    const out = [];
    const stories = ctx.stories || [], s = ctx.storySummary;
    if (!stories.length) return out;
    // Muitos stories não têm texto: identifica por data/hora quando não há legenda
    const ref = x => (String(x.description || '').trim()
      ? `story de ${fmt.dateShort(x.ts)} — “${excerpt(x)}” —`
      : `story de ${fmt.dateShort(x.ts)} às ${fmt.time(x.ts)} (sem texto)`);

    /* S1. Panorama */
    {
      let text = `**${fmt.int(s.n)} ${s.n === 1 ? 'story' : 'stories'}** em ${fmt.int(s.activeDays)} ${s.activeDays === 1 ? 'dia' : 'dias'} (${fmt.dec(s.perActiveDay)} por dia ativo), com alcance médio de **${fmt.compact(s.avgReach)} contas** por story` +
        (ctx.summary && ctx.summary.n && ctx.summary.avgReach ? ` (posts do feed: ${fmt.compact(ctx.summary.avgReach)})` : '') +
        `. Geraram ${fmt.int(s.replies)} respostas, ${fmt.int(s.stickerTaps)} toques em figurinhas e ${fmt.int(s.profileVisits)} visitas ao perfil.`;
      const prev = ctx.prevStorySummary;
      if (prev && prev.avgReach) {
        const d = pctDiff(s.avgReach, prev.avgReach);
        text += ` O alcance médio por story ${d >= 0 ? 'subiu' : 'caiu'} **${fmt.pct(Math.abs(d), 0)}** frente ao período anterior.`;
      }
      out.push({ tone: 'contexto', title: 'Stories no período', text });
    }

    /* S2. Volume no dia x alcance por story */
    const buckets = M.storyDayStats(stories).filter(b => b.days >= 3);
    if (buckets.length >= 2) {
      const light = buckets[0], heavy = buckets[buckets.length - 1];
      const d = pctDiff(heavy.avgReach, light.avgReach);
      if (d != null && d <= -0.2) {
        out.push({
          tone: 'atencao', title: 'Stories: volume x alcance',
          text: `Em dias com ${heavy.short}, cada story alcançou em média **${fmt.compact(heavy.avgReach)} contas**, ${fmt.pct(-d, 0)} menos que em dias com ${light.short} (${fmt.compact(light.avgReach)}). ` +
            'Sequências longas tendem a perder público: vale concentrar a mensagem principal nos primeiros stories do dia.'
        });
      } else if (d != null && d >= -0.1) {
        out.push({
          tone: 'contexto', title: 'Stories: volume x alcance',
          text: `O alcance por story se mantém mesmo nos dias com mais publicações (${heavy.short}: ${fmt.compact(heavy.avgReach)} contas; ${light.short}: ${fmt.compact(light.avgReach)}).`
        });
      }
    }

    /* S3. Story de maior alcance */
    const top = stories.slice().sort((a, b) => b.reach - a.reach)[0];
    if (top && top.reach > 0) {
      out.push({
        tone: 'destaque', title: 'Story de maior alcance',
        text: `O ${ref(top)} alcançou **${fmt.compact(top.reach)} contas**` +
          (s.n >= 3 && s.medianReach ? `, ${fmt.times(top.reach / s.medianReach)} o alcance mediano` : '') +
          (top.replies ? `, com ${fmt.int(top.replies)} respostas.` : '.')
      });
    }

    /* S4. Figurinhas */
    const st = stories.slice().sort((a, b) => b.stickerTaps - a.stickerTaps)[0];
    if (s.n >= 5 && st && st.stickerTaps > 0 && s.stickerTaps > 0) {
      out.push({
        tone: 'oportunidade', title: 'Figurinhas que engajam',
        text: `O ${ref(st)} concentrou **${fmt.int(st.stickerTaps)} toques em figurinhas**, ${fmt.pct(st.stickerTaps / s.stickerTaps, 0)} do total do período. Vale entender qual figurinha foi usada (enquete, link, pergunta, menção) e repetir o recurso.`
      });
    }
    return out;
  }

  IGR.insights = { generate, excerpt };
})(window);
