# Competências e Desenvolvimento

Submódulo de **Gestão de pessoas** (`/competencies`). Organiza as competências pelos departamentos oficiais do RH, com avaliações individuais, evolução, polivalência e treinamentos.

Breadcrumb: Gestão de pessoas › Competências e Desenvolvimento.

## Princípios

- **Engine oficial única.** `src/lib/competencies/competencyEngine.ts` é pura (sem Prisma) e calcula os indicadores de desenvolvimento, a média da avaliação, a reciclagem e, por compatibilidade, a cobertura legada dos postos.
  - Só `competency.server.ts` a chama. A UI apenas formata o que a API devolve.
  - O teste `competencyOfficialEngineGuard.test.ts` impede que componentes importem funções de cálculo dela.
- **Nada de entidade paralela.**
  - Colaborador = `Employee` (somente ativos).
  - Setor = `HrDepartment` (departamento oficial do RH).
  - O posto de trabalho é físico e **não** substitui o cargo salarial (`Role`).
  - Não existe vínculo oficial de turno no colaborador (`Employee.workSchedule` é texto livre). A configuração da competência usa os códigos 1, 2 e 3; o `shiftPattern` do posto continua sendo só a quantidade de turnos do posto físico.
- **Avaliação de competência ≠ avaliação de experiência.** `HrEmployeeEvaluation` (45/90 dias, por template e pesos) continua intacta. Aqui o registro é o nível de 1 a 4 por competência exigida.
- **Histórico append-only.**
  - Toda gravação de nível gera uma linha em `HrEmployeeCompetencyLevelHistory`: na avaliação, sempre; na edição manual, só quando o nível muda.
  - A alocação em posto encerra a anterior em vez de apagá-la.
- Nada aqui altera custo, folha, comissões, Nomus ou o snapshot de `Employee`.

## Ativação (feature flag)

`COMPETENCIES_ENABLED` (servidor, `competencyFeatureFlags.ts`) segue o padrão do Fluxo de Pedidos e do Exposure. É **fail closed**: sem `1/true/yes/on/enabled`, fica desligada.

| | Desligada (padrão) | Ligada |
|---|---|---|
| API `/api/hr/competencies/*` | 404 `FEATURE_DISABLED` para todos, inclusive SUPER_ADMIN (antes de qualquer acesso ao banco) | Normal, com permissões e escopo |
| `GET /api/hr/competencies/feature-status` | `{ enabled: false }` (exige sessão) | `{ enabled: true }` |
| Menu "Competências e Desenvolvimento" | Oculto (`filterCompetenciesMenuNavigation` no Sidebar) | Visível para quem tem permissão |
| Rota `/competencies` (link direto) | "não está ativado neste ambiente" | Módulo |
| Aba Competências da ficha | Oculta | Visível para quem tem permissão |

- A flag não concede permissão, e a permissão não liga a flag.
- A interface consulta o status uma vez por carregamento da página. Falha na consulta = desligada.
- Não há processo, cron ou fila associada: desligar não deixa nada rodando.
- Documentada em `.env.example` como `COMPETENCIES_ENABLED=0`.

## Escala (fixa)

| Nível | Nome | Descrição | Cor |
|---|---|---|---|
| 0 | Não avaliado | Sem registro | cinza (slate) |
| 1 | Em formação | Executa com acompanhamento constante | vermelho (rose) |
| 2 | Básico | Executa tarefas padrão com supervisão | âmbar |
| 3 | Proficiente | Executa com autonomia e qualidade | azul (primary) |
| 4 | Referência | Domina, ensina e melhora o processo | verde (emerald) |

## Regras (engine oficial)

| Conceito | Regra |
|---|---|
| Nível efetivo | Nível gravado; com **reciclagem vencida**, cai para 1 (veja abaixo). |
| Requisito atendido | nível efetivo ≥ mínimo do posto do colaborador. |
| Lacuna | Requisito não atendido. Diferença = mínimo − nível efetivo. |
| Ordenação das lacunas | Maior diferença primeiro; empate por nome do colaborador e depois pela ordem da competência. A Visão geral mostra as 6 primeiras. |
| Cobertura | atendidos ÷ total de requisitos; "—" sem requisitos. |
| Apto no posto | Atende 100% dos requisitos do posto. |
| Barra de aptidão | Verde ≥ 75%, âmbar ≥ 50%, vermelho abaixo disso, neutra sem equipe. |
| Média da avaliação | Média dos níveis atribuídos, 1 casa decimal, com vírgula (`2,8`). |
| Pendências | Avaliações ≠ `COMPLETED`; treinamentos ≠ `COMPLETED`. |

**Reciclagem.** Vale para competências marcadas com `requiresRecycling`.

1. Pega o último treinamento **concluído** do colaborador naquela competência (maior data de conclusão do participante).
2. O vencimento é a data de conclusão + validade em meses. O dia do vencimento ainda vale; vence a partir do dia seguinte.
3. Vencido, o nível efetivo vira 1 ("Em formação"). O nível gravado não muda: a matriz mostra 1 e o tooltip informa o vencimento e o nível registrado.

Quando o nível não cai:
- **Sem treinamento concluído registrado:** mantém o nível gravado. Isso evita derrubar a equipe inteira no dia em que a competência passa a exigir reciclagem.
- **Validade 0:** sem vencimento.

**Unidade organizacional.** O departamento oficial (`HrDepartment`, via `Employee.departmentId`) é o contexto. A tela lista departamentos já existentes — não os cria — e associa competências do catálogo (`HrDepartmentCompetency`), sem nível mínimo. A mesma competência pode pertencer a vários departamentos e, na configuração, a um, vários ou todos os turnos 1, 2 e 3. Essa escolha não classifica o colaborador, não altera `workSchedule` e não duplica a competência no catálogo. Trocar o departamento do colaborador não duplica nem apaga o histórico de níveis. A matriz e a visão geral filtram colaboradores pelo departamento oficial; o filtro de turno restringe as competências configuradas.

