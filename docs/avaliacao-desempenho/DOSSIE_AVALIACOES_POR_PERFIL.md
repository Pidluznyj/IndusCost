# Dossiê — quem avalia quem, por perfil, e se o ciclo fecha

Análise de 20/10/2026 sobre o código da `main` (`c397e62`). O objetivo é deixar claro, para cada perfil, quais avaliações a pessoa **responde** e quais **recebe**, conferir se o sistema cria exatamente essas avaliações e se a calibração enxerga todos os ângulos de cada pessoa. Onde diz "hoje", a afirmação foi conferida no código. "Proposta" é recomendação, ainda não implementada nem aprovada pelo RH.

## 1. A regra, em uma frase

Toda pessoa avalia a si mesma. Quem tem líder avalia o líder e é avaliado por ele. Quem tem liderados avalia cada um e, se o liderado também lidera, avalia também a liderança dele.

| Situação | O que a pessoa faz | Regra pedida pela direção |
| --- | --- | --- |
| Sou diretor (tenho chefe e liderados) | me autoavalio, avalio meu chefe, avalio meus liderados | ✓ |
| Não sou líder | me autoavalio, avalio meu líder | ✓ |
| Não tenho líder (topo) | me autoavalio, avalio meus liderados | ✓ |

"Líder" segue a mesma definição do sistema: tem pelo menos um liderado direto ativo na hierarquia efetiva, conforme o organograma na abertura do ciclo ([hierarquia-efetiva.md](../hr/hierarquia-efetiva.md)).

## 2. Perfis

| Perfil | Tem líder? | Tem liderados? | Os liderados lideram? | Exemplo |
| --- | --- | --- | --- | --- |
| **P1 Operacional** | sim | não | — | operador, técnico, analista |
| **P2 Líder de equipe** | sim | sim | não | líder de turno, supervisor |
| **P3 Líder de líderes** | sim | sim | ao menos um | gerente, diretor |
| **P4 Topo** | não | sim | normalmente sim | presidente, diretor-geral |
| **P5 Sem líder e sem liderados** | não | não | — | erro de cadastro: corrigir no organograma |
| **P6 Não elegível** | — | — | — | admitido há menos de 90 dias, afastado, desligado |

## 3. Matriz de avaliações por perfil

### 3.1 O que cada perfil RESPONDE

| Avaliação | Tarefa no sistema | P1 | P2 | P3 | P4 |
| --- | --- | :-: | :-: | :-: | :-: |
| Autoavaliação individual (12 perguntas) | `SELF` | ✓ | ✓ | ✓ | ✓ |
| Avaliação do meu líder (ascendente, 8 competências LD) | `LEADERSHIP_UPWARD` | ✓ | ✓ | ✓ | — |
| Autoavaliação de liderança | `LEADERSHIP_SELF` | — | ✓ | ✓ | ✓ |
| Avaliação individual de cada liderado | `LEADER` (como avaliador) | — | ✓ cada um | ✓ cada um | ✓ cada um |
| Avaliação de liderança de cada liderado que lidera | `LEADERSHIP_SUPERIOR` (como avaliador) | — | — | ✓ cada líder abaixo | ✓ cada líder abaixo |

Volume para um diretor (P3) com 4 liderados, dos quais 2 lideram: 1 autoavaliação, 1 avaliação do chefe, 1 autoavaliação de liderança, 4 avaliações individuais e 2 avaliações de liderança, 9 no total. As três primeiras saem pelo celular, numa jornada só. As seis últimas ficam na aba "Minha equipe".

### 3.2 O que cada perfil RECEBE (os ângulos sobre a pessoa)

| Ângulo sobre a pessoa | P1 | P2 | P3 | P4 |
| --- | :-: | :-: | :-: | :-: |
| Própria autoavaliação individual | ✓ | ✓ | ✓ | ✓ |
| Avaliação individual pelo líder | ✓ | ✓ | ✓ | **✗ não existe quem avalie** |
| Própria autoavaliação de liderança | — | ✓ | ✓ | ✓ |
| Avaliação de liderança pelo superior | — | ✓ | ✓ | **✗ não existe quem avalie** |
| Avaliação da equipe (ascendente, só a média, com 5 ou mais) | — | ✓ | ✓ | ✓ |
| Calibração individual (Nine-Box) | ✓ | ✓ | ✓ | ✓ com exceção registrada |
| Calibração de liderança | — | ✓ | ✓ | ✓ com exceção registrada |

### 3.3 Exemplo concreto (cadeia Carla → Bruno → Ana)

