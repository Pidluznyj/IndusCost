# Fluxo em etapas do ciclo de Desempenho e Cultura

**Data:** 29/10/2026 · **Branch:** `feat/performance-staged-cycle` · **Migration:** `20261105120000_performance_staged_cycle`

## Problema

Na homologação, um líder não encontrou onde avaliar os liderados. Havia três causas:

1. o ciclo estava **inativo**;
2. os convites tinham sido **revogados**;
3. a avaliação do líder fica na aba **Minha equipe**, que exige o usuário ligado a um cadastro de colaborador.

Nada disso aparecia na tela. Além disso, o ciclo tinha só dois prazos, sem etapas claras para quem responde nem para quem administra.

## O que muda

O ciclo passa a ter **etapas com início e fim**. Os estados técnicos continuam os mesmos:

| # | Etapa | Quem | Estado técnico |
|---|-------|------|----------------|
| 1 | Autoavaliação | Todos | Aberto |
| 2 | Avaliação do líder | Cada chefe avalia os liderados | Aberto |
| 3 | Avaliação da liderança (180°) | Quem tem liderados: equipe, a própria pessoa e o superior | Aberto |
| 4 | Calibração e devolutiva | O líder propõe a posição, agenda a conversa e prepara devolutiva e PDI; o RH confere e torna oficial | Consolidação → Calibração → Homologado |
| 5 | Encerramento | Devolutivas registradas | Encerrado |

**Regras:**

- **Datas:** dias civis de São Paulo (`YYYY-MM-DD`), inclusivos nas duas pontas (`performanceStages.ts`).
- **Coleta:** cada etapa só aceita respostas dentro da sua janela. Isso vale para o portal (QR), para a autoavaliação no sistema e para a avaliação do líder. Fora da janela, a mensagem diz "abre em dd/mm" ou "terminou em dd/mm".
- **Calendário:** é tudo ou nada. A calibração começa depois do fim da coleta. A avaliação do líder não começa antes da autoavaliação. A avaliação da liderança não começa antes da avaliação do líder.
- **Mudança de datas:** depois da abertura do ciclo, exige motivo (≥ 8 caracteres). A auditoria `CYCLE_UPDATED` registra o calendário anterior e o novo.
- **Ciclos sem calendário:** os ciclos já existentes têm os campos novos nulos e mantêm o comportamento anterior: tudo aberto enquanto o ciclo estiver Aberto. Nenhum ciclo em andamento muda.
- **Convite da jornada:** a validade considera o fim da etapa de liderança, ainda limitada pelo teto de 14 dias.

**Telas:**

- **Minha avaliação** (aba nova): a pessoa com usuário ligado ao cadastro responde a própria jornada dentro do sistema, sem QR. É a mesma tela e são as mesmas regras do portal (`/api/hr/performance/me/form|answers|submit`).
- **Aviso "Falta com você"** no topo do módulo (`/me/pending`): mostra a própria etapa pendente, as avaliações de liderados e as propostas de calibração, cada uma com atalho para a aba certa.
- **Minha equipe:**
  - explica quando a tarefa não aparece porque o ciclo está inativo, ou porque falta o vínculo do usuário;
  - avisa quando a avaliação do líder ainda não abriu;
  - ganha o painel **Calibração e devolutiva** por liderado (`PUT /api/hr/performance/plans/:participantId`). Nele o líder:
    - vê a posição preliminar;
    - propõe confirmar ou ajustar (o ajuste pede as duas faixas e uma justificativa ≥ 8);
    - agenda a conversa (data, hora e local);
    - prepara o rascunho da devolutiva e do PDI.
- **Calibração (RH):** a proposta do líder aparece ao lado da decisão, com o botão "Usar a proposta do líder". A decisão oficial continua sendo do RH. O RH Operacional não vê a proposta, que fica redigida como o resto do conteúdo.
- **Devolutiva e PDI:** depois da homologação, os formulários chegam preenchidos com o rascunho do líder e continuam editáveis.
- **Ciclo:** passa a mostrar a linha do tempo das 5 etapas, com datas, a etapa atual e o próximo passo sugerido. As datas de início e fim de cada etapa entram na criação e na edição do ciclo. Duas mudanças de rótulo:
  - "Sem líder" passa a ser "Sem avaliador";
  - "Revogado" passa a ser "Convite cancelado", com o motivo.

**Permissões:**

- **Plano:** exige `evaluate` ou `calibrate`. Sem `calibrate`, vale só a relação de liderança (o avaliador da tarefa LEADER, ou o gestor no ciclo). Nem o alcance da organização inteira basta.
- **`/me/*`:** exige `view` e atua só sobre a jornada do próprio cadastro ligado.

## Rollout (ordem obrigatória)

1. Aplicar a migration `20261105120000_performance_staged_cycle` **antes** do código. Ela é aditiva:
   - adiciona 6 colunas `TEXT` nulas em `HrPerformanceCycle`;
   - cria a tabela `HrPerformanceFollowUpPlan` (FK `ON DELETE CASCADE` para o participante).
2. Publicar o código. Não há flag nova: a funcionalidade vale dentro do módulo, que já fica atrás de `PERFORMANCE_CYCLE_ENABLED`.
3. Não há backfill. Ciclos antigos seguem sem calendário. Para usar etapas num ciclo em rascunho ou preparado, preencha as datas em **Editar nome e etapas**.
4. Na homologação:
   - criar um ciclo de teste com calendário;
   - conferir que a avaliação do líder fica bloqueada antes do início;
   - responder em **Minha avaliação**;
   - na Calibração, conferir que a proposta do líder aparece para o RH Gestor e não aparece para o RH Operacional.

## Validação local (sem PostgreSQL real)

- `performanceStagedCycle.test.ts`: 20 testes (regra das janelas, calendário, jornada no sistema, plano do líder, avisos).
- `performancePermissions.test.ts`:
  - 2 testes de API novos;
  - o teste rota a rota foi ajustado para `/me/*`, que é a jornada da própria pessoa. O RH Operacional sem cadastro ligado não grava nada.
- Testes de integração PG17 **não** foram executados localmente (política do projeto: só na homologação).
