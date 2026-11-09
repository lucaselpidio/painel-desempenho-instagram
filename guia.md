# Guia: como exportar o relatório e enviar ao Hub de Relatórios

## O que muda em relação a antes

**Antes:** você abria o `index.html` direto no navegador, clicava em **Exportar PDF** e salvava o PDF no seu computador.

**Agora:** o botão faz as duas coisas.

1. Abre a janela de impressão, como antes, e você salva o PDF no computador se quiser.
2. Logo depois, envia sozinho uma cópia do PDF para a página da cliente no Hub de Relatórios. A cliente vê o relatório na hora e recebe um aviso por e-mail.

Para o envio funcionar, o relatório não pode mais ser aberto com dois cliques no `index.html`. Ele precisa ser aberto por um **programa auxiliar** que fica rodando numa janela preta (o PowerShell) enquanto você trabalha. Esse programa guarda a senha de acesso ao Hub de Relatórios (o "segredo") e faz o envio. O segredo nunca fica no relatório nem no navegador, e é isso que o Hub de Relatórios exige.

Resumo do dia a dia:

```
abrir o PowerShell na pasta  →  ligar o programa auxiliar  →  abrir o relatório no navegador
→  carregar os CSVs  →  Exportar PDF  →  ver a mensagem de sucesso  →  desligar o programa
```

---

## Parte 1 — Preparação (só uma vez)

### Passo 1. Confirme que o Node.js está instalado

O programa auxiliar roda com o **Node.js**. Ele já está instalado no seu computador hoje, mas, se um dia trocar de máquina:

1. Abra o menu Iniciar, digite **PowerShell** e abra.
2. Digite `node -v` e aperte **Enter**.
3. Se aparecer algo como `v24.21.0`, está tudo certo. Pode fechar a janela.
4. Se aparecer um erro, baixe a versão **LTS** em https://nodejs.org, instale com as opções padrão e repita o teste.

### Passo 2. Guarde o segredo do Hub de Relatórios no Windows

O segredo é a chave que a equipe do Hub te passou. Ele vai ficar guardado nas configurações do seu usuário do Windows, numa "variável de ambiente". Assim você não precisa digitar o segredo toda vez, e ele não fica em nenhum arquivo do relatório.

1. Abra o **PowerShell** (menu Iniciar → digite PowerShell).
2. Digite o comando abaixo, trocando `COLE_O_SEGREDO_AQUI` pelo segredo, e mantenha as aspas simples:

   ```powershell
   setx HUB_SEGREDO 'COLE_O_SEGREDO_AQUI'
   ```

3. Aperte **Enter**. Deve aparecer: `ÊXITO: o valor especificado foi salvo.`
4. **Feche essa janela do PowerShell.** O segredo só passa a valer nas janelas abertas depois deste passo.

> **Cuidados com o segredo**
> - Não cole o segredo em e-mail, WhatsApp, documentos ou arquivos do relatório.
> - Se a equipe do Hub te mandar um segredo novo, repita este passo com o valor novo. O antigo para de funcionar na hora.
> - Se achar que o segredo vazou, peça um novo à equipe do Hub.

### Passo 3. Faça um envio de teste com a equipe do Hub

Todo envio aceito aparece **na hora** para a cliente e dispara o e-mail. Por isso, antes de usar com clientes de verdade, peça à equipe do Hub uma **conta de teste** e faça o primeiro envio para ela. Para isso, siga a Parte 2 informando o nome da conta de teste (veja o Passo 7).

---

## Parte 2 — Toda vez que for gerar um relatório

### Passo 4. Abra o PowerShell dentro da pasta do relatório

1. Abra o Explorador de Arquivos e entre na pasta:
   `painel-desempenho-instagram`
   (é a pasta onde estão o `index.html` e este guia).
2. Clique com o **botão direito** num espaço vazio da pasta e escolha **Abrir no Terminal**.
   - Se essa opção não aparecer, clique na **barra de endereço** do Explorador (onde aparece o caminho da pasta), apague o que estiver escrito, digite `powershell` e aperte **Enter**.
3. Vai abrir uma janela com texto. A última linha termina com o nome da pasta, algo como `...\relatorio-instagram>`.

### Passo 5. Ligue o programa auxiliar

Na janela do PowerShell, digite e aperte **Enter**:

```powershell
node servidor/hub-relatorios.js
```

Deve aparecer:

```
Relatório em http://127.0.0.1:8080/
```

- **Deixe essa janela aberta** o tempo todo em que estiver usando o relatório. Pode minimizar, mas não feche. Se fechar, o relatório para de funcionar no navegador.
- Se aparecer `Aviso: HUB_SEGREDO não definido`, o Passo 2 não foi feito ou a janela foi aberta antes dele. Feche, faça o Passo 2 e volte ao Passo 4.

