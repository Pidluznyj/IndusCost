# Ficha Funcional Corporativa

Registro oficial da trajetória do colaborador em Pessoas / RH.

## Princípios

- **Person** = identidade física. A abertura da ficha **não** cria Person nem faz merge.
- **Employee** = snapshot funcional atual (cargo, departamento, gestor, salário de referência).
- **Histórico** = eventos em `HrEmployeeHistory` / `HrCompensationAdjustment`, **append-only por padrão**. Quem tem a capacidade `canManage*` correspondente pode fazer **correções administrativas auditadas** (editar data / motivo / tipo / valores, excluir) e lançar **registros históricos** retroativos (reajuste `historicalOnly`, evento de carreira `recordOnly`). Correção e registro histórico **nunca** alteram `Employee.salary` nem o snapshot do Employee — mexem só na linha do registro.
- **PayrollComponent** (Administração → Configurações → Estrutura Operacional → Encargos e Benefícios) é a **fonte única** de encargos e benefícios do colaborador, via `EmployeePayrollComponent` — as verbas marcadas em Editar → Referência administrativa. O valor é o do cadastro e vale para todos que têm a verba. `HrBenefit` / `HrEmployeeBenefit` ficaram só como registros do modelo anterior (leitura + exclusão; sem migration).
- Alterar gestor, cargo administrativo, telefone, EPI, férias ou observações **não** recalcula custo industrial, BOM, CIU, comissões ou Nomus.

## API

Todas as rotas abaixo ficam em `src/lib/peopleProfileRoutes.ts` e usam o mesmo `viewGuard` (`requireAppAuth` + `admin.employees:view`), depois `context()` (escopo/IDOR do colaborador) e só então a capacidade `canManage*` do handler.

### Leitura

| Método | Caminho | Notas |
|--------|---------|--------|
| GET | `/api/employees/:id/profile` | Summary leve + capabilities + KPIs. Sem salário. `Cache-Control: no-store`. |
| GET | `/api/employees/:id/{professional,career,compensation,benefits,personal,emergency,epi,documents,absences,history,notes}` | Guias sob demanda. Todas com `Cache-Control: no-store`. Itens de `career` trazem `editable` (trava de tipo, ver abaixo). |
| GET | `/api/hr/benefits` | Catálogo oficial (nome, tipo, `calculationType`, `percentage`; `amount` em R$ só com `canViewCompensationValues` — a chave é omitida sem permissão). Exige `canViewBenefits`, não só o gate do módulo. É o que o modal usa na Referência administrativa. |
| GET | `/api/employees/:id/documents/:documentId/download` | Auth + scope + `findFirst({ id, employeeId })`. Download via `fetch` autenticado (não `<a href>`). |
| GET | `/api/employees/:id/photo` | Content-Type real pelos magic bytes (JPEG / PNG / WebP) + `nosniff`. 404 sem foto cadastrada ou com arquivo ausente no disco. |

### Criação (POST)