| Pessoa | Perfil | Responde | Recebe |
| --- | --- | --- | --- |
| Carla (diretora, topo) | P4 | autoavaliação; autoavaliação de liderança; avaliação individual de Bruno e de Marcos; avaliação de liderança de Bruno e de Marcos | ascendente de Bruno e Marcos (média só com 5 ou mais respostas; com 2, "amostra insuficiente"); **ninguém a avalia individualmente** |
| Bruno (gerente) | P3/P2 | autoavaliação; avaliação de Carla (ascendente); autoavaliação de liderança; avaliação individual de cada liderado | avaliação individual e de liderança feitas por Carla; ascendente dos 6 liderados (média divulgada) |
| Ana (operadora) | P1 | autoavaliação; avaliação de Bruno (ascendente) | avaliação individual feita por Bruno |

## 4. O sistema cria exatamente isso? (conferido no código)

| Regra | Como está hoje | Situação |
| --- | --- | --- |
| Todo elegível se autoavalia | `SELF` para todo elegível | ✓ |
| Quem tem líder é avaliado por ele | `LEADER` sempre que há líder, **mesmo que o líder esteja fora do ciclo** | ✓ |
| Quem lidera avalia cada liderado | consequência da linha acima | ✓ |
| Não líder avalia o próprio líder | `LEADERSHIP_UPWARD` **só em ciclo com modelo de liderança (180°)** e **só se o líder também estiver no ciclo e for elegível** | ⚠ **lacunas L1 e L2** |
| Líder se autoavalia como líder | `LEADERSHIP_SELF` em ciclo com 180° | ⚠ depende de L1 |
| Superior avalia a liderança de cada líder abaixo | `LEADERSHIP_SUPERIOR` sempre que o líder tem superior | ✓ em ciclo com 180° |
| Topo é avaliado por alguém | não há avaliador; a calibração exige exceção | ⚠ **lacuna L4** |
| Líder avalia de qualquer lugar | líder responde na aba "Minha equipe", que exige usuário no sistema vinculado ao cadastro | ⚠ **lacuna L3** |
| Avaliar só quem conhece há tempo suficiente | os 90 dias contam da admissão, não do tempo com o líder atual | ⚠ **lacuna L11** |

## 5. O ciclo completo fecha? (boas práticas × sistema)

| Etapa | Boa prática | No sistema | Situação |
| --- | --- | --- | --- |
| 1. Estrutura | Organograma correto antes de abrir: cada pessoa com um líder, sem ciclo nem ambiguidade | hierarquia efetiva + `audit:org-hierarchy`; a abertura recusa elegível sem líder | ✓ |
| 2. Critérios | Modelo e escala publicados e congelados por ciclo; competências observáveis | modelos versionados (individual 12 + liderança 8); escala 1–4 com "não observei" | ✓ (textos em validação com o RH) |
| 3. Quem participa | Todos os elegíveis **e os líderes deles**; regra de tempo mínimo | elegibilidade por admissão, afastamento e desligamento; o RH escolhe as pessoas e **pode deixar líder de fora** | ⚠ L2 |
| 4. Comunicação e preparo dos avaliadores | Orientar sobre vieses antes da coleta | textos de apoio e comentário obrigatório em nota extrema; treinamento é processo do RH | parcial (fora do sistema) |
| 5. Coleta | Auto, líder, ascendente e superior no mesmo período; confidencialidade da equipe | portal no celular em etapas; ascendente só em média, com 5 ou mais respostas; comentário da equipe nunca lido | ✓ |
| 6. Acompanhamento | Pendências por responsável e prazo | central de acompanhamento | ✓ |
| 7. Consolidação | Encerrar a coleta e calcular | consolidação e resultado preliminar | ✓ |
| 8. **Calibração** | Por área, de cima para baixo, em comitê (líder de líderes + pares + RH mediando), com todos os ângulos de cada pessoa e indicadores de viés do avaliador | individual: **só o RH**, vendo auto × líder; liderança: superior direto ou RH, vendo auto × superior × equipe | ⚠ **L5, L6, L7** |
| 9. Homologação | Resultado oficial só depois de calibrar todos | homologação exige tudo calibrado (individual e liderança) e congela | ✓ |
| 10. Devolutiva | Conversa 1:1 registrada, ciência do colaborador, contestação | devolutiva com ciência, contestação e documento | ✓ |
| 11. PDI | Ações ligadas a competências, com prazo e acompanhamento | PDI com competência (inclusive de liderança), check-ins e acompanhamento | ✓ |
| 12. Evolução | Comparar ciclos oficiais | evolução só com ciclos oficiais | ✓ |
| 13. Governança | Trilha de auditoria; acesso mínimo; LGPD | auditoria completa; perfis RH Operacional e RH Gestor; pareceres de LGPD pendentes | parcial |