**População.** Entram na matriz e nos indicadores os colaboradores **ativos** visíveis no escopo, com ou sem posto. Competências arquivadas saem das colunas. A associação ao departamento sugere competências na avaliação; não obriga a avaliar todas e não cria lacuna.

**Postos (compatibilidade).** `HrWorkPosition`, `HrWorkPositionRequirement` e `HrEmployeeWorkPosition` permanecem no banco e na API. Não são o fluxo principal e não são exigidos para avaliar. Os indicadores da Visão geral não usam o mínimo do posto.

## Governança de níveis

Regras adotadas em 2026-10-15 (`competencyGovernance.ts`, pura). São ajustáveis num único lugar e estão sujeitas à validação do RH.

| Situação | Tratamento |
|---|---|
| Avaliação formal (ou treinamento) | Grava direto. É o registro oficial e não passa por aprovação, nem em competência crítica. |
| Ajuste na matriz / importação que **sobe** para 3 ou 4 | Exige aprovação (`GOVERNED_LEVEL`). |
| Qualquer subida em competência **crítica** (ex.: NR-12) | Exige aprovação (`CRITICAL_COMPETENCY`). |
| Rebaixar ou manter | Nunca exige aprovação (direção conservadora). |
| Quem tem "Aprovar níveis" faz o ajuste | Grava direto e fica registrado (auditoria com `selfApproved`). |
| Quem não tem | Cria **solicitação pendente**. A matriz não muda e a célula mostra "aprovação → N". |
| Decisão | Aprovar aplica o nível, com histórico ligado à solicitação (`requestId`). Rejeitar exige justificativa. Quem pediu não decide a própria solicitação (403 `SELF_DECISION`). |
| Nível mudou por outro caminho (avaliação, ajuste, aprovação de outra) | A solicitação pendente do mesmo par vira **Superada**. |
| Mesma solicitação repetida (ou reimportação) | Reaproveita a pendente; não duplica. |

**Competência crítica:** flag `critical` no cadastro ("Competência crítica"). Ela aparece marcada na matriz, nas lacunas, na ficha e nas aprovações. A Visão geral conta as lacunas críticas à parte (`criticalGaps`).

**Concorrência:**
- **Nível:** cada nível tem `version`. O ajuste envia a versão exibida e a gravação é condicional (`updateMany … where version`). Edição simultânea → 409 `LEVEL_CHANGED`, e a tela recarrega o valor atual.
- **Avaliação:** a conclusão de uma avaliação aberta é condicional ao status. Concluir duas vezes → 409 `ASSESSMENT_LOCKED`.
- **Aprovação:** a decisão é condicional a `PENDING` (duas decisões → 409 `REQUEST_DECIDED`) e exige que a versão do nível seja a da solicitação (senão 409 `REQUEST_STALE` e a solicitação é superada).
- **Banco:** um índice parcial garante uma única solicitação pendente por colaborador + competência.

## Modelo de dados

Migration: `20261008120000_hr_competencies`. É aditiva: só cria tabelas, não altera colunas nem dados existentes.

| Tabela | Conteúdo |
|---|---|
| `HrCompetency` | `name`, `category` (`TECHNICAL`/`SAFETY`/`QUALITY`/`BEHAVIORAL`), `description`, `requiresRecycling`, `critical`, `status`, `sortOrder` (ordem das colunas). Nome único entre as ativas, sem diferenciar maiúsculas (índice parcial `HrCompetency_name_active_uidx`). |
| `HrDepartmentCompetency` | Associação `departmentId` + `competencyId`, sem nível mínimo. `appliesToAllShifts` (padrão true) cobre os turnos 1, 2 e 3. Única por par. Migration `20261015140000_hr_department_competency`. |
| `HrDepartmentCompetencyShift` | Subconjunto de turnos de configuração (`shiftCode` 1, 2 ou 3) quando `appliesToAllShifts` é false. Única por associação + código. Não é turno do colaborador. Migration `20261015153000_hr_department_competency_shift`. |
| `HrWorkPosition` | Compatibilidade. `name`, `departmentId` → `HrDepartment`, `shiftPattern` (`ONE_SHIFT`/`TWO_SHIFTS`/`THREE_SHIFTS`), `status`. |
| `HrWorkPositionRequirement` | `positionId`, `competencyId`, `minLevel` 1–4 (CHECK). Único por par. |
| `HrEmployeeWorkPosition` | Alocação com histórico (`startedAt`/`endedAt`). No máximo uma ativa por colaborador (índice parcial `HrEmployeeWorkPosition_employee_active_uidx`). |
| `HrEmployeeCompetencyLevel` | Nível atual 0–4 (CHECK), `source` (`ASSESSMENT`/`MANUAL`/`TRAINING`/`IMPORT`), `assessedAt`, `version` (concorrência otimista). Único por colaborador + competência. |
| `HrEmployeeCompetencyLevelHistory` | Append-only: nível anterior → novo, origem, `assessmentId?`, `importBatchId?`, `requestId?`, ator. |
| `HrCompetencyLevelRequest` | Solicitação de nível governado: de → para, `baseVersion`, origem, motivo, `importBatchId?`, status (`PENDING`/`APPROVED`/`REJECTED`/`SUPERSEDED`), solicitante, decisor, data e justificativa. Uma pendente por par (índice parcial); níveis com CHECK 0–4. |
| `HrCompetencyAssessment` | Colaborador, avaliador (`Employee`) + snapshot do nome, posto + snapshot do nome, data, `status` (`PENDING`/`IN_PROGRESS`/`COMPLETED`), observações, `averageLevel`. |
| `HrCompetencyAssessmentItem` | Nível 1–4 (CHECK) por competência e o mínimo vigente no momento (`requiredLevel`). |
| `HrTraining` | `title`, `competencyId`, `modality` (`IN_PERSON`/`ONLINE`/`ON_THE_JOB`), `workloadHours`, `startDate`, `validityMonths` (0 = sem validade), `status` (`SCHEDULED`/`IN_PROGRESS`/`COMPLETED`), `completedAt`. |
| `HrTrainingParticipant` | Participante e `completedAt`, que é a base da reciclagem. |
| `HrTraining.instructorName` / `syllabus` | Instrutor (opcional) e conteúdo programático `[{ title, hours }]` do certificado. Migration `20261016120000_hr_training_certificates`. |
| `HrTrainingCertificateSettings` | Linha única `GLOBAL` (CHECK): signatário, cargo, local de emissão e prefixo da numeração (CHECK de formato), com autor da última alteração. Sem valores padrão. |
| `HrTrainingCertificate` | Certificado emitido: número único, `year` + `sequence` únicos, treinamento, colaborador, `status` (`ACTIVE`/`CANCELED`), emissão (data/autor), `payload` congelado + `payloadSha256`, cancelamento (data/autor/motivo). Imutável por trigger. |
| `HrCompetencyImportBatch` | Uma linha por importação por planilha **que alterou algo**: nome e SHA-256 do arquivo, linhas, alterações, conflitos aplicados, resumo (JSON só com contagens) e autor. O histórico de níveis aponta para o lote (`importBatchId`, origem `IMPORT`). |