| Método | Caminho | Notas |
|--------|---------|--------|
| POST | `/api/employees/:id/compensation-adjustments` | Reajuste atômico (histórico + snapshot + auditoria). Resposta 201 sem amounts. Exige `compensation.manage` **e** valores. `type` = `HR_COMPENSATION_ADJUSTMENT_TYPES` exceto `MANUAL_EDIT` (400 `INVALID_TYPE`). Modo padrão: `expectedPreviousAmount` obrigatório, 409 `SALARY_CONFLICT` se o salário mudou. Com `historicalOnly: true` (**registro histórico**): não lê nem grava `Employee.salary`; `effectiveDate` e `newAmount` obrigatórios, `previousAmount` opcional / `null`; % e diferença saem do par (`null` sem anterior ou anterior 0); grava o evento `COMPENSATION_ADJUSTMENT` + o reajuste ligados por `historyEventId`. |
| POST | `/api/employees/:id/career-events` | Promoção / movimentação transacional (cargo, depto, CC, gestor, contrato, jornada). Com `recordOnly: true` (**registro histórico**): **não** atualiza o Employee nem checa ciclo de gestor; `effectiveDate` obrigatório; aceita `previousRoleId`, `previousDepartmentId`, `previousDepartment`, `previousManagerId`, `previousContractType`, `previousCostCenterId`, `previousCostCenter`, `previousWorkSchedule`; nomes resolvidos no servidor (`Role.name`, `HrDepartment.name`, CC como `código — nome`, gestor `socialName \|\| name`). O valor "novo" do tipo é obrigatório (400 `REQUIRED_FIELD`): `newRoleId` em `PROMOTION` / `ROLE_CHANGE`, novo depto / CC / contrato / jornada nos demais; `MANAGER_CHANGE` exige gestor anterior **ou** novo. Gestor = próprio colaborador → 400 `INVALID_MANAGER`. |
| POST | `/api/employees/:id/{absences,notes,emergency-contacts,epi-deliveries,documents}` | Persistência das guias; formulários na ficha quando `canManage*`. Validam enum (tipo / situação do afastamento, categoria da observação), intervalo de datas, quantidade de EPI, prioridade do contato e tamanho dos textos → 400. Benefício: `amount` só é aceito com `canViewCompensationValues`. |
| POST | `/api/employees/:id/photo` | `canManageProfessional`. Multipart, campo `file`; só JPEG / PNG / WebP validados pelos **magic bytes** (400 `INVALID_PHOTO`), máx. 5 MB (400 `PHOTO_TOO_LARGE`). Grava via `saveAppLocalFile` (namespace `hremployeephotos`), atualiza `Employee.photoStorageKey` e apaga o arquivo anterior. 201 `{ photoUrl }` (a URL leva `?v=<8 hex>` da chave de armazenamento para o `<img>` atualizar). |

### Correção e exclusão (PATCH / DELETE)

Regras comuns:

- `:recordId` precisa ser UUID (400 `INVALID_ID`) e pertencer ao `:id` — `findFirst({ id: recordId, employeeId })` dentro da transação, senão 404 `NOT_FOUND` (mesmo padrão anti-IDOR do download de documento). Update / delete saem por `updateMany` / `deleteMany` filtrados por `id` + `employeeId`.
- PATCH é **parcial**: só as chaves presentes no corpo mudam; `null` (ou `""`) limpa coluna anulável. Corpo não-objeto → 400 `INVALID_BODY`. Parsing puro em `src/lib/peopleProfileRecordEdits.ts`.
- Respostas: PATCH → 200 `{ id }`; DELETE → 200 `{ ok: true }`. Nenhuma devolve valores.
- Datas em `YYYY-MM-DD` ou ISO; inválida → 400 `INVALID_DATE`. Fim < início → 400 `INVALID_DATE_RANGE` (comparado com a linha já mesclada).

