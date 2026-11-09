/* ==========================================================================
   IGR.hubConfig — envio do PDF ao Hub de Relatórios
   --------------------------------------------------------------------------
   url:     rota do servidor da plataforma que repassa o PDF à API do Hub de Relatórios
            (servidor/hub-relatorios.js). O SEGREDO DA API NÃO ENTRA AQUI: ele fica
            só no servidor, na variável de ambiente HUB_SEGREDO.
   tipo:    "trafego", "conteudo" ou "comercial" (campo "tipo" da API)
   cliente: deixe VAZIO no uso normal: o nome sai do campo "Nome da cliente no Hub",
            na tela, que lembra o nome certo de cada @. Preenchido, fixa o mesmo
            nome para TODOS os envios (só para integrações com uma cliente por página).
   Também pode ser passado em IGR.app.init(el, { hub: { url, tipo, cliente } }).
   ========================================================================== */
(function (global) {
  'use strict';
  const IGR = global.IGR = global.IGR || {};
  IGR.hubConfig = {
    url: '/api/hub-relatorios/relatorios',
    tipo: 'conteudo',
    cliente: ''
  };
})(window);