Datas de negócio são gravadas como meia-noite UTC e trafegam como `AAAA-MM-DD`. O "hoje" da engine segue o fuso de São Paulo.

## API

Arquivo: `src/lib/competencies/competencyRoutes.ts`. É registrado em `server.ts` com `requireResourceOrHrEditor`.

- Erros saem como `{ error: CODE, message }`, com mensagem em pt-BR.
- A autoria vem sempre da sessão.
- Leituras usam `Cache-Control: no-store`.
- Cliente do navegador: `competencyClient.ts`.

| Método | Caminho | Capacidade | Notas |
|---|---|---|---|
| GET | `/api/hr/competencies/overview` | ver | KPIs já calculados pela engine. `?departmentId=` filtra colaboradores do departamento oficial. `?shifts=1,2` filtra competências configuradas para esses turnos. |
| GET | `/api/hr/competencies/matrix` | ver | Linhas × colunas, com nível efetivo, mínimo, `belowMinimum` e situação da reciclagem. Aceita os mesmos filtros de departamento e turno. |
| GET | `/api/hr/competencies/catalog` | ver | Competências ativas. |
| GET | `/api/hr/competencies/positions` | ver | Postos com requisitos e equipe. |
| GET | `/api/hr/competencies/options` | ver | Colaboradores ativos (avaliador, equipe) e setores. |
| GET | `/api/hr/competencies/departments` | ver | Departamentos oficiais e as competências associadas, com turnos de configuração. |
| PUT | `/api/hr/competencies/departments/:id/competencies` | gerenciar | Substitui as associações. `{ items: [{ competencyId, shifts }] }`; `shifts` null ou `["1","2","3"]` = todos. Não grava nível, avaliação nem turno do colaborador. Lista antiga `{ competencyIds }` continua valendo para todos os turnos. |
| GET | `/api/hr/competencies/employees/:employeeId` | ver | Perfil de UM colaborador para a ficha funcional: posto, requisitos com nível atual, cobertura, apto, outras competências registradas e as últimas 50 alterações de nível. Também inclui inativo e quem está sem posto. Fora do escopo → 404. |
| POST/PUT/DELETE | `/api/hr/competencies/catalog[/:id]` | gerenciar | DELETE arquiva (`INACTIVE`). 409 `DUPLICATE_NAME`. |
| POST/PUT/DELETE | `/api/hr/competencies/positions[/:id]` | gerenciar | Exige nome e ≥ 1 requisito (`REQUIREMENTS_REQUIRED`). Nível 0 = não exigido. DELETE arquiva e encerra as alocações. |
| PUT | `/api/hr/competencies/positions/:id/team` | gerenciar | `{ employeeIds }`. Encerra a alocação de quem sai e transfere quem vem de outro posto. |
| PUT | `/api/hr/competencies/levels/:employeeId/:competencyId` | editar matriz | `{ level: 0..4, expectedVersion? }`, origem `MANUAL`. 200 `APPLIED` ou 202 `REQUESTED` (governança). Versão antiga → 409 `LEVEL_CHANGED`. |
| GET | `/api/hr/competencies/approvals?status=PENDING\|DECIDED` | ver aprovações | Solicitações no escopo do usuário. |
| POST | `/api/hr/competencies/approvals/:id/decision` | aprovar níveis | `{ decision: APPROVE\|REJECT, note? }`. Rejeitar exige `note`. Autoaprovação → 403. Já decidida → 409. |
| GET | `/api/hr/competencies/import/template` | editar matriz | Modelo .xlsx: colaboradores que o usuário pode alterar, com os níveis **gravados** (0 sai em branco) e uma aba de instruções. |
| POST | `/api/hr/competencies/import/preview` | editar matriz | Multipart: `file` (.xlsx, até 5 MB) + `resolutions` (JSON). Devolve a prévia e a `fingerprint`. **Não grava nada.** |
| POST | `/api/hr/competencies/import/apply` | editar matriz | Mesmo arquivo + `resolutions` + `fingerprint`. Refaz o plano dentro da transação; estado mudou desde a prévia → 409 `PREVIEW_STALE`. Sem alterações → `batchId: null` (nenhum lote). |
| GET | `/api/hr/competencies/assessments` | ver avaliações | `?employeeId=` opcional (ficha). Colaborador fora do escopo → lista vazia. |
| POST | `/api/hr/competencies/assessments` | registrar avaliação | Detalhado na tabela de status abaixo. |
| PUT | `/api/hr/competencies/assessments/:id` | registrar avaliação | Conclui ou reagenda uma avaliação aberta. |
| DELETE | `/api/hr/competencies/assessments/:id` | registrar avaliação | Só avaliações abertas. Concluída → 409 `ASSESSMENT_LOCKED`. |
| GET | `/api/hr/competencies/trainings` | ver treinamentos | `?employeeId=` opcional (ficha). Colaborador fora do escopo → lista vazia, nem a participação em turma mista é revelada. |
| POST/PUT | `/api/hr/competencies/trainings[/:id]` | gerenciar treinamentos | Exige título e ≥ 1 participante. Nasce `SCHEDULED`. |
| PATCH | `/api/hr/competencies/trainings/:id/status` | gerenciar treinamentos | `{ status, completedOn? }`. Concluir grava a data de conclusão dos participantes. |
| DELETE | `/api/hr/competencies/trainings/:id` | gerenciar treinamentos | Treinamento concluído → 409 `TRAINING_LOCKED`. |