| Método | Caminho | Capacidade | Notas |
|--------|---------|------------|--------|
| PATCH | `/api/employees/:id/compensation-adjustments/:recordId` | `canManageCompensation` | `{ type?, effectiveDate?, previousAmount?, newAmount?, reason?, notes? }`. **Nunca** toca `Employee.salary`. Recalcula % e diferença quando vem alguma chave de valor. Espelha data / motivo / observação no evento ligado por `historyEventId`. `type` aceita `MANUAL_EDIT` (a linha automática pode ser mantida ou reclassificada). `newAmount: null` → 400; `previousAmount: null` é aceito. |
| DELETE | `/api/employees/:id/compensation-adjustments/:recordId` | `canManageCompensation` | Remove o reajuste **e** o evento `COMPENSATION_ADJUSTMENT` ligado, na mesma transação. Nunca toca `Employee.salary`. |
| PATCH | `/api/employees/:id/career-events/:recordId` | `canManageCareer` | `{ effectiveDate?, reason?, notes?, eventType? }`. Só tipos de `PEOPLE_CAREER_EDITABLE_EVENT_TYPES` (movimentações + `ADMISSION`, `TERMINATION`, `REHIRE`); os demais → 409 `HISTORY_EVENT_LOCKED` (para `COMPENSATION_ADJUSTMENT` a mensagem manda corrigir na guia Remuneração; `INITIAL_STATE` é do sistema). `eventType` só troca entre `PROMOTION` e `ROLE_CHANGE` (senão 400 `INVALID_EVENT_TYPE`). Nunca toca o Employee. |
| DELETE | `/api/employees/:id/career-events/:recordId` | `canManageCareer` | Mesma trava de tipo (409). Só o registro. |
| DELETE | `/api/employees/:id/benefits/:recordId` | `canManageBenefits` | Só registros do modelo anterior (`HrEmployeeBenefit`). As verbas oficiais são desmarcadas no cadastro (PUT `/api/employees/:id`, `componentIds`). |
| PATCH | `/api/employees/:id/absences/:recordId` | `canManageAbsences` | `{ type?, startDate?, endDate?, expectedReturn?, actualReturn?, status?, reason?, notes? }` (`HR_ABSENCE_TYPES` / `HR_ABSENCE_STATUSES`). |
| DELETE | `/api/employees/:id/absences/:recordId` | `canManageAbsences` | |
| PATCH | `/api/employees/:id/emergency-contacts/:recordId` | `canManageEmergency` | `{ name?, phone?, relationship?, alternatePhone?, priority?, notes? }` (prioridade 1–9). `recordId = "primary"` → 400 `PRIMARY_CONTACT`: o contato principal vive nas colunas do Employee e é editado no cadastro (guia Emergência). |
| DELETE | `/api/employees/:id/emergency-contacts/:recordId` | `canManageEmergency` | Mesma regra do `"primary"`. |
| PATCH | `/api/employees/:id/epi-deliveries/:recordId` | `canManageEpi` | `{ item?, deliveredAt?, quantity?, size?, validUntil?, returnedAt?, responsibleName?, notes? }` (quantidade inteira ≥ 1). |
| DELETE | `/api/employees/:id/epi-deliveries/:recordId` | `canManageEpi` | |
| PATCH | `/api/employees/:id/documents/:recordId` | `canManageDocuments` | JSON, **só metadados**: `{ documentType?, displayName?, issuedAt?, expiresAt?, notes? }`. O arquivo anexado não é substituído. |
| DELETE | `/api/employees/:id/documents/:recordId` | `canManageDocuments` | Linha (e evento ligado) no banco primeiro; o arquivo sai depois do commit (`deleteAppLocalFile(...).catch(() => undefined)`). |
| PATCH | `/api/employees/:id/notes/:recordId` | `canManageNotes` | `{ category?, body? }`. Linha **existente** `RESTRITA` sem `canViewRestrictedNotes` → 404 (sem oráculo de id). **Nova** categoria `RESTRITA` sem a permissão → 403. `visibility` acompanha a categoria. |
| DELETE | `/api/employees/:id/notes/:recordId` | `canManageNotes` | Mesma regra de restrita → 404. |
| DELETE | `/api/employees/:id/photo` | `canManageProfessional` | Limpa `photoStorageKey` e apaga o arquivo. 200 `{ ok: true }`. |

Códigos de erro das rotas de registro — 400: `INVALID_ID`, `INVALID_BODY`, `INVALID_DATE`, `INVALID_DATE_RANGE`, `INVALID_AMOUNT`, `INVALID_QUANTITY`, `INVALID_PRIORITY`, `INVALID_TYPE`, `INVALID_STATUS`, `INVALID_CATEGORY`, `INVALID_EVENT_TYPE`, `INVALID_FIELD`, `REQUIRED_FIELD`, `FIELD_TOO_LONG`, `PRIMARY_CONTACT`, `INVALID_ROLE`, `INVALID_DEPARTMENT`, `INVALID_COST_CENTER`, `INVALID_MANAGER`, `INVALID_PHOTO`, `PHOTO_TOO_LARGE`; 403: `FORBIDDEN`; 404: `NOT_FOUND`; 409: `SALARY_CONFLICT`, `HISTORY_EVENT_LOCKED`. As mensagens nunca ecoam o valor recebido.

