# Botão "Exportar PDF"

Um clique no botão **Exportar PDF** faz duas coisas:

1. **Impressão do navegador** (`window.print()`): o usuário escolhe "Salvar como PDF" e guarda o arquivo onde quiser. O relatório não gera esse PDF por conta própria.
2. **Envio ao Hub de Relatórios**: depois que a janela de impressão fecha, uma cópia do relatório em PDF é enviada para a página da cliente no Hub (veja a seção [Envio automático ao Hub de Relatórios](#envio-automático-ao-hub-relatorios)).

## Onde está no código

- **Botão:** `<button id="igr-print">` no cabeçalho do [index.html](index.html), ao lado do campo **"Nome da cliente no Hub"** (`#igr-hub-cliente`).
- **Clique:** na função `init()` de [assets/js/app.js](assets/js/app.js):

  ```js
  printBtn.addEventListener('click', () => {
    global.print();
    // Depois da impressão (que segue igual), envia uma cópia em PDF ao Hub de Relatórios
    if (printBtn.disabled) return;
    printBtn.disabled = true;
    sendToHub().then(() => { printBtn.disabled = false; });
  });
  ```

- **Antes e depois de imprimir:** também em `init()`, os eventos `beforeprint` e `afterprint` trocam para o tema claro, redesenham os gráficos na largura da página (`C.rerenderAll`) e depois voltam ao tema anterior.
- **Layout de impressão:** os blocos `@media print` de [assets/css/dashboard.css](assets/css/dashboard.css) (procure por "Impressão / PDF").

## O que sai no PDF

- **Página:** A4 com margem de 12mm, sempre no tema claro.
- **O que fica de fora:**
  - os botões do cabeçalho e o campo "Nome da cliente no Hub";
  - a lista de arquivos, a navegação e as ações dos cards ("Ver tabela", "Editar");
  - os filtros que não estão ativos;
  - a seção de posts (`#igr-sec-posts`), a de metodologia (`#igr-sec-method`) e as tabelas com rolagem;
  - o card "Seguidores do perfil" enquanto o total não foi informado, e o formulário dele depois de informado (classe `.igr-no-print`).
- **Gráficos:** todos ocupam a largura inteira da página.
- **Evolução** (resumo, feed e stories): em cada gráfico sai a métrica que estava selecionada na tela, sem os botões de métrica e de Dia/Semana. O gráfico fica estático no PDF.
- **Quebra de página:** cards, KPIs e insights não são cortados entre uma página e outra.

## Envio automático ao Hub de Relatórios

Depois que a impressão termina, o botão envia uma cópia do relatório em PDF para a API de Relatórios do Hub de Relatórios. A impressão continua igual. O relatório entra na página da cliente, e ela recebe um aviso por e-mail.

**Por que uma cópia:** `window.print()` não devolve o arquivo ao JavaScript. O PDF salvo pelo usuário fica com o navegador. Por isso o envio gera outro PDF com o **html2pdf.js** (html2canvas + jsPDF). A biblioteca é baixada do cdnjs só no primeiro envio. A cópia segue o mesmo recorte da impressão: A4, margem de 12mm, tema claro e as mesmas seções ocultas. Mesmo assim, não é byte a byte o arquivo que o usuário salvou.

### Caminho do envio

```
navegador (botão)  ──POST multipart──►  servidor/hub-relatorios.js  ──POST multipart + Bearer──►  API do Hub de Relatórios
sem segredo                             segredo em HUB_SEGREDO                          hub.example.com
```

A API exige que o segredo fique **só no servidor**, numa variável de ambiente. Ele nunca vai para o navegador, para o código ou para log. Por isso o navegador envia para o servidor da plataforma, e o servidor acrescenta o cabeçalho `Authorization` e repassa o corpo sem alterar.

**Rodar:**

```powershell
$env:HUB_SEGREDO = '<segredo>'
node servidor/hub-relatorios.js        # abre o relatório em http://127.0.0.1:8080/
```

O servidor também serve o relatório. Assim o botão e a rota ficam na mesma origem e não há CORS. Variáveis opcionais: `PORT`, `HOST` e `HUB_URL`. Se o relatório for aberto via `file://`, o envio não acontece e a interface avisa. Se a plataforma já tiver um backend, a rota `/api/hub-relatorios/relatorios` pode ser implementada nele no lugar deste servidor.

### Onde está

- [assets/js/app.js](assets/js/app.js): seção "Envio do PDF ao Hub de Relatórios" (`buildPdfBlob`, `reportMeta`, `sendToHub`) e o clique do `#igr-print` em `init()`.
- [assets/js/hub-config.js](assets/js/hub-config.js): `url` (rota do servidor), `tipo` e `cliente`. Também pode ser passado em `IGR.app.init(el, { hub: { url, tipo, cliente } })`.
- [servidor/hub-relatorios.js](servidor/hub-relatorios.js): repasse com o segredo, mais o servidor estático.

### Campos enviados

| Campo | Conteúdo | Exemplo |
|---|---|---|
| `arquivo` | O PDF (`application/pdf`) | `relatorio-instagram-clara.nutri.demo-2026-09-30.pdf` |
| `cliente` | Campo "Nome da cliente no Hub" (ao lado do botão) | `Dra. Clara Nogueira` |
| `titulo` | Título, @ e período (até 200 caracteres) | `Desempenho no Instagram — @clara.nutri.demo — 01/07/2026 a 30/09/2026` |
| `data` | Último dia do período do relatório (AAAA-MM-DD) | `2026-09-30` |
| `tipo` | `tipo` da configuração | `conteudo` |
| `id_externo` | `igr-<@>-<data>-<hash>`: muda quando muda o recorte (conta, período, filtros, arquivos, nome da cliente ou total de seguidores) | `igr-clara.nutri.demo-2026-09-30-3f9a1c02` |

- **`cliente`:** o hub só aceita o nome **inteiro**, igual ao nome da conta no hub ou ao nome completo da titular. Ele ignora acentos, caixa, pontuação e "Dr."/"Dra." no começo. O nome do perfil no Instagram costuma trazer complementos ("Dra. Clara Nogueira | Nutrição Descomplicada"). Por isso o campo vem preenchido assim:
  1. `hub.cliente` da configuração, se houver. Nesse caso o campo fica só leitura, para integrações em que a ferramenta já sabe o nome.
  2. O nome digitado antes para aquele @, guardado no navegador em `igr:v1:hub-clientes` (só com `persist: true`).
  3. O nome do perfil cortado no primeiro separador (`|`, `•`, `·`, `/`, ` - `, `(`, `,`, `:`), sem emojis e símbolos.
  4. O @, se não sobrar nada.

  Campo vazio bloqueia o envio. O nome entra no cálculo do `id_externo`: corrigir o nome depois de um envio errado gera um id novo, como a API exige.
- **`id_externo`:** imprimir o mesmo relatório duas vezes não duplica o envio no hub. A API responde `200` com `"repetido": true`, e isso conta como sucesso. Um relatório corrigido sai com outro recorte e, portanto, com outro id.

### Respostas e mensagens na interface

| Resposta | Mensagem |
|---|---|
| `201`, ou `200` com `repetido` | "Relatório enviado com sucesso para o Hub de Relatórios." |
| Erro da API (`400`, `401`, `404`, `409`, `413`, `415`, `500`, `503`) | "Não foi possível enviar o relatório para o Hub de Relatórios." seguido do `motivo` devolvido pela API |
| Falha de rede ou timeout (180 s) | A mesma mensagem, com "Sem resposta do Hub de Relatórios. Tente de novo em alguns minutos." |
| Sem `url` (como na demonstração) | Nenhuma: o campo do Hub não aparece e o botão só imprime. |
| Relatório aberto via `file://` | "Envio ao Hub de Relatórios não configurado: abra o relatório pelo servidor da plataforma." |
| Sem dados carregados | Nenhuma: só a impressão acontece. |

O servidor registra no console o status, o `id` e a `conta` em que o relatório entrou, ou o `motivo` do erro. O segredo nunca é registrado. Não há nova tentativa automática: depois de uma falha de rede, um novo clique reenvia com o mesmo `id_externo`, sem duplicar.

Enquanto o envio está em andamento, o botão fica desabilitado.

**Primeiro teste:** combine com a equipe do Hub uma conta de teste. Todo envio aceito aparece na hora para a cliente e dispara o e-mail.