**POST `/assessments` por status:**

| Status | Comportamento |
|---|---|
| `COMPLETED` | Exige avaliador e ao menos um item com nível. Lista vazia → 400 `ITEMS_REQUIRED`. Competência desconhecida → `UNKNOWN_COMPETENCY`. Item repetido → `DUPLICATE_ITEM`. Não exige posto. Uma avaliação grava um nível por colaborador e competência, qualquer que seja o turno configurado. Na mesma transação: grava a média calculada pela engine, os itens, os níveis atuais e o histórico, e **substitui** a avaliação aberta do colaborador. A mais recente vira a concluída e as demais pendências dele são removidas. |
| `PENDING` / `IN_PROGRESS` | Só agenda, sem níveis. |

Auditoria em `logEmployeeHrAudit`:
- Eventos `employee.competency.*`: `level.change`, `assessment.create`, `assessment.update`, `assessment.complete`, `assessment.delete`, `position.assign`.
- Eventos `competency.catalog.change`, `competency.position.change` e `competency.training.change`.
- Os detalhes trazem só ids, contagens e níveis.

## Permissões

O perfil de acesso persiste 3 eixos por recurso (ver / executar / gerenciar). Por isso as capacidades usam um recurso principal e duas abas:

| Capacidade | Recurso (contrato) | Ação | Chave legada |
|---|---|---|---|
| Ver o módulo | `admin.employees.competencies` (SUBMENU) | view | `employees.competencies.view` |
| Editar a matriz | `admin.employees.competencies` | update | `employees.competencies.matrix.execute` |
| Gerenciar competências e postos | `admin.employees.competencies` | manage | `employees.competencies.manage` |
| Ver avaliações | `admin.employees.competencies.assessments` (TAB) | view | `employees.competencies.assessments.view` |
| Registrar avaliação | `admin.employees.competencies.assessments` | create | `employees.competencies.assessments.create` |
| Ver treinamentos | `admin.employees.competencies.trainings` (TAB) | view | `employees.competencies.trainings.view` |
| Gerenciar treinamentos | `admin.employees.competencies.trainings` | manage | `employees.competencies.trainings.manage` |
| Ver aprovações de nível | `admin.employees.competencies.approvals` (TAB) | view | `employees.competencies.approvals.view` |
| Aprovar níveis | `admin.employees.competencies.approvals` | manage | `employees.competencies.approvals.manage` |

- **Sufixos das chaves legadas.** Seguem o eixo da heurística de dual-write (`.execute`/`.create` → executar; `.manage` → gerenciar).
- **Editor de RH.** `employees.edit` também é alias das ações, como nas demais facetas `admin.employees.*`. O pin de `employees.edit` → `admin.employees` (`aliasIndex.ts`) continua decidindo o vínculo canônico, então marcar "ver Competências" num perfil **não** concede edição do RH. No servidor, `requireResourceOrHrEditor` supre só a ausência de grant (`DENY_DEFAULT`) e nunca um deny explícito.
- **Perfis.** Os recursos entram pelo seed derivado do contrato (`npm run permissions:seed`). Por padrão, só o SUPER_ADMIN e o editor de RH têm acesso. Os demais perfis são liberados na tela de perfis.
- **UI.** Botões, abas e a edição da matriz somem sem a capacidade (`resolveCompetencyCapabilities` + `canPerformAction`). A aba sem permissão nem chama a API. A API recusa com 403 de qualquer forma.

### Escopo hierárquico (quem o usuário pode ver e alterar)

A permissão de recurso diz **o que** o usuário pode fazer; o escopo diz **sobre quem**. É a mesma régua da ficha do RH (`resolvePeopleAccessScope`), resolvida no servidor a cada requisição (`getScopeInput` em `server.ts` → `buildCompetencyScope`, `src/lib/competencies/competencyScope.ts`). Nunca vem do cliente.

| Perfil | Escopo | Vê | Altera |
|---|---|---|---|
| RH (`employees.view` / `employees.edit`) e SUPER_ADMIN | ALL | todos | todos |
| Líder com `employees.team.descendants.view` | DESCENDANTS | ele + toda a árvore abaixo (CTE `loadDescendantEmployeeIds`) | só a árvore |
| Líder com `employees.team.view` | DIRECT_REPORTS | ele + liderados diretos | só os liderados |
| Só ficha própria | SELF | só ele | ninguém |
| Sem colaborador vinculado ao usuário, ou sem escopo | NONE | ninguém | ninguém |

O líder nunca altera o próprio nível nem se autoavalia: isso continua com o RH.

O que o escopo filtra ou bloqueia:
- **Leituras:** matriz, Visão geral (KPIs, lacunas, aptidão, contadores), busca de colaboradores (`/options`), equipe dos postos, avaliações e treinamentos. A lista de treinamentos mostra as turmas com ao menos um liderado; os participantes de outras equipes aparecem só como contagem (`hiddenParticipantCount`).
- **Escritas (403 `OUT_OF_SCOPE`):** nível manual; avaliação de quem não é liderado ou com avaliador de fora da equipe; inscrição em treinamento; alterar, concluir ou excluir turma que tenha participante de outra equipe; alocar ou retirar alguém no posto; arquivar posto com membro de fora.
- **Registro de outra equipe:** avaliação ou treinamento que o líder não vê → 404, sem confirmar que existe.
- **Equipe do posto:** quem o líder não enxerga é **preservado** quando ele salva a equipe. Nunca sai por omissão.