## Permissões

Namespace oficial: `employees.*` (não foi criado um segundo motor).

- `employees.view` abre a ficha e eventos de reajuste (data / % / tipo). **Nunca** libera valores em R$.
- `employees.compensation.values.view` **ou** `employees.sensitive_data.view` **ou** legado `employees.edit` liberam valores.
- `employees.team.view` / `employees.team.descendants.view` = escopo DIRECT_REPORTS / DESCENDANTS.
- Deny explícito no motor oficial continua `deny > allow > herança`. Chave desconhecida = deny.
- Se `requireResource` anexou `canonicalAccess.viewResources`, valores monetários exigem `admin.employees.compensation_values` na lista (deny remove o recurso). `isDenied` no bag também vence `employees.edit`.

### Editor de RH

Quem pode editar o colaborador edita **tudo** que a ficha mostra — não só o SUPER_ADMIN.

- **Editor de RH** := legado `employees.edit` **OU** decisão canônica permitindo `admin.employees:update` **OU** `admin.employees:create` canônico (SUPER_ADMIN sempre). O *create* entra por compatibilidade: nas telas de permissão criar/editar são o mesmo eixo ("Executar") e os bags gravados antes do pin de `employees.edit` só carregam `employees.create` — a matriz mostrava "editar" marcado enquanto o motor negava o update. Regra única em `buildEmployeePermissionBag` (`src/lib/employeesPermissions.ts`); o `server.ts` monta o bag de todas as rotas de RH por ela (`employeePermCheck`).
- Para o editor o bag responde `employees.edit = true` (alias amplo) ⇒ **todas** as capabilities da ficha (`canManage*`, PII, emergência, notas restritas), **inclusive valores em R$**: `admin.employees.compensation_values` entra em `canonicalViewResources` mesmo sem grant próprio.
- **Exceção**: deny individual **explícito** em `admin.employees.compensation_values:view` (`deny > allow` preservado). Nesse caso o editor segue sem R$ e, como registrar / corrigir reajuste exige valores, também sem `canManageCompensation`; a listagem devolve `compensationRedacted: true`.
- `AppAuthContext.canonicalAccess` passou a carregar `updateResources` e `overrideDenied` (formato `resourceKey:action`), montados por `buildCanonicalAccessSnapshot` (`src/lib/security/requireResource.ts`). `overrideDenied` só lista `OVERRIDE_DENY` no próprio recurso ou `ANCESTOR_VIEW_DENY` (deny individual no `view` de um ancestral); ausência de grant (`DENY_DEFAULT`) não entra.
- As escritas do cadastro (POST `/api/employees`, PUT `/api/employees/:id`, PATCH `/api/employees/:id/status`) e os guards de **lookups / user-link** (`employeeLookupRoutes`) e de **vínculos / pessoa canônica** (`canonicalPersonRoutes`) recebem `requireResourceOrHrEditor`: em `admin.employees:create|update` e nas facetas `admin.employees.*` o editor passa mesmo sem grant próprio da ação. A listagem (`view`) e a exclusão definitiva (SUPER_ADMIN) ficam como estavam. Só a negativa `DENY_DEFAULT` é suprida; deny explícito (chave em `overrideDenied`), recurso desconhecido, ação não suportada e usuário inativo continuam no 403 oficial de `requireResource`.
- **Como a edição chega ao usuário pelo perfil de acesso**: `employees.edit` é a chave de `admin.employees:update`, mas o índice 1:1 do dual-write (`permissionDualWrite/aliasIndex.ts`) a prendia em `admin.employees.dashboard` no eixo *view* — marcar edição em Pessoas/RH na matriz gravava só `employees.create`, e marcar "ver" no Dashboard de Pessoas concedia edição total do RH. Há agora um pin explícito (`CANONICAL_ALIAS_PINS`): `employees.edit` ↔ `admin.employees` no eixo *execute*. Perfis que já têm `employees.edit` no bag continuam com ela ao regravar (a matriz passa a mostrá-la em Pessoas/RH, não no Dashboard).
- No cliente, o botão Editar/Novo segue a mesma regra (`resolveEmployeesEditorClientGate`): com DTO canônico, só `admin.employees:update|create`. Antes, "ver" no Dashboard de Pessoas bastava para o botão aparecer (o DTO legado lista `employees.edit` sob o dashboard) e o salvar tomava 403.
- A máscara de PII e as caps do agregador de vínculos (`canonicalPersonRoutes`, `viewerCapsInput`) também reconhecem o editor — antes só o bag legado contava.
- Quem **não** é editor mantém exatamente o comportamento anterior. Os invariantes puros de `buildPeopleProfileCapabilities` (`src/lib/peopleProfile.test.ts`) não mudaram — a regra vive em como o servidor monta o `EmployeePermissionBag`.