**Conclusão:** a coleta, o acompanhamento, a homologação, a devolutiva e o PDI fecham. O ciclo **não fecha por completo** em três pontos:
1. **Avaliação ascendente:** pode não existir (L1, L2).
2. **Topo da estrutura:** não tem avaliador (L4).
3. **Calibração:** acontece em telas separadas e só com o RH ou o superior direto, sem uma visão única da pessoa e sem indicador de viés do avaliador (L5–L7).

## 6. A calibração enxerga todos os ângulos?

### 6.1 Hoje

| Quem calibra | O quê | Ângulos que vê | O que fica de fora |
| --- | --- | --- | --- |
| RH (permissão de calibrar) | Resultado individual (Nine-Box) | autoavaliação × avaliação do líder por pilar, divergências, evidências do líder, versões | para quem lidera: autoavaliação de liderança, avaliação do superior, média da equipe; histórico de ciclos anteriores; PDI anterior |
| Superior direto (ou RH) | Liderança | autoavaliação de liderança × superior × média da equipe, por competência, com justificativa obrigatória | o resultado individual da pessoa; a visão da área inteira |
| Líder de líderes | — | não calibra a área | toda a cadeia abaixo dos liderados diretos |

Os ângulos existem, mas estão **espalhados em duas telas e com donos diferentes**. Ninguém vê, de uma vez, tudo o que existe sobre uma pessoa.

### 6.2 Vieses que a calibração deveria ajudar a corrigir

| Viés | O que mostra | Hoje |
| --- | --- | --- |
| Leniência ou severidade do avaliador | média e distribuição das notas que cada líder deu, frente à média da área | ✗ |
| Tendência central | líder que deu quase tudo "3" | ✗ |
| Efeito halo | notas iguais em todas as competências | ✗ |
| Autoavaliação × líder | divergência por pergunta | ✓ (por pessoa) |
| Superior × equipe (liderança) | competência em que a equipe diverge do superior pede justificativa | ✓ (por pessoa) |
| Recência | comparar com o ciclo anterior e com os check-ins do PDI | ✗ na calibração (existe no histórico) |
| Amostra pequena | média da equipe só com 5 ou mais respostas | ✓ |

## 7. O dossiê da pessoa (como deveria ser)

Uma única ficha por pessoa, para o calibrador e o comitê, com tudo o que existe sobre ela no ciclo e nada além do que a permissão de quem vê autoriza.

| Bloco | P1 | P2/P3 | P4 | Fonte no sistema |
| --- | :-: | :-: | :-: | --- |
| Identificação: cargo, setor, diretoria, líder, tempo de casa, tempo com o líder | ✓ | ✓ | ✓ | participante |
| Autoavaliação individual por pilar | ✓ | ✓ | ✓ | `SELF` |
| Avaliação do líder por pilar, com evidências | ✓ | ✓ | exceção | `LEADER` |
| Divergências auto × líder | ✓ | ✓ | — | já calculado |
| Autoavaliação de liderança | — | ✓ | ✓ | `LEADERSHIP_SELF` |
| Avaliação de liderança pelo superior | — | ✓ | exceção | `LEADERSHIP_SUPERIOR` |
| Média da equipe por competência (5 ou mais), sem comentários | — | ✓ | ✓ | `LEADERSHIP_UPWARD` agregado |
| Como esta pessoa avalia os outros (média e distribuição das notas que deu) | — | ✓ | ✓ | `LEADER` dela como avaliadora |
| Posição preliminar na Nine-Box e faixa de cultura | ✓ | ✓ | ✓ | resultado |
| Ciclos anteriores (oficiais) | ✓ | ✓ | ✓ | histórico |
| PDI anterior e check-ins | ✓ | ✓ | ✓ | PDI |
| Situação da calibração e quem calibrou | ✓ | ✓ | ✓ | versões |

Hoje existem todas as fontes e quase todos os cálculos. Falta a **ficha única** e o bloco **"como esta pessoa avalia os outros"**.

## 8. Lacunas, em ordem de prioridade