A interface usa `writable` (por linha da matriz e por colaborador em `/options`) para esconder o que o servidor recusaria, e mostra um aviso quando a visão é restrita (`overview.scope`).

## UI

Componentes em `src/components/competencies/`. Partes reaproveitadas do repositório:
- `SystemTotalizerCard` + `SummaryKpiGrid` nos KPIs.
- `OverlayTabs` (pill, com contador) nas abas.
- `Overlay`, `OverlayHeader`, `OverlayFooter` (hint à esquerda, Cancelar e ação primária desabilitada até o formulário ser válido), `OverlayField`, `OverlayInput`/`OverlaySelect`/`OverlayTextarea`, `OverlayTable` e `OverlayBadge` nos modais e tabelas.

Não há CSS novo. Segmentado, toggle, chip e toast seguem os padrões locais do Dashboard de Pessoas e do CRM, porque o repositório não tem primitivo compartilhado para eles.

| Aba | Conteúdo |
|---|---|
| Visão geral | 4 KPIs; Lacunas por posto (atual → exigido, botão **Planejar**); Aptidão por posto. |
| Matriz de competências | A aba mostra o resumo e abre a grade numa modal de tela cheia. Só a grade rola. Colaborador e cabeçalho ficam grudados. O agrupamento inicial é por departamento, a partir de `HrDepartmentCompetency` e dos turnos configurados. A outra visão agrupa pelo texto gravado em `HrCompetency.category`; "Sem categoria" só aparece quando esse texto está vazio. A mesma competência pode repetir a coluna em mais de um departamento, com uma única avaliação. Popover com os 5 níveis (edição persistida com histórico). |
| Avaliações | Colaborador, posto, avaliador, data dd/mm/aaaa, média e status. **Agendar avaliação**; nas abertas, **Avaliar** e **Excluir**. Contador de pendentes na aba. |
| Treinamentos | Título + validade, competência, modalidade, carga, início, participantes e status. **Iniciar** / **Concluir** / **Excluir**. Contador de não concluídos na aba. |
| Aprovações | Pendentes (Aprovar / Rejeitar com justificativa) e Decididas. Contador de pendentes na aba. Sem "Aprovar níveis": só leitura. |
| Postos de trabalho | Cards com setor · turno, nome, requisitos e barra de aptos. **Equipe (n)** aloca colaboradores. |

O que cada modal faz:
- **Planejar:** abre o Novo treinamento com a competência, o título "<competência> — capacitação" e o colaborador como participante.
- **Nova avaliação:** o escopo e o nível atual vêm das células da matriz. Trocar o colaborador limpa os níveis escolhidos.
- **Novo treinamento:** os chips mostram um ponto vermelho em quem está abaixo do mínimo naquela competência.
- **Nova competência:** inclui o toggle "Exige reciclagem periódica".
- **Novo posto:** para cada competência, nível mínimo de 0 a 4.

Cada aba tem estados de carregamento, vazio e erro (com "Tentar novamente"). Depois de cada gravação há um toast, e a página recarrega os dados sem refresh. A edição de nível recarrega só a matriz e a Visão geral.

### Importação assistida por planilha

Botão **Importar planilha** no cabeçalho, com a permissão de editar a matriz. A regra fica em `competencyImport.ts` (pura); o I/O fica em `competencyImport.server.ts`.

1. **Modelo** ("Baixar modelo"): ID, Colaborador, Posto e uma coluna por competência, já com os níveis atuais da equipe do usuário. Reimportar o modelo sem editar não altera nada.
2. **Prévia** (nada é gravado). Mostra:
   - resumo: linhas, reconhecidas, alterações, sem alteração, em branco, conflitos, inválidas, sem colaborador;
   - colunas não reconhecidas (ignoradas);
   - conciliação de colaboradores;
   - conflitos;
   - lista de alterações.
   Cada decisão refaz a prévia.
3. **Aplicar:** grava só o que a prévia mostrou, numa transação, com histórico `IMPORT` ligado ao lote.

| Situação | Tratamento |
|---|---|
| Célula vazia | Não altera (nunca zera). Para registrar "Não avaliado", digitar 0. |
| Valor fora de 0–4 / nome de nível | Célula inválida, ignorada e contada. |
| Valor igual ao gravado | "Sem alteração". |
| Valor menor que o gravado (inclusive 0) | **Conflito DOWNGRADE**: padrão manter; aplicar exige marcar. |
| Nível atual veio de avaliação formal | **Conflito ASSESSED**: padrão manter; aplicar exige marcar. |
| Colaborador pela coluna ID | Casado pelo id (precedência sobre o nome). |
| Nome igual a mais de um colaborador | **Ambíguo**: escolher entre os candidatos ou deixar de fora. |
| Nome não encontrado | Associar manualmente a alguém da equipe ou deixar de fora. |
| Colaborador fora da equipe do líder | Tratado como "não encontrado" (não revela quem existe). O próprio líder aparece como "fora da sua equipe". |
| Mesmo colaborador em duas linhas | Só a primeira vale; as demais são ignoradas. |
| Coluna que não é competência | Ignorada e listada. |

- **Idempotência:** reaplicar o mesmo arquivo gera zero alterações e nenhum lote novo. A prévia avisa quando o mesmo arquivo (SHA-256) já foi aplicado.
- **Concorrência:** a `fingerprint` cobre o arquivo, o catálogo, os níveis atuais dos colaboradores da planilha e as alterações decididas. Se algo mudar entre a prévia e a aplicação, a aplicação é recusada (409) e a tela refaz a prévia.
- **Sem estado no servidor:** nada fica em memória entre a prévia e a aplicação. O arquivo é processado em memória e nunca vai para o disco.
- **Limites:** 5 MB, 2.000 linhas e 200 colunas. Só .xlsx (assinatura ZIP); fórmulas não são avaliadas.
- **Biblioteca `xlsx` 0.18.5:** é a versão que o repositório já usa. Ela tem avisos públicos conhecidos (prototype pollution e ReDoS na leitura, corrigidos em versões posteriores do SheetJS). A exposição aqui fica limitada a usuários autenticados com permissão de editar a matriz, mais os limites acima. A troca de versão vale para o repositório inteiro e fica como pendência.