### Backfill `employees.edit` (bags gravados antes do pin)

O runtime já aceita esses bags (create canônico ⇒ editor), mas os dados só ficam coerentes com a tela depois do backfill, que **acrescenta** `employees.edit` a perfis de acesso com `employees.create` e a usuários com `employees.create` no bag ou override Executar/Gerenciar em `admin.employees`. Nunca remove chave; ignora SUPER_ADMIN; não revoga sessões (o servidor lê `AppUser.permissions` a cada requisição, efeito imediato).

```bash
npm run permissions:employees-edit:dry      # só relatório
npm run permissions:employees-edit:apply    # grava (o script exige --confirm)
```

Planner puro e testado em `src/lib/security/employeesEditAliasBackfill.ts`; script em `scripts/backfillEmployeesEditAlias.ts`. Alternativa sem script: reabrir e salvar o perfil / as permissões do usuário no admin (a materialização com o pin grava `employees.edit`).

## Proteção financeira

Sem permissão de valores, os DTOs da ficha **omitam** as chaves `salary`, `previousAmount`, `newAmount`, `differenceAmount`, `amount` financeiro. `GET /api/employees` (listagem) usa o mesmo critério (`canViewCompensationValues`, com deny/canonical) e **apaga** as chaves — não envia `salary: null`. A guia administrativa da ficha não lê R$ da listagem.

As rotas PATCH / DELETE / foto seguem a mesma regra: respondem só `{ id }` / `{ ok: true }` / `{ photoUrl }`.

## Hierarquia

`Employee.managerId` é a fonte. Ciclos (A→A, A→B→A, A→B→C→A) são bloqueados no cadastro existente e nas movimentações da ficha (CTE PostgreSQL para descendentes, sem N+1). Evento de carreira `recordOnly` não atribui gestor, portanto não passa pela checagem de ciclo (só recusa o próprio colaborador como gestor).

## Histórico

Ordenação: `effectiveDate DESC`, `createdAt DESC`, `id DESC`. Página padrão: 50.

Backfill de baseline (não inventa promoção):

```bash
npx tsx scripts/backfill-hr-employee-history.ts --dry-run
npx tsx scripts/backfill-hr-employee-history.ts --apply --confirm-apply=HR_EMPLOYEE_HISTORY_INITIAL_STATE
```

O índice único parcial `(employeeId) WHERE eventType = 'INITIAL_STATE'` torna o script idempotente.

Índice de timeline `(employeeId, effectiveDate DESC, createdAt DESC, id DESC)`: justifica-se pela query paginada real da guia Histórico.

### Vínculo dos registros satélite com o histórico

Verba oficial marcada/desmarcada no cadastro (`recordPayrollComponentHistory`, chamado pelo PUT: `notes` = "<verba> incluído/removido", `metadata.recordType = payrollComponent`), afastamento, entrega de EPI, documento e observação geram um evento no histórico (`BENEFIT_CHANGE`, `VACATION_START` / `LEAVE_START`, `EPI_DELIVERY`, `DOCUMENT_ADDED`, `NOTE_ADDED`). A criação agora grava `metadata: { recordType, recordId }` nesse evento (`recordType` ∈ `PEOPLE_HISTORY_LINKED_RECORD_TYPES`: `benefit`, `absence`, `epiDelivery`, `document`, `note`).

