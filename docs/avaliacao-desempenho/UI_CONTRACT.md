# Contrato de interface — Desempenho e Cultura

A tela administrativa reutiliza o visual já usado em Competências (`src/components/competencies/competencyUi.tsx`): `BTN_PRIMARY`, `BTN_SECONDARY`, `PANEL`, `PanelState`. Tokens Tailwind do IndusCost: `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`.

## Onde a pessoa entra

- Menu: Gestão de pessoas → Desempenho e Cultura (`performance-cycle`, caminho `/performance-cycle`). Some quando `PERFORMANCE_CYCLE_ENABLED` não é `1`.
- Ficha do colaborador: aba Avaliações, seção de histórico do ciclo, acima da avaliação de experiência. A avaliação de experiência não muda.
- Portal: `/avaliacao`, fora do login administrativo. O código do QR vai no fragmento `#t=`, que a página apaga antes de pedir a sessão.

## Administrativo

- Trilha: `Gestão de pessoas › Desempenho e Cultura`.
- Título e um parágrafo que deixa claro: três resultados separados, cultura fora da Nine-Box, perguntas e cortes em validação.
- Abas: Ciclos, Modelos, Minha equipe, Painel.
- Lista de modelos: nome, versão, situação, quantidade de perguntas, ação Publicar só em rascunho.
- Lista de ciclos: nome, referência, situação, Preparar e Abrir. Abrir pode falhar com a mensagem de governança se a publicação oficial estiver desligada.
- Estados: carregando (`PanelState`), módulo desligado, lista vazia, erro em faixa vermelha.
- Formulário do líder: uma pergunta por bloco, escala em rádio, exemplo obrigatório nas notas 1 e 4, autoavaliação oculta até o envio do líder.

## Portal

- Uma pergunta por tela, indicador `Pergunta N de 12`, nome do pilar, quatro respostas e “Não sei”.
- Alvo de toque mínimo nas opções: classe `min-h-11` (44 px).
- Introdução pede o código separado do QR. Não promete anonimato.
- Revisão lista as 12 respostas antes do envio.
- Mensagem neutra quando o convite não abre: “Não foi possível abrir esta pesquisa.”

## O que a interface ainda não cobre

Seleção de participantes, impressão de QR, modo assistido, fila de calibração, devolutiva, PDI, PDF e filtros do painel por setor/cargo. Essas ações existem na API e não têm tela.

## Verificação visual

Não houve passagem no navegador nesta execução. Não há captura de tela.

## Estado em 16/10/2026 (Claude Code)

As seções acima descrevem a entrega anterior e ficam como registro. O estado atual:

- Abas: Ciclos, Minha equipe, Calibração, Nine-Box, Devolutivas e PDI, Painel, Modelos. A aba some quando falta permissão; o backend recusa do mesmo jeito.
- Modelos: editor das 12 perguntas (texto, competência, descrição, exemplo positivo e negativo, exemplos por cargo), regras do modelo, pré-visualização, publicação com confirmação, histórico de versões. Versão publicada fica somente leitura.
- Ciclos: busca de pessoas com seleção em lote, prévia de elegibilidade, exceção com motivo, líder escolhido por busca visual (nunca por id), remoção com motivo, convites em lote, ficha impressa sem o código, preenchimento assistido.
- Calibração: fila com perspectivas da pessoa e do líder, divergências, evidências, pedido de revisão ao líder, confirmação ou ajuste com motivo; o original fica preservado.
- Portal: bundle próprio (`avaliacao.html`), uma pergunta por tela, nada pré-selecionado, fila offline com aviso, retomada na primeira sem resposta, revisão antes do envio. Testado em 320, 360 e 390 px sem rolagem lateral.
- Impressos: `/performance-cycle/relatorio` no `PrintDocumentShell` + `PrintHeader`, código `DCP-…`, versão, "Página X de Y"; `/performance-cycle/convites` com QR.
- Responsividade administrativa verificada em 375, 768, 1280 e 1920 px.

Verificação visual: capturas em `evidencias/`, roteiro em `EVIDENCIAS_TESTES.md`.