### Ficha funcional › Competências

A aba **Competências** fica na Ficha Funcional do colaborador (Pessoas / RH › abrir a ficha), no grupo *Rotina*.

- **Fonte dos dados:** só os endpoints do módulo (`/employees/:id`, `/assessments?employeeId=` e `/trainings?employeeId=`). A ficha não tem tabela, rota nem cálculo próprios de competências, e o guard `competencyOfficialEngineGuard.test.ts` garante isso.
- **Carregamento:** sob demanda (`lazy`), como as demais abas da ficha.
- **Visibilidade:** a aba aparece com a permissão de ver o módulo (`admin.employees.competencies:view`). As seções de avaliações e de treinamentos dependem das permissões das respectivas abas.
- **Escopo:** é o mesmo do módulo. Colaborador fora da equipe do líder → "fora do seu escopo".
- **Somente leitura:** para avaliar ou alterar níveis, use "Abrir módulo".

Conteúdo da aba:
- departamento oficial e competências associadas a ele, com o nível atual (sem mínimo inventado);
- níveis registrados fora do departamento atual (polivalência) e o histórico;
- outras competências registradas;
- avaliações;
- treinamentos;
- histórico de níveis.

## Certificados de treinamento

Treinamentos › **Certificados** abre o painel do treinamento. Ele emite, imprime e cancela certificados de conclusão no modelo visual "Certificado Lazarios Koppetel" (A4 paisagem). **Nada é digitado no certificado.** Cada campo vem do sistema:

| Campo do certificado | Origem |
|---|---|
| Nome do participante | `Employee.name`, no momento da emissão |
| Curso, carga horária, modalidade, início | `HrTraining` |
| "Concluído em" | `HrTrainingParticipant.completedAt` (gravado ao concluir o treinamento) |
| Competência desenvolvida (lateral, sem conteúdo programático) | `HrCompetency.name` + `description` |
| Conteúdo programático (lateral) | `HrTraining.syllabus` (módulos com horas; soma = carga horária) |
| 2ª assinatura | `HrTraining.instructorName`. Sem instrutor, a linha traz local e data |
| Signatário, cargo, local de emissão, prefixo da numeração | `HrTrainingCertificateSettings` (configuração única, editada no painel) |
| Empresa, logo, slogan, site, texto do selo | `BrandingSettings` (Administração › Identidade Visual). Logo: proposta → expandido → compacto, igual aos documentos de projeto |
| Registro nº | `{prefixo}-{ano da emissão}/{sequência de 4 dígitos}`, sequencial por ano, nunca reutilizado |
| Data de emissão | Data de negócio (São Paulo) do clique em Emitir |

**Regras** (`src/lib/competencies/trainingCertificate.ts` e `trainingCertificate.server.ts`)

- **Emissão bloqueada** se: treinamento não concluído, carga 0, conteúdo que não fecha a carga, configuração incompleta, ou empresa sem nome na Identidade Visual. Os impedimentos aparecem no painel e voltam no 409 `CERTIFICATE_BLOCKED`.
- **Um certificado vigente** por participante do treinamento (índice parcial `HrTrainingCertificate_active_participant_uidx`). Emitir de novo não duplica: devolve `ALREADY_ISSUED`. Participante sem conclusão devolve `NOT_COMPLETED`.
- **Conteúdo congelado**: a emissão grava o conteúdo inteiro (inclusive o logo) em `payload` com `payloadSha256`. Imprimir usa só o gravado. Mudar o cadastro do colaborador, a Identidade Visual ou o signatário depois **não altera** certificados emitidos. A impressão é recusada se o hash não conferir.
- **Imutável no banco**: trigger `HrTrainingCertificate_immutable` bloqueia DELETE e todo UPDATE, exceto ACTIVE → CANCELED com data, autor e motivo (CHECK exige motivo). `HrTraining` com certificado não pode ser excluído (FK RESTRICT).
- **Cancelar → reemitir**: o cancelamento fica no histórico do painel e a nova emissão recebe outro número.
- **Instrutor e conteúdo programático** podem ser informados no "Novo treinamento" ou no painel, inclusive depois da conclusão. Ficam **travados** enquanto houver certificado vigente (409 `CERTIFICATE_CONTENT_LOCKED`).
- **Escopo**: o líder vê e emite apenas para a própria equipe. A configuração global só é alterada com escopo RH (ALL).
- **Concorrência**: a numeração usa o maior número do ano + 1 dentro da transação. Em colisão (`P2002` no número único ou no índice parcial), a emissão é refeita até 3 vezes.

**Impressão**: `src/components/competencies/certificate/trainingCertificatePrint.ts` monta o HTML (`renderTrainingCertificatesHtml`, uma página por certificado) num iframe isolado do CSS do app e chama a impressão do navegador. O usuário salva em PDF por ali. Fontes Lato e Ubuntu (subconjunto latino) estão embutidas: 400/500/700 vêm da arte de Comunicados, 300 fica em `certificate/assets`. O diálogo espera as fontes e o logo carregarem.

**API**

| Método e rota | Capacidade |
|---|---|
| `GET /api/hr/competencies/certificate-settings` | `viewTrainings` |
| `PUT /api/hr/competencies/certificate-settings` | `manageTrainings` + escopo RH |
| `GET /api/hr/competencies/trainings/:id/certificates` (painel) | `viewTrainings` |
| `PUT /api/hr/competencies/trainings/:id/certificate-content` | `manageTrainings` |
| `POST /api/hr/competencies/trainings/:id/certificates` (`{ employeeIds? }`) | `manageTrainings` |
| `GET /api/hr/competencies/trainings/:id/certificates/document?ids=` | `viewTrainings` |
| `POST /api/hr/competencies/certificates/:id/cancel` (`{ reason }`) | `manageTrainings` |