No PATCH (quando muda o que o evento espelha — data de início / entrega, tipo e motivo do afastamento, item de EPI, nome do documento, categoria da observação) e no DELETE, `findLinkedHistoryEvent`:

1. procura pelo `metadata` (`recordType` + `recordId`);
2. sem vínculo, cai no **casamento legado**: colaborador + tipo de evento + data + observação gravados na criação (afastamento também compara o motivo). Documento e observação gravaram o evento com `new Date()` e não guardam essa data, então casam por uma janela de ±2 min em torno do `createdAt` do registro + autor;
3. sincroniza ou exclui **no máximo uma** linha; linha já vinculada a outro registro nunca é reaproveitada; sem linha encontrada segue em silêncio;
4. ao corrigir uma linha legada, grava nela o `metadata` (as próximas correções não dependem mais do casamento exato).

Reajuste continua ligado pelo `historyEventId` do próprio `HrCompensationAdjustment`.

### KPIs do summary

- **Última promoção**: consulta dedicada do `PROMOTION` mais recente (`findFirst` por `effectiveDate DESC, createdAt DESC, id DESC`). Não depende mais da janela de 8 eventos recentes — promoção retroativa ou soterrada por eventos de EPI / documento / observação aparece. `recentMovements` continua com a janela.
- **Último reajuste**: `HrCompensationAdjustment` de vigência mais recente (data, %, tipo — sem valores).
- A guia Carreira filtra os tipos de carreira **no banco**; evento retroativo não some atrás de 100 eventos de outras guias.

## Editar colaborador = ficha

O modal **Editar** (Pessoas / RH › Colaboradores) espelha a ficha. Guias (`EMPLOYEE_FICHA_TABS`, `src/lib/employeeHrUi.ts`): Profissional, Pessoal, Emergência, Carreira, Remuneração, Férias & afastamentos, EPI / Uniformes, Documentos, Referência administrativa, Observações, Vínculos no sistema.

- Campos do **cadastro** (Profissional, Pessoal, contato principal de Emergência, tamanhos de EPI, Referência administrativa, observações do cadastro) continuam no `PUT /api/employees/:id` pelo botão **Salvar alterações**. Colunas novas: estado civil, cidade, UF, CEP (ver [`employee-personal-emergency.md`](./employee-personal-emergency.md)) e jornada descritiva `workSchedule` (máx. 80; mudança gera `WORK_SCHEDULE_CHANGE` pelo diff de snapshot). As cinco só são gravadas quando a chave vem no corpo — cliente antigo não apaga o valor nem gera evento espúrio.
- **Registros** da ficha ficam em `EmployeeEditRecordsPanel` (`src/components/employee/EmployeeEditRecordsPanel.tsx`), montado **fora** do `<form>` do cadastro: Carreira, Remuneração, Férias & afastamentos, Documentos (`EMPLOYEE_FICHA_RECORD_TABS`, guias sem campo de cadastro, só para colaborador já criado) e os registros de Emergência (contatos adicionais), EPI (entregas) e Observações. O painel lê `/api/employees/:id/profile` (capabilities + KPIs) e `/api/employees/:id/<guia>`, reaproveita os componentes de guia da ficha com **Editar / Excluir** por item quando `canManage*`, e mostra o KPI **Última promoção** (Carreira) e **Último reajuste** (Remuneração).
- Esses registros são **gravados na hora**, independentes de "Salvar alterações" — o painel avisa isso. Após cada gravação recarrega guia + summary.
- "Último reajuste" / "Última promoção" de algo que já aconteceu: registrar o reajuste / movimentação marcando **Registro histórico** (`historicalOnly` / `recordOnly`); para corrigir, **Editar** no registro.

## Auditoria

