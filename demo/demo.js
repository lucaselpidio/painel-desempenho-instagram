/* ==========================================================================
   Demonstração (GitHub Pages): carrega os exports fictícios de demo/dados-demo.js
   --------------------------------------------------------------------------
   Só age quando a página é aberta diretamente. Dentro de um iframe (a suíte de
   tests/ abre o index.html assim) o relatório fica intacto, como no projeto real.
   Nada é enviado a servidor: os arquivos são lidos no navegador e não ficam salvos.
   ========================================================================== */
(function () {
  'use strict';
  if (window.frameElement || !window.IGR || !window.IGRDemo) return;

  const REPO = 'https://github.com/lucaselpidio/painel-desempenho-instagram';
  let demo = null;

  function carregarDemo(root) {
    demo = IGRDemo.gerar();
    IGR.app.init(root, { persist: false, owner: demo.dona, hub: { url: '' } }); // hub fictício: na demo o botão só imprime
    IGR.app.clear();
    demo.arquivos.forEach((a) => IGR.app.loadText(a.nome, a.texto));
    IGR.app.setFollowers(demo.seguidores.total, demo.seguidores.data, demo.dona);
    // Abre em "Últimos 30 dias" para os indicadores já virem comparados com o período anterior
    const periodo = [...root.querySelectorAll('#igr-filters select')].find((s) => [...s.options].some((o) => o.value === '30'));
    if (periodo) { periodo.value = '30'; periodo.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  function baixar(arquivo) {
    // O Meta exporta o Público em UTF-16 (com BOM) e os conteúdos em UTF-8 (com BOM): os arquivos baixados seguem o mesmo formato
    let blob;
    if (arquivo.utf16) {
      const buf = new Uint8Array(2 + arquivo.texto.length * 2);
      buf[0] = 0xff; buf[1] = 0xfe;
      for (let i = 0; i < arquivo.texto.length; i++) { const c = arquivo.texto.charCodeAt(i); buf[2 + i * 2] = c & 255; buf[3 + i * 2] = c >> 8; }
      blob = new Blob([buf], { type: 'text/csv' });
    } else blob = new Blob(['﻿' + arquivo.texto], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = arquivo.nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function barra(root) {
    const el = document.createElement('div');
    el.className = 'demo-barra';
    el.innerHTML =
      '<style>' +
      '.demo-barra{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#1f2937;color:#fff;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '.demo-barra .t{margin-right:auto;min-width:0}.demo-barra small{display:block;color:#cbd5e1;font-size:12px;margin-top:2px}' +
      '.demo-barra a{color:#fff}.demo-barra button{font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;border:1px solid #4b5563;background:#374151;color:#fff;cursor:pointer}' +
      '@media print{.demo-barra{display:none}}' +
      '</style>' +
      '<span class="t"><b>Demonstração com dados 100% fictícios</b><small>Perfil, marcas e números são inventados. Seus próprios arquivos também funcionam: são lidos só no seu navegador.</small></span>' +
      '<a href="' + REPO + '">Código no GitHub</a>' +
      '<button type="button" data-acao="baixar">Baixar CSVs de exemplo</button>' +
      '<button type="button" data-acao="meus">Usar meus arquivos</button>' +
      '<button type="button" data-acao="demo" hidden>Voltar à demonstração</button>';
    el.addEventListener('click', (e) => {
      const acao = e.target.closest('button') && e.target.closest('button').dataset.acao;
      if (acao === 'baixar') demo.arquivos.forEach((a, i) => setTimeout(() => baixar(a), i * 250));
      if (acao === 'meus') {
        IGR.app.clear();
        IGR.app.init(root, { owner: '' }); // sem dona fixa: o relatório escolhe a conta com mais posts
        el.querySelector('[data-acao=demo]').hidden = false;
        const input = document.getElementById('igr-file-input');
        if (input) input.click();
      }
      if (acao === 'demo') { carregarDemo(root); e.target.hidden = true; }
    });
    document.body.insertBefore(el, document.body.firstChild);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-igr-root]');
    if (!root) return;
    barra(root);
    carregarDemo(root);
  });
})();