Auditoria: `competency.certificate.settings`, `competency.certificate.issue`, `competency.certificate.cancel`.

**Validação (2026-10-16, sem banco real)**

- Testes: `trainingCertificate.test.ts` (12) e `trainingCertificateRoutes.test.ts` (9).
- PostgreSQL descartável (PGlite) com DDL da main + migration:
  - 18 verificações de CHECK, índice parcial, trigger e FK;
  - `migrate diff` vazio contra o schema;
  - 17 verificações com rotas reais + Prisma, incluindo duas emissões simultâneas sem número repetido.
- Fluxo completo na UI real (configurar → emitir → cancelar → reemitir → imprimir). PDF do Chrome: 6 páginas A4 paisagem.
- Limite do teste: o logo real (≈330 KB) derruba o servidor PGlite. Por isso, nas rotas reais o logo foi validado com um PNG pequeno; o logo real foi usado no harness.

## Diferenças em relação ao protótipo

| Protótipo | Implementação | Motivo |
|---|---|---|
| Clique na célula faz o ciclo 0→4 | Popover com os 5 níveis, persistido e com histórico | Pedido do prompt para a produção. |
| Avaliador em texto livre | Colaborador ativo (FK + snapshot do nome) | Rastreabilidade; mesmo padrão de `HrEmployeeEvaluation`. |
| Salvar a avaliação sem escolher níveis (média "—") | Exige um nível de 1 a 4 em cada competência exigida | A média e a matriz precisam de nível explícito; evita avaliação vazia marcada como concluída. |
| Pendências só como dados de exemplo | "Agendar avaliação" + "Avaliar" / "Excluir" nas abertas | Sem isso o KPI de pendentes ficaria sempre em 0. |
| Sem alocação de colaboradores | "Equipe (n)" no card do posto | O vínculo colaborador → posto precisa ser mantido em produção. |
| Sobretítulo "Gestão de pessoas" no cabeçalho | Breadcrumb do app | As páginas do RH não usam sobretítulo; o breadcrumb já mostra o grupo. |
| Setor/turno de lista fixa | Setor = `HrDepartment`; turno = 1/2/3 turnos validado | Reuso do cadastro oficial. |
| Barra de aptidão vermelha sem equipe | Neutra ("—") | 0 de 0 não é inaptidão. |

## Rollout

0. Manter `COMPETENCIES_ENABLED` desligada (padrão) até concluir os passos abaixo. Ligar ao final, sem rebuild: basta reiniciar o processo com a variável.
1. Aplicar a migration `20261008120000_hr_competencies` **antes** do código: a página consulta as tabelas novas.
2. Rodar `npm run permissions:seed` para criar os 3 recursos novos.
3. Liberar os perfis desejados na tela de perfis de acesso.
4. Certificados: aplicar a migration `20261016120000_hr_training_certificates` **antes** do código (a lista de treinamentos consulta `HrTrainingCertificate`). Depois, no painel de certificados, configurar signatário, cargo, local e prefixo. Conferir nome, logo, slogan e site em Identidade Visual. Sem permissão nova: usa as de Treinamentos.
5. Cadastrar competências e postos e alocar as equipes. Os níveis começam em 0 e são preenchidos pelas avaliações, pela edição da matriz ou pela importação por planilha (carga inicial: Baixar modelo → preencher → Importar).

## Testes

`npm run test:competencies` cobre:
- `competencyEngine.test.ts`: cobertura, lacunas e ordenação, apto, média e reciclagem, sobre o cenário do protótipo.
- `competencyRoutes.test.ts`: guardas 401/403 por capacidade, catálogo, postos e alocação; a avaliação atualiza matriz, KPIs e lacunas e substitui a pendente; imutabilidade; treinamentos e reciclagem; rollback da transação. Também cobre a ficha: os números batem com a matriz, abrir a ficha não grava nada, colaborador sem posto e filtros por colaborador. Usa banco simulado (`competencyTestSupport.ts`).
- `competencyOfficialEngineGuard.test.ts`: a UI não recalcula. A aba da ficha só lê pelo cliente do módulo e é carregada sob demanda.
- `competencyImport.test.ts`: regra pura da importação (células, conflitos, conciliação, duplicidade, erros fatais, idempotência, impressão digital).
- `competencyImportRoutes.test.ts`: XLSX real nas rotas reais. Cobre:
  - o modelo e a reimportação idempotente do modelo;
  - prévia sem gravar e aplicação com resoluções (lote e histórico `IMPORT`);
  - reaplicação sem lote novo e prévia desatualizada (409);
  - escopo de líder;
  - arquivo inválido ou grande e resoluções inválidas;
  - 403 sem permissão.
- `competencyGovernance.test.ts`: regra pura (quando exige aprovação, decisão de gravação, validação da decisão).
- `competencyGovernanceRoutes.test.ts`: rotas reais. Cobre:
  - competência crítica e contagem de lacunas críticas;
  - solicitação e reaproveitamento sem duplicar;
  - autoaprovação proibida e 403 sem permissão;
  - aprovar com histórico e segunda decisão 409;
  - rejeitar com justificativa;
  - versão antiga 409;
  - aprovador grava direto e rebaixar não exige aprovação;
  - solicitação superada por avaliação;
  - importação governada sem duplicar.
- `competencyFeatureFlags.test.ts`: fail closed, `.env.example`, filtro do menu, 404 em todos os endpoints com a flag desligada (sem tocar o banco), status 401 para anônimo e uso da flag no Sidebar, na página e na ficha.
- `competencyScope.test.ts`: regra pura de escopo e **testes negativos de acesso cruzado** nas rotas reais. Cobre matriz, dashboard, busca, equipe do posto, avaliações (inclusive avaliador de fora e autoavaliação), treinamentos (inscrição e turma mista), nível manual, descendentes, usuário sem vínculo e RH.

