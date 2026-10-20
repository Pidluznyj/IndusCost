# A experiência da pesquisa, por quem vive cada parte

Reorganização de 20/10/2026 (branch local sobre a `main`). Nenhuma regra de negócio mudou: só a ordem em que as coisas aparecem, as palavras e o que cada perfil vê primeiro. Princípio: **a pessoa precisa se sentir acolhida e ouvida; quem administra precisa saber sempre qual é o próximo passo.**

## 1. Quem responde (operador, líder no celular)

| Momento | O que a pessoa vê | Por quê |
| --- | --- | --- |
| Entrada | "Olá, Ana. Que bom ter você aqui." e "esta é a sua vez de contar como foi o seu trabalho" | Chama pelo primeiro nome; diz que a vez é dela |
| Regras | "Não existe resposta certa ou errada: o que vale é a sua percepção." | Tira o medo de errar |
| Avaliação do líder | "Aqui a sua voz conta de verdade… ninguém lê os comentários. Pode falar com sinceridade." | Diz a verdade sobre a confidencialidade (média com 5 ou mais; comentário nunca lido) |
| Nota 1 ou 4 | Pede um exemplo observado; o rascunho fica salvo antes do exemplo | A pessoa não perde o que tocou |
| Fim | "Obrigado, Ana. Sua voz foi registrada." + "O que acontece agora": líder avalia, RH confere, os dois conversam | Fecha o ciclo da expectativa: ela sabe o que vem depois |

## 2. Quem lidera (aba "Minha equipe")

- **Uma linha no topo: "Falta com você: …"** e o botão **"Fazer a próxima"**, que abre a primeira pendência na ordem (individual atrasada primeiro, depois liderança, depois calibração).
- **Um cartão por liderado.** A avaliação do trabalho e, no mesmo cartão, "Como Bruno lidera a equipe dele · lidera 8", com explicação de uma linha sobre a diferença.
- Botões em ação: "Avaliar o trabalho", "Continuar a avaliação", "Avaliar a liderança", "Calibrar a liderança".

## 3. Quem administra (RH)

### Abas por intenção
**Operar** (Acompanhamento, Ciclos) · **Avaliar e calibrar** (Minha equipe, Calibração) · **Resultados** (Nine-Box, Devolutivas e PDI, Painel) · **Configurar** (Modelos). Todas visíveis; o grupo diz para que serve.

### Guia do primeiro ciclo (aba Ciclos)
Sete passos com estado e atalho: publicar o modelo, publicar o modelo de liderança, criar o ciclo, incluir as pessoas, conferir a prontidão, preparar e abrir, gerar e entregar os convites. Mostra "próximo: …" e some sozinho quando o ciclo abre com convites (ou quando o RH esconde).

### Mesa por etapa
- Em rascunho e preparado: pessoas e prontidão são o foco; os números do ciclo ficam escondidos; uma dica diz "Agora: …".
- Aberto: dica aponta para gerar e entregar convites e para o Acompanhamento.
- Ações secundárias (ciclo de vida, editar, atualizar líderes, voltar etapa) ficam no menu **"Mais"**; só a ação principal fica à vista.
- Botões em ação: "Preparar ciclo", "Abrir ciclo", "Fechar a coleta", "Iniciar a calibração", "Tornar os resultados oficiais", "Encerrar o ciclo".

### Central de acompanhamento
- **"Entreguei"** por pessoa: o RH registra a entrega da folha em mãos; o contador "Convites entregues" passa a existir e o motivo vira "Convite entregue, ainda não acessado". (É registro do RH, não confirmação do aparelho.)
- **Reemitir** avisa: "A folha anterior deixa de valer na hora. Avise a pessoa se ela já recebeu."
- **Exceções deste ciclo**: tudo que o RH decidiu fora da regra (elegibilidade, troca de líder, calibração sem avaliação do líder, liderança sem uma fonte, avanço com pendências), com motivo e data. Sem notas.

### Calibração
- O **dossiê** da pessoa traz a **decisão ao lado**: validar o técnico, confirmar ou ajustar a posição, exceção sem avaliação do líder, quem participou (comitê) e justificativa. Depois de salvar, **"Próxima pessoa →"** percorre a fila (pendentes primeiro) sem voltar à lista. Cada decisão é a mesma da lista, pela mesma API.
- "Tornar os resultados oficiais" no lugar de "Homologar ciclo".

### Glossário
Palavras do processo explicadas em uma linha, no toque (sublinhado pontilhado) e numa lista "Palavras deste processo" na aba Ciclos: calibrar, tornar oficial, fechar a coleta, elegibilidade, avaliação do seu líder, evidência insuficiente, Nine-Box, devolutiva, PDI, topo da estrutura.

## 4. O que não mudou (de propósito)

- Nenhuma regra de elegibilidade, confidencialidade, permissão ou cálculo.
- Todos os identificadores de teste das telas antigas; os roteiros de navegador 1–13 continuam valendo.
- O colaborador continua sem tela própria de resultado: segue como decisão do RH (pendências §9 do dossiê).

## 5. Como foi validado

Roteiro de navegador parte 14 (`part14-experience.mjs`): abas agrupadas; guia e mesa por etapa com menu Mais; calibrar dentro do dossiê e passar para a próxima pessoa; exceção listada; entrega de convite, aviso na reemissão e exceções na Central; cartão único do líder com "Fazer a próxima"; acolhimento no portal. Mais a regressão das partes 1–13.
