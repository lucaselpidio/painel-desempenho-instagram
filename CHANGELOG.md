# Histórico de versões

## 1.3.1 — 2026-10-22

Só documentação; o comportamento do relatório não muda.

- **README:** introdução e privacidade atualizadas para o envio ao Hub (servidor opcional, chamadas de rede, segredo só no servidor); estrutura de pastas com `hub-config.js`, `servidor/` e os documentos; dados salvos no navegador (`igr:v1:seguidores`, `igr:v1:hub-clientes`); API com a opção `hub`, `prevPosts`/`prevStories` e as funções dos gráficos de evolução; testes em Node e pelo servidor do projeto; como acrescentar métricas de evolução.
- **EXPORTAR-PDF:** a descrição do botão deixa de copiar código antigo e números de linha; a lista do que fica fora do PDF inclui o campo do Hub, o formulário de seguidores e os botões dos gráficos de evolução.
- **Metodologia** (dentro do relatório): explicações de "Seguidores do perfil" e dos gráficos de "Evolução".

## 1.3.0 — 2026-10-22

- **Evolução do feed**, no fim da seção do feed: visualizações, alcance, interações, curtidas, comentários, compartilhamentos, salvamentos, taxa de engajamento, visitas ao perfil, seguidores via posts e posts publicados. Respeita o filtro de formato.
- **Evolução dos stories**, no fim da seção de stories, na cor dos stories: visualizações, alcance, alcance por story, respostas, curtidas, compartilhamentos, toques em figurinhas, cliques no link, visitas ao perfil, seguidores via stories, navegação e stories publicados.
- O gráfico do Resumo continua igual (feed + stories e seguidores do export de público). Cada um dos três gráficos guarda a própria métrica e o próprio agrupamento.
- Testes: escopos feed e stories na lógica (feed + stories = resumo), 22 casos-limite novos (dados inválidos, dias só com story, período de 1 dia, virada de ano, horário de verão, 5 anos de dados) em 7 fusos e um cenário novo na suíte do navegador.

## 1.2.0 — 2026-10-22

- **Gráfico de Evolução** no fim do Resumo, no estilo do relatório do TikTok: uma linha por dia ou por semana, com área sob a linha, rótulo do último valor, guia e tooltip ao passar o mouse e "Ver tabela".
- Métricas (só aparecem as que têm dado): Visualizações, Alcance somado, Interações, Curtidas, Comentários, Compartilhamentos, Salvamentos, Taxa de engajamento, Visitas ao perfil, Novos seguidores, Seguidores (com o total informado), Seguidores via publicações (sem o export de público) e Publicações.
- Linha cinza de comparação com o período anterior, alinhada pela posição, quando um período está selecionado no filtro.
- Agrupamento por dia ou por blocos de 7 dias contados do fim do período (a semana mais recente fica completa). Períodos longos abrem na visão semanal.
- No PDF e na impressão sai a métrica selecionada, sem os botões.
- Os testes do navegador guardam e devolvem os dados salvos no navegador (arquivos, totais de seguidores e nomes do Hub), que antes eram apagados ao rodar a suíte.
- Novos testes em Node para a lógica e o desenho do gráfico (`tests/*.node.js`), incluindo uma bateria de casos-limite (`teste-evolucao-limites.node.js`) que passa em 7 fusos horários.
- Correções encontradas pela bateria de testes, antes de publicar:
  - total de seguidores digitado errado (ex.: "5" em vez de "5.189") gerava seguidores negativos na linha: a métrica "Seguidores" deixa de ser oferecida até o total ser corrigido;
  - valores negativos (perda líquida de seguidores) saíam do gráfico: o eixo agora desce abaixo do zero;
  - taxa de engajamento perto de 1% repetia rótulos no eixo ("0%, 1%, 1%, 2%"): o eixo ganha casas decimais até os rótulos ficarem diferentes;
  - valores não numéricos (NaN) e séries de comparação mais longas que a atual são tratados sem quebrar o desenho.

## 1.1.1 — 2026-10-09

- **Seguidores do perfil em destaque.** Com o total informado, ele passa a ser o número principal do indicador no resumo e no card da seção Público, com cor de destaque. Os novos seguidores do período aparecem embaixo, em letra menor, como comparação. Sem o export Público, a comparação usa os seguidores atribuídos aos posts e stories.
- **Correção:** depois de salvar o total, o formulário voltava a aparecer no card. Agora ele fica recolhido atrás de um link "Editar", que não sai no PDF, e a página não pula de posição ao salvar.

## 1.1.0 — 2026-10-09

- **Total de seguidores do perfil.** Os exports do Meta não trazem esse número, só os seguidores ganhos por dia. Agora ele é informado no card "Seguidores do perfil" (seção Público), fica guardado por @ e aparece no resumo como complemento do indicador de novos seguidores ("base de 5.189 seguidores (≈ +x% no período)"), sem substituí-lo. Também pode vir da ferramenta por `IGR.app.setFollowers()`.
- O formulário não aparece na impressão nem no PDF enviado ao Hub. Sem o total informado, o relatório sai como na 1.0.
- O `id_externo` enviado ao Hub muda quando o total de seguidores muda, para que o relatório atualizado não seja tratado como repetido.
- "Seguimentos" passa a se chamar "Seguidores" em todo o relatório (resumo, ranking, stories, leituras e glossário). O CSV consolidado mantém o nome da coluna do Meta.

## 1.0.0 — 2026-10-09

Primeira versão.

- Relatório de desempenho no Instagram a partir dos exports CSV do Meta Business Suite (feed, stories e público), processado no navegador.
- Seções: resumo executivo, conteúdo, formatos, temas, calendário, stories, público, colaborações, base completa e metodologia.
- Filtros de período e formato, tema claro/escuro e "Ver tabela" em todos os gráficos.
- **Exportar PDF** pela impressão do navegador, com layout próprio para impressão.
- Envio automático do PDF ao Hub de Relatórios (API de Relatórios) por um servidor local que guarda o segredo (`servidor/hub-relatorios.js`).
- Campo "Nome da cliente no Hub", com sugestão sem complementos do perfil e memória por @.
- Guia passo a passo de uso em [guia.md](guia.md) e detalhes técnicos do PDF em [EXPORTAR-PDF.md](EXPORTAR-PDF.md).