Esses arquivos também estão em `scripts/unit-test-files.txt`.

`competencyPersistence.pg.test.ts` é **opt-in**: só roda com `COMPETENCY_PG_TEST_URL` apontando para um PostgreSQL local (127.0.0.1/localhost) que já recebeu o schema base + a migration. Fora disso, é ignorado. Ele cobre:
- transação real e rollback;
- índices parciais e CHECKs;
- a substituição da avaliação pendente;
- a reciclagem vencida;
- o escopo de líder com a CTE recursiva real de descendentes;
- a importação por planilha (lote, histórico com FK, idempotência e prévia desatualizada);
- a governança (versão condicional, índice de uma pendente por par, aprovação aplicada e segunda decisão recusada).

Em 2026-10-15 passou 9/9 em PGlite (PostgreSQL 17.5 em memória, via `pglite-socket`). O `prisma migrate diff` do banco migrado contra o `schema.prisma` saiu vazio.

## Competências já cadastradas na homologação

As competências que já estão em `HrCompetency` — inclusive as 67 carregadas antes desta refatoração — permanecem no catálogo. O deploy das migrations `20261015140000_hr_department_competency` e `20261015153000_hr_department_competency_shift` só cria a associação. Não há backfill. A importação de níveis (ID, Colaborador, Posto) continua separada e não cria competência nem departamento.

A carga das associações é uma etapa **posterior e supervisionada**. Este deploy não a executa.

### Plano de conciliação com a TDE-FO-002 V202604

Origem do agrupamento: as oito áreas dessa planilha. Elas não são departamentos e não estão gravadas no cadastro. O destino é somente `HrDepartment` já existente. A competência de destino é somente uma linha ativa já existente em `HrCompetency`.

A prévia não grava. A gravação só ocorre depois de uma confirmação explícita da prévia, numa etapa própria.

**1. Prévia**

- Contar `HrCompetency` ativas. O esperado na homologação é 67. Outra contagem interrompe a prévia.
- Listar `HrDepartment` ativos. Não criar departamento.
- Ler as oito áreas da TDE-FO-002 V202604 e os nomes de competência de cada área.
- Normalizar texto só para comparar: sem espaços nas pontas, sem diferença de maiúsculas e sem acento. O nome gravado não muda.

**2. Correspondência exata**

- Cada nome da planilha casa com uma única competência ativa. Zero ocorrências fica como ausente. Mais de uma fica como ambígua.
- Cada área casa com um único departamento ativo pelo nome normalizado. Zero ou mais de um deixa a área inteira sem proposta.
- Proposta aceita: `departmentId` + `competencyId` já existentes, turnos em branco (todos os turnos, `appliesToAllShifts`). Sem nível mínimo.
- A mesma competência pode aparecer em mais de uma área só se cada área tiver um departamento exato. Continua sendo uma linha no catálogo.

**3. Ambiguidades**

Ficam de fora da proposta, para decisão humana:

- área sem departamento oficial de mesmo nome, ou com mais de um;
- competência da planilha sem par ativo no catálogo, ou com mais de um;
- nome que só se parece com o departamento (contém, abrevia ou traduz) sem ser igual depois da normalização.

Nada disso vira departamento novo, competência nova ou associação automática.

**4. Confirmação antes de gravar**

A prévia devolve três listas: propostas exatas, ambiguidades e ausências, mais uma impressão digital dos ids de catálogo, departamentos e propostas. A confirmação repete a leitura. Se a impressão mudou, a gravação é recusada e a prévia é refeita.

Quando essa etapa for autorizada, a gravação substitui apenas as associações confirmadas, numa transação, sem duplicar o par departamento × competência. Não altera `Employee`, `workSchedule`, avaliação, treinamento, nível nem histórico. Turno específico só entra se a confirmação o trouxer; o padrão da prévia é todos os turnos.

## Status e pendências (auditoria de 2026-10-15)

- **Escopo hierárquico: implementado** (ver Permissões › Escopo hierárquico).
- **Aba Competências na ficha: implementada** (ver UI › Ficha funcional › Competências).
- **Importação XLSX assistida: implementada** (ver UI › Importação assistida por planilha). Pendente apenas a atualização da biblioteca `xlsx` no repositório.
- **Governança (nível 3, competência crítica, aprovação, histórico, concorrência): implementada** com as regras padrão acima. Falta a validação dessas regras pelo RH.
  - Concorrência verdadeiramente paralela (várias conexões) não foi testada: o PostgreSQL local de teste (PGlite) atende uma conexão por vez. A proteção é a gravação condicional mais os índices parciais, validados de forma sequencial.
- **Feature flag: implementada** (`COMPETENCIES_ENABLED`, desligada por padrão; ver Ativação).

## Changelog

- 2026-10-15: versão inicial do módulo (schema, engine, API, permissões, navegação e UI).
- 2026-10-15: escopo hierárquico no backend (leitura e escrita) e na UI, com testes negativos de acesso cruzado.
- 2026-10-15: aba Competências na Ficha Funcional (somente leitura, consumindo os endpoints do módulo).
- 2026-10-15: importação assistida de níveis por planilha (modelo, prévia, conciliação, conflitos, idempotência), com a tabela `HrCompetencyImportBatch` na mesma migration.
- 2026-10-15: governança de níveis (competência crítica, aprovação, versão otimista, decisões condicionais), com `HrCompetencyLevelRequest` na mesma migration.
- 2026-10-15: feature flag `COMPETENCIES_ENABLED` (fail closed) para API, menu, rota e aba da ficha.
- 2026-10-16: certificados de treinamento com dados do sistema (instrutor e conteúdo programático no treinamento, configuração de assinatura e numeração, emissão congelada com sha256, cancelamento com motivo, impressão A4 no modelo Lazarios Koppetel). Migration `20261016120000_hr_training_certificates`.