`logEmployeeHrAudit` não grava salário/CPF. `VIEW_COMPENSATION_VALUES` ocorre só no GET de remuneração com valores. Abrir o summary da ficha não gera log financeiro.

Eventos das correções (detalhes só com ids, booleanos e **nomes** dos campos alterados — nunca valores, CPF ou telefone): `employee.compensation.adjustment.update`, `employee.compensation.adjustment.delete`, `employee.history.update`, `employee.history.delete`, `employee.document.update`, `employee.document.delete`, `employee.epi.update`, `employee.epi.delete`, `employee.note.update`, `employee.note.delete`, `employee.photo.change`. Benefício, afastamento e contato de emergência reutilizam o `.change` com `details.action: "update" | "delete"`. Registro histórico usa o evento de criação com `historicalOnly: true` / `recordOnly: true` (o de reajuste omite o percentual).

## Performance

- Summary: um Employee + 8 eventos + 1 promoção (`findFirst`) + 1 reajuste recente.
- Autores de histórico: `findMany` em lote de `AppUser`, não N+1.
- Guias pesadas: lazy no React + fetch sob demanda com cache da abertura atual.
- Race: `AbortController` + `employeeIdRef` ao trocar João → Maria. Cache de guia por `employeeId:tab` na mesma abertura.
- Histórico: keyset `(effectiveDate, createdAt, id)` — não usa cursor Prisma por id global (evita IDOR/skip duplo).

## Status

`Employee.status` continua `String`. Semântica de apresentação: `ACTIVE`, `INACTIVE`, `ON_LEAVE`, `VACATION`, `TERMINATED` (INACTIVE + data de desligamento aparece como Desligado, sem breaking change no valor persistido).

## Changelog

- **2026-09-22** — Guia **Benefícios** do modal removida: duplicava a Referência administrativa, que já traz as verbas do cadastro oficial com valor fixo para todos. A guia "Encargos & benefícios" da ficha passa a listar as verbas marcadas (`EmployeePayrollComponent`, R$ só com valores; % sempre) e os registros do modelo anterior (`HrEmployeeBenefit`, só exclusão). POST/PATCH de benefício e POST do catálogo removidos; `GET /api/hr/benefits` ganha `calculationType`/`percentage`/`amount` e passa a alimentar o modal (sem depender de `settings.operational`). Marcar/desmarcar verba gera `BENEFIT_CHANGE` no histórico; o resumo dos eventos de verba/EPI/documento mostra o nome do item.
- **2026-09-22** — Editor de RH também por `admin.employees:create` canônico (bags de perfil/usuário gravados antes do pin só têm `employees.create`; a matriz mostrava "editar" marcado e o PUT tomava 403); POST/PUT/status do cadastro passam pelo `requireResourceOrHrEditor`; botão Editar/Novo do cliente segue a regra do servidor; PII dos vínculos reconhece o editor; backfill `permissions:employees-edit:*`; falha de rede na ficha/modal mostra mensagem legível com "Tentar novamente" em vez de "Failed to fetch".
- **2026-09-21** — Paridade Editar × ficha: rotas PATCH / DELETE de todos os registros, registro histórico (`historicalOnly` / `recordOnly`), foto (POST / DELETE + content-type real), vínculo histórico por `metadata` com fallback legado, KPI "Última promoção" fora da janela de 8 eventos, regra **Editor de RH** (edita tudo, inclusive R$, salvo deny explícito de valores) e colunas novas do cadastro (estado civil, cidade, UF, CEP, jornada). Histórico passa de "imutável" a append-only com correção administrativa auditada. Sem migration. Também: pin de `employees.edit` em `admin.employees` (perfil de acesso passa a conceder edição de fato); valores de reajuste com teto e percentual fora de `Decimal(10,6)` respondem 400 (o registro automático do "Salvar alterações" grava sem percentual em vez de falhar); jornada descritiva com o mesmo limite (80) no cadastro e na movimentação, sem cortar valor legado intocado; e correção de bug antigo em que registrar promoção pela ficha zerava `Employee.departmentId`.