### Passo 6. Abra o relatório no navegador

1. Abra o navegador (Chrome ou Edge) e digite na barra de endereço:

   ```
   http://127.0.0.1:8080/
   ```

2. O relatório abre igual ao de antes, mas agora por esse endereço, e não pelo arquivo `index.html`.

> **Da primeira vez, o relatório vai aparecer vazio.** O navegador guarda os CSVs separados por endereço. Os arquivos carregados quando você abria o `index.html` direto não aparecem aqui. Basta carregar de novo.

### Passo 7. Carregue os CSVs da cliente e confira o nome

1. Clique em **Carregar exports** ou arraste os CSVs para a página, como antes.
2. **Se já houver arquivos de outra cliente carregados**, clique antes em **Limpar tudo** (na barra de arquivos, no topo). Senão os dados das duas clientes se misturam.
3. Ajuste os filtros (período etc.) como de costume.
4. **Confira o campo "Nome da cliente no Hub"**, ao lado do botão **Exportar PDF**. É esse nome que vai para o Hub de Relatórios, e o Hub só aceita o relatório se ele for **exatamente** o nome da cliente cadastrado lá: o nome da conta no hub ou o nome completo da titular. O hub ignora acentos, maiúsculas e títulos como "Dr." e "Dra.", mas não aceita nome pela metade, apelido nem complementos.
   - O campo já vem preenchido com o nome do perfil do Instagram **sem os complementos**. Por exemplo, o perfil "Dra. Clara Nogueira | Nutrição Descomplicada" vira "Dra. Clara Nogueira".
   - Se o nome ainda não for igual ao do Hub, apague e escreva o nome certo. Veja **"Se o nome da cliente não bater"** no fim deste guia.

5. **Informe o total de seguidores** (opcional, mas recomendado). Os arquivos do Meta não trazem quantos seguidores o perfil tem, só quantos ganhou por dia. Na seção **Público**, no card **"Seguidores do perfil"**:
   1. Abra o perfil da cliente no Instagram e veja o número de seguidores.
   2. Digite o número no campo **"Total de seguidores hoje"**, por exemplo `12.345`, e clique em **Salvar**. Se o perfil mostrar o número abreviado, como `12,3 mil`, também pode digitar assim, mas o resultado fica aproximado.
   3. O campo some e o relatório passa a mostrar o **total de seguidores em destaque**, no resumo e na seção Público, com os novos seguidores do período logo abaixo.
   4. Para corrigir o número depois, clique em **Editar**, no canto do card "Seguidores do perfil". O link não aparece no PDF.

   O número fica guardado para aquele @. Atualize sempre que for gerar um relatório novo, porque o total muda com o tempo. Se não informar, o relatório sai como antes: o card com o campo não aparece no PDF.

6. **Escolha a métrica do gráfico "Evolução"** (no fim do Resumo), se for apresentar. Clique nos botões (Visualizações, Novos seguidores etc.) para trocar a linha, e em **Dia** ou **Semana** para mudar o agrupamento. Passe o mouse sobre a linha para ver o valor de cada dia. Para aparecer a linha cinza de comparação, escolha um período no filtro, por exemplo "Últimos 30 dias". **No PDF sai a métrica que estiver selecionada.** A seção do feed e a de stories têm o próprio gráfico de evolução, só com as métricas de cada uma, e cada gráfico guarda a sua escolha.

### Passo 8. Clique em "Exportar PDF"

1. Clique em **Exportar PDF**. A janela de impressão abre, como antes.
2. Se quiser guardar o PDF no seu computador, escolha **Salvar como PDF** e salve, como sempre fez. Se não quiser, clique em **Cancelar**: o envio ao Hub acontece do mesmo jeito.
3. Depois que a janela de impressão fecha, o relatório monta a cópia em PDF e envia ao Hub de Relatórios. Isso leva de alguns segundos a cerca de um minuto. Enquanto isso, o botão **Exportar PDF** fica apagado. **Não feche a aba nem o PowerShell nesse meio-tempo.**

### Passo 9. Confira a mensagem na parte de baixo da tela

- ✅ **"Relatório enviado com sucesso para o Hub de Relatórios."** Pronto: o relatório já está na página da cliente. Na janela do PowerShell também aparece uma linha com `201 ok` e o nome da conta em que o relatório entrou. Vale conferir se é a cliente certa. A mensagem na tela some depois de 3 segundos; se você não viu, a linha no PowerShell confirma o envio.
- ❌ **"Não foi possível enviar o relatório para o Hub de Relatórios."** O motivo vem escrito logo depois. Veja a tabela da próxima seção.