| # | Lacuna | Risco | Proposta |
| --- | --- | --- | --- |
| **L1** | Sem modelo de liderança no ciclo, ninguém avalia o próprio líder e o líder não se autoavalia como líder | A regra da direção não se cumpre | Ciclo **oficial** passa a exigir o modelo de liderança; ciclo de teste continua opcional |
| **L2** | Se o RH deixa o líder fora do ciclo (ou ele não é elegível), a equipe não o avalia e ele não é avaliado como líder | Líder escapa da avaliação; equipe perde a voz | Na preparação: aviso bloqueante "há liderados cujo líder não está no ciclo", com opção de incluir o líder ou justificar |
| **L3** | Avaliar liderados exige usuário no sistema vinculado ao cadastro; líder sem usuário fica pendente para sempre | Avaliação do líder nunca chega | Preparação mostra "avaliadores sem usuário"; alternativa: o líder responde também pelo celular (convite próprio) |
| **L4** | Topo não tem avaliador individual nem de liderança | Resultado do topo sem visão externa | Definir no ciclo um "avaliador do topo" (sócio, conselho ou comitê) ou registrar formalmente que o topo é só calibrado pelo comitê |
| **L5** | Ângulos espalhados em duas telas | Calibração parcial | **Dossiê da pessoa** (seção 7) dentro da Calibração |
| **L6** | Calibração individual só pelo RH; líder de líderes não calibra a área | Perde-se o conhecimento de quem está acima; RH decide sozinho | Sessões de calibração por área, de cima para baixo: líder de líderes + RH, com registro de quem participou |
| **L7** | Sem indicadores de viés do avaliador | Leniência e severidade passam despercebidas | Painel "por avaliador" na calibração: média, distribuição, % de notas extremas, desvio frente à área |
| **L8** | Liderança não entra na Nine-Box do líder (decisão registrada) | — | Manter separado, mas mostrar lado a lado no dossiê; o RH decide se a liderança informa o eixo de potencial |
| **L9** | Sem pares nem clientes (é 180°, não 360°) | — | Decisão consciente; registrar como evolução futura |
| **L10** | Colaborador e líder não veem o próprio resultado no sistema (só pelo documento da devolutiva) | Transparência | Decisão do RH (já listada nas pendências) |
| **L11** | 90 dias contam da admissão, não do tempo com o líder; líder recém-chegado avalia e é avaliado | Avaliação de quem mal se conhece | Regra de tempo mínimo com o líder (ex.: 90 dias); abaixo disso, o líder anterior avalia ou registra-se exceção |

## 9. Decisões para o RH

1. Ciclo oficial exige 180° (L1)?
2. Líder de quem participa entra obrigatoriamente no ciclo (L2)?
3. Quem avalia o topo (L4)?
4. Calibração em comitê por área, com o líder de líderes (L6)?
5. Tempo mínimo com o líder para avaliar e ser avaliado, e de quanto (L11)?
6. A liderança informa o eixo de potencial da Nine-Box do líder (L8)?

Implementação sugerida, nesta ordem:
1. Travas na preparação (L1, L2, L3, L11), que são baratas e evitam ciclo incompleto.
2. Dossiê da pessoa (L5).
3. Painel por avaliador (L7).
4. Comitê por área (L6).
5. Avaliador do topo (L4).

## 10. O que foi implementado (20/10/2026, branch local)

| Lacuna | Entrega | Onde |
| --- | --- | --- |
| L1 | Ciclo oficial exige o modelo de liderança; a criação já vem com ele escolhido; prontidão bloqueia sem ele (ciclo de teste só avisa) | `performanceReadiness.ts`, aba Ciclos |
| L2 | Prontidão aponta cada líder fora do ciclo e quem ele lidera; botão "Incluir os líderes" sobe a cadeia até o topo; com 180° abrir pela API é recusado — sem 180° é só aviso (`409 READINESS_BLOCKED`) | `GET /cycles/:id/readiness`, `POST /cycles/:id/participants/include-leaders` |
| L3 | Avaliador sem usuário vinculado bloqueia a abertura, com a lista de quem precisa de acesso | prontidão |
| L4 | Aviso do topo sem avaliador, com "Definir avaliador" (troca com motivo) ou seguir com exceção | prontidão |
| L11 | Aviso de pessoa com o líder atual há menos que a observação mínima (histórico do cadastro), com "Trocar líder" | prontidão |
| L5 | Dossiê da pessoa na Calibração: pessoa × líder, posição e versões, liderança (equipe × auto × superior × calibrada), como ela avalia os outros, ciclos anteriores homologados, PDI | `GET /participants/:id/dossier`, botão "Dossiê" |
| L7 | Painel "Como cada líder avalia": média frente ao ciclo, distribuição, extremas, sinais de leniência, severidade, tendência central e halo (só com 3 ou mais avaliações enviadas) | `GET /cycles/:id/calibration/evaluators` |
| L6 | Campo "Quem participou desta calibração (comitê)" na calibração individual, gravado na nota e na auditoria | diálogo Calibrar |
| Usabilidade | Líder vê numa linha o que falta com ele (individuais, liderança, calibrações, prazo mais próximo) e um atalho para a liderança | aba Minha equipe |

Decisões que continuam com o RH (seção 9): quem avalia o topo em vez de exceção, o valor do tempo mínimo com o líder (hoje usa a observação mínima do ciclo, 90 dias) e se a liderança informa o potencial da Nine-Box (L8). L9 (pares e clientes) e L10 (resultado visível ao colaborador) seguem como evolução.