Clicar em **Exportar PDF** de novo no **mesmo** relatório (mesma cliente, período e filtros) não cria uma cópia no Hub: a cliente não recebe dois relatórios nem dois e-mails.

### Passo 10. Desligue o programa auxiliar ao terminar

1. Volte à janela do PowerShell.
2. Aperte **Ctrl + C**. A janela volta a mostrar `...\relatorio-instagram>`.
3. Pode fechar a janela.

Na próxima vez, comece de novo pelo **Passo 4**.

---

## Se algo der errado

| O que aparece | O que significa | O que fazer |
|---|---|---|
| "Envio ao Hub de Relatórios não configurado: abra o relatório pelo servidor da plataforma." | O relatório foi aberto pelo arquivo `index.html`, e não pelo endereço `http://127.0.0.1:8080/` | Faça os Passos 4 a 6. |
| O navegador diz que **não consegue acessar** `127.0.0.1:8080` | O programa auxiliar não está ligado (a janela do PowerShell foi fechada ou deu erro) | Faça os Passos 4 e 5 de novo. |
| "Servidor sem HUB_SEGREDO configurado." | O segredo não foi guardado no Windows | Faça o Passo 2, feche o PowerShell e recomece do Passo 4. |
| Motivo fala em **segredo** ou **Authorization** (erro 401) | O segredo está errado ou foi trocado | Confira o segredo com a equipe do Hub e refaça o Passo 2. |
| "Nenhum cliente ativo do hub se chama ..." (erro 404) | O nome do campo "Nome da cliente no Hub" não bate com nenhum cadastro do hub | Veja **"Se o nome da cliente não bater"** abaixo. |
| Motivo diz que o nome corresponde a **mais de um cliente** (erro 409) | Duas clientes têm o mesmo nome no hub | Peça à equipe do Hub o **id da conta** da cliente e escreva no campo "Nome da cliente no Hub" (abaixo). |
| "Sem resposta do Hub de Relatórios. Tente de novo em alguns minutos." | Internet caiu ou o Hub demorou | Espere alguns minutos e clique em **Exportar PDF** de novo. Não duplica. |
| Motivo diz que a integração está **desligada** (erro 503) | O Hub de Relatórios desligou a integração | Avise a equipe do Hub. |
| Outro motivo | — | Anote o texto exato da mensagem e avise quem cuida da integração. |

O envio precisa de **internet**: tanto para falar com o Hub quanto para montar a cópia em PDF.

### Se o nome da cliente não bater

Quando o Hub responder que não encontrou a cliente, o nome do campo **"Nome da cliente no Hub"** está diferente do cadastro. Isso acontece, por exemplo, quando a cliente usa apelido no Instagram ou quando o Hub tem o nome completo dela.

1. Descubra o nome da cliente **como está no Hub de Relatórios**: o nome da conta ou o nome completo da titular. Na dúvida, pergunte à equipe do Hub.
2. No relatório, clique no campo **"Nome da cliente no Hub"**, apague o que estiver lá e escreva o nome certo, por exemplo `Clara Nogueira`. O nome precisa estar **inteiro**.
   - Se a equipe do Hub te passou o **id da conta**, pode escrever o id no lugar do nome. Ele sempre acerta a cliente, inclusive quando duas clientes têm o mesmo nome.
3. Clique em **Exportar PDF** de novo.

O relatório **guarda o nome que você escreveu para aquele @**. Da próxima vez que carregar os CSVs da mesma cliente, o campo já vem com o nome corrigido. Ao trocar de cliente, o campo muda sozinho para a nova cliente. Você não precisa mexer em nenhum arquivo.

> Se o campo estiver cinza e não deixar editar, o nome foi fixado no arquivo `assets\js\hub-config.js`. Avise quem cuida da integração.

### Mandei um relatório errado

Se o relatório foi para a cliente errada, ou com período ou dados errados, **avise a equipe do Hub**: só ela consegue retirar um relatório do Hub. Depois, corrija e envie de novo.

---

## Cola rápida

```
1. Pasta relatorio-instagram → botão direito → Abrir no Terminal
2. node servidor/hub-relatorios.js            (deixar a janela aberta)
3. Navegador: http://127.0.0.1:8080/
4. Limpar tudo (se houver outra cliente) → Carregar exports
5. Conferir o campo "Nome da cliente no Hub" e informar o total de seguidores (seção Público)
6. Exportar PDF → salvar ou cancelar a impressão → esperar a mensagem de sucesso
7. PowerShell: Ctrl + C para desligar
```
