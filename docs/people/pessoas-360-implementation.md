# Pessoas 360° e Cadastro Único de Pessoas — implementação (branch `feat/people-360-canonical-identity`)

Data: 2026-10-20. Base: `main` em `97e71bc`. Referência conceitual: [auditoria-cadastro-unico-pessoas-induscost.md](auditoria-cadastro-unico-pessoas-induscost.md). Validação: [pessoas-360-validation.md](pessoas-360-validation.md). Implantação: [pessoas-360-deployment-runbook.md](pessoas-360-deployment-runbook.md).

**Veredito:** `Person` passou a governar de fato os vínculos de colaborador, conta, motorista e comissionável, com prévia, transação, estado esperado e auditoria própria (`PersonLinkEvent`), sem alterar ids operacionais, sem apagar registros, sem fundir por nome e sem índice de unicidade novo. As quatro correções de segurança (E1–E4) foram entregues em separado, com auditoria e testes. Nada foi executado em produção: migrations só no PostgreSQL local descartável; sem push, sem deploy.

## 1. Entregas por checkpoint

| CP | Commit | Entrega |
|---|---|---|
| CP2 Segurança | `e356b99` | E2 SUPER_ADMIN só por SUPER_ADMIN elevado; E1 desligamento revoga acesso (flag); E3 sem exclusão física; E4 conta nasce com a Pessoa do colaborador |
| CP3 Governança | `adf90ea` | Prévia sem escrita; `ensurePersonFromSource` sem duplicata; escrita em Person dentro da transação do colaborador; `PersonLinkEvent`; `Person.mergedIntoPersonId` |
| CP4 Pessoas 360° v1 | `8ec96e9` | `/people` (lista) e `/people/:id` (ficha) somente consulta; `GET /api/people`, `/api/people/:id` |
| CP5 Pessoas 360° v1.1 | `2c34782`, `c55a0f6` | Vincular, corrigir, desvincular, unificar e reverter — prévia, estado esperado (CAS), step-up para unificar, eventos |
| CP6 Frota/Comissões | `bdcba11` | Motorista e comissionável resolvem Pessoa por CPF validado; sem fusão por nome; CPF fora dos logs |
| CP7 Qualidade | `c4510a1` + fechamento | Gates (tsc, unidade, integração, build), E2E jornadas 1–5, matriz de 25 cenários, docs; no fechamento: guarda E2 no restore de perfil, mapeamento `people` no contrato/consistência, teste de reversão com dependências novas |

## 2. Modelo de dados (aditivo)

Migration `prisma/migrations/20261027120000_person_link_event/migration.sql` (idempotente, só `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`):

- `Person.mergedIntoPersonId UUID` (FK para `Person`, `ON DELETE SET NULL`) + índice. Pessoa absorvida fica `status = MERGED` apontando para a que ficou. **Nunca é apagada.**
- `PersonLinkEvent`: `personId`, `eventKind` (`PERSON_CREATED | LINKED | UNLINKED | RELINKED | MERGED | MERGE_REVERTED | REVIEW_FLAGGED`), `entityKind` (`employee | app_user | fleet_driver | commission_person | person`), `entityId`, `fromPersonId`, `toPersonId`, `actorUserId`, `actorName` (snapshot, sobrevive à inativação do autor), `reason`, `evidence` (`CPF_EXACT | EMAIL_EXACT | MANUAL | BACKFILL | SYSTEM`), `snapshot JSONB` (sanitizado: sem CPF/e-mail em claro), `reversible`, `revertedAt`, `revertedByEventId`.
- **Nenhum índice de unicidade novo** (CPF, e-mail): condicionado à auditoria em dados reais (`npm run audit:people-identity`, auditoria §10/§23).
- Nada removido: `HrEmployeeDocument.personId` permanece informativo; `FleetDriver.personId`/`CommissionPerson.personId` continuam N:1 `SetNull`.

## 3. Separação Identidade × Vínculo × Conta × Histórico

| Camada | Entidade | O que muda nesta entrega |
|---|---|---|
| Identidade | `Person` | Hub governado: criação sem duplicata por CPF (reutiliza) e recusa por e-mail já usado (409); `MERGED` + `mergedIntoPersonId` |
| Vínculo funcional | `Employee`, `FleetDriver`, `CommissionPerson` | Só o campo `personId` é escrito pelas operações de vínculo; cargo, salário, CNH, regras, aliases, ids Nomus intactos |
| Conta de acesso | `AppUser` | `personId` copiado do colaborador na criação; propagação Employee→AppUser; inativação lógica em vez de exclusão |
| Histórico | `PersonLinkEvent`, `SecurityAuditLog`, `PermissionAuditLog`, `HrEmployeeHistory` | Todo vínculo/correção/unificação gera evento com autor, motivo, evidência e snapshot |

## 4. Segurança (E1–E4)

| Item | Regra implementada | Onde | Auditoria |
|---|---|---|---|
| E2 | Conceder ou retirar SUPER_ADMIN só por SUPER_ADMIN **com step-up** (`ADMIN_ELEVATION_REQUIRED`); ninguém se promove (`CANNOT_PROMOTE_SELF`); vale para `PATCH /api/admin/users/:id`, `PUT /:id/role`, `apply-preset`, `restore-role-default`, `DELETE …/permission-overrides` (restauram o `roleBase` do perfil) e aplicação de perfil em lote | `src/lib/security/superAdminRoleGuard.ts`, `server.ts`, `userPermissionAdminService.ts`, `accessProfilesService.ts` | `PermissionAuditLog`: `SUPER_ADMIN_ROLE_GRANTED/REVOKED/CHANGE_DENIED` |
| E1 | Desligamento efetivo (`status=INACTIVE` + data de desligamento) inativa a conta ligada por `AppUser.employeeId` e revoga sessões; recontratação **não** reativa a conta | `userAccessLifecycle(.server).ts`, `PUT /api/employees/:id` | `SecurityAuditLog`: `USER_DEACTIVATED_BY_TERMINATION` |
| E1 flag | `HR_TERMINATION_REVOKES_ACCESS=1\|true\|yes` — **desligada por padrão** até homologação | `parseTerminationRevokesAccessFlag` | — |
| E3 | `DELETE /api/admin/users/:id` vira inativação lógica + revogação de sessões (`physicallyDeleted: false`); histórico e FKs preservados | `server.ts` | `USER_DELETE_REQUEST_CONVERTED`, `USER_DEACTIVATED` |
| E4 | `POST /api/admin/users` copia `employee.personId`; Pessoa já com conta → 409 `PERSON_ALREADY_HAS_USER`; P2002 → 409; `PUT /api/employees/:id` propaga mudança de Pessoa para a conta dentro da transação | `server.ts`, `canonicalPersonSync.server.ts` | `USER_CREATED` |

## 5. Governança de `Person` (A)

- `previewLinkEmployeeToPerson` é **somente leitura** (`wouldCreatePerson`), recusa Pessoa `MERGED`.
- `ensurePersonFromSource`: CPF válido já existente → reutiliza a Pessoa (evento `LINKED`, evidência `CPF_EXACT`); e-mail já usado por outra Pessoa → 409; criação passa por `createPersonCore` (checagens de duplicidade) e grava `PERSON_CREATED`.
- `planEmployeePersonLink` + `applyEmployeePersonLinkPlan`: o plano é calculado antes das validações do colaborador e aplicado **dentro** da `$transaction` do `POST/PUT /api/employees` — um 400/409 posterior não deixa Pessoa órfã nem alterada.
- Erros de domínio (`CanonicalPersonError`) mapeados para 404/409 com código; P2002 → 409.

## 6. Pessoas 360° (B e C)

Rotas (`src/lib/people/peopleRoutes.ts`), todas atrás de `employees:view` no recurso `admin.employees`; escrita atrás de `admin.employees.links:manage`; unificar/reverter exigem SUPER_ADMIN elevado:

| Método | Rota | Permissão | Efeito |
|---|---|---|---|
| GET | `/api/people` | view | Lista paginada no banco; filtros `q`, `status`, `has`, `missing`, `pending=orphan\|duplicate\|mismatch` |
| GET | `/api/people/:id` | view | Ficha: cabeçalho mascarado (CPF/e-mail completos só com PII), estados por papel, cartões (RBAC do módulo de origem no servidor), pendências, eventos, capacidades |
| GET | `/api/people/:id/pending-links` | view | Pendências (conta do colaborador noutra Pessoa, CPF igual em colaborador/motorista/comissionável/outra Pessoa, e-mail igual só sugestão) |
| POST | `/api/people/:id/links/preview` | links:manage | Prévia somente leitura: origem, destino, evidência, decisão (bloqueios de cardinalidade), `expectedCurrentPersonId` |
| POST | `/api/people/:id/links` | links:manage | Vincular/corrigir com comparação-e-troca (`updateMany where {id, personId: esperado}` → `STALE` 409), evento `LINKED/RELINKED` |
| DELETE | `/api/people/:id/links/:kind/:entityId` | links:manage | Desvincular (só `personId = null`), evento `UNLINKED` |
| POST | `/api/people/:id/merge/preview` | links:manage + SUPER_ADMIN elevado | Prévia: vencedora, absorvida, movimentos, campos vazios preenchidos, bloqueios (`CPF_DIVERGENT`, `TWO_EMPLOYEES`, `TWO_ACTIVE_USERS`, …) |
| POST | `/api/people/:id/merge` | idem | Religa vínculos, preenche só campos vazios da vencedora, absorvida → `MERGED`; dois eventos `MERGED` (um por lado), reversível |
| POST | `/api/people/:id/merge/revert` | idem | Restaura vínculos e a absorvida; bloqueado se houve vínculos novos depois (`NEWER_DEPENDENCIES`) |

Interface (`src/components/people/*`): lista com busca/filtros/paginação; ficha com cabeçalho, cartões Funcionário/Usuário/Motorista/Comissionável/Documentos/Histórico (estados Vinculado/Não vinculado/Inativo/Pendente/Conflito), diálogos `RelinkDialog`, `UnlinkDialog`, `MergeDialog`, `RevertMergeDialog` (prévia → justificativa obrigatória → confirmação; unificar e reverter passam pelo `AdminStepUpDialog`). Navegação: item "Pessoas 360°" no grupo Gestão de pessoas (`modulePermissions.ts`, `navigationGroups.ts`, contrato de permissões `admin.employees.people`).

## 7. Frota e Comissões (D)

`src/lib/people/personIdentityResolve.server.ts`:

- `resolvePersonByCpf`: CPF com dígitos verificadores válidos → Pessoas não `MERGED` com aquele CPF; **exatamente uma** → vincula; zero → sem vínculo (nunca cria Pessoa); duas ou mais → `ambiguous`, nada é escolhido.
- `suggestPersonsForIdentity`: candidatas por CPF (forte) e por e-mail (só sugestão), mascaradas.
- `assertPersonLinkable`: Pessoa inexistente 404; `MERGED` 409.
- `planOperationalPersonLink`: nunca sobrescreve `personId` existente; CPF novo divergente da Pessoa vinculada → 409 `PERSON_CPF_MISMATCH` (a correção é feita em Pessoas 360°).

Frota: `parseDriverInput` e o CSV exigem checksum de CPF; `POST/PUT /api/fleet/drivers`, importação CSV e cadastro público QR gravam `personId` resolvido; `FleetAuditLog.newValue` passa a receber CPF **mascarado**. Comissões: `personId` opcional na API (`parseCommissionPerson*Body`), no serviço (`createCommissionPerson`/`updateCommissionPerson`: explícito validado ou resolvido pelo documento) e no formulário (campo "Pessoa (identidade canônica)" com sugestões e link para a ficha); `GET /api/commissions/persons/person-suggestions`; `dedupe-commission-persons` agrupa **só por `nomusPersonId`** (`groupCommissionPersonsByIdentity(..., { nameKeys: false })`); nome continua servindo apenas para resolução de leitura. Importação do Nomus não recebe documento/e-mail, logo não vincula — fica como sugestão manual.

## 8. Documentos e histórico (E)

Documentos continuam por colaborador (`HrEmployeeDocument.employeeId`, `Restrict`); a ficha mostra só a contagem e remete à ficha do RH com a permissão de documentos. Unificação e desvínculo não tocam documentos, avaliações, EPIs, treinamentos, comissões, lotes, aliases, auditorias já gravadas nem ids Nomus (ver `planPersonMerge.unchanged` e o teste de invariância de comissões).

## 9. Concorrência

- Vínculo/correção: comparação-e-troca por `updateMany` com o `personId` esperado (lido na prévia) — a segunda operação concorrente recebe `STALE` 409, nunca sobrescreve.
- Unicidade do banco (`Employee.personId`, `AppUser.personId`): P2002 → `UNIQUE_CONFLICT` 409.
- Unificação/reversão em `$transaction` única; reversão recusada se a vencedora recebeu vínculos novos (`NEWER_DEPENDENCIES`).

## 10. O que NÃO foi feito (de propósito)

- Nenhum índice de unicidade novo; nenhuma unificação automática; nenhum saneamento em dados reais; nenhuma migration fora do PG local; sem push/deploy.
- `HrEmployeeDocument.personId` mantido como está (decisão pendente na auditoria §26).
- Importação de comissionáveis do Nomus não vincula Pessoa (não há documento na origem).
- E1 permanece atrás de flag até homologação com RH.

## 11. Missão 2 — Pessoas 360° como cadastro mestre (branch `feat/people-360-master-identity`, base `69ebd2d`)

**Veredito:** a Pessoa passou a ser criada, consultada, editada e governada na própria ficha, e dela nascem (ou a ela se ligam) a conta IndusCost e o motorista; as sete contas legadas sem Pessoa têm caminho de regularização pela interface, com prévia, justificativa e auditoria. Comissões/Nomus não mudaram. Nenhuma migration nova. Procedimento de homologação em [pessoas-360-homologacao-cadastro-mestre.md](pessoas-360-homologacao-cadastro-mestre.md); validação em [pessoas-360-validation.md](pessoas-360-validation.md) §6.

### 11.1 Propriedade de campo (regra implementada)

| Campo | Dono | Cópias | Comportamento |
|---|---|---|---|
| nome, nome social, CPF, e-mails, telefone | `Person` | `Employee` (RH), `AppUser.name/email` (login), `FleetDriver.name/cpf/phone/email`, `CommissionPerson.name/document` | Editar a Pessoa grava `IDENTITY_UPDATED` (diff mascarado) e **não reescreve** nenhuma cópia; o formulário do colaborador continua sincronizando a Pessoa com prévia de conflitos (`FIELD_CONFLICTS`), e colaborador já vinculado sem `personId` no corpo vira LINK para a Pessoa atual em vez de sobrescrita crua (`planPersonLinkFromEmployeeBody`) |
| cargo, remuneração, gestor, jornada, documentos, EPI, avaliações | `Employee` | — | intocados |
| login, senha, sessões, papel, perfil, permissões, vínculo Nomus | `AppUser` | — | nenhuma rota de Pessoa altera; criação de conta usa `resolveNewUserInitialAccess()` |
| CNH, status, unidade, centro de custo, histórico | `FleetDriver` | — | "Habilitar motorista" só preenche campos da Frota; vincular/reativar escreve só `personId`/`status` |
| vendedor Nomus, aliases, regras, registros, lotes | `CommissionPerson`/Nomus | — | intocados (teste de invariância) |

### 11.2 Rotas novas (`src/lib/people/peopleRoutes.ts`)

| Método | Rota | Guarda | Serviço |
|---|---|---|---|
| POST | `/api/people` | `admin.employees.people:update` (chave ampla `employees.edit`) | `createPersonManual` → `createPersonCore` (409 `DUPLICATE_CPF`/`DUPLICATE_PRIMARY_EMAIL`, 400 `INVALID_CPF` com checksum) + `PERSON_CREATED` |
| GET | `/api/people/:id/identity` | `admin.employees:view` | dados para edição (PII em claro só com `canViewPii`) |
| PATCH | `/api/people/:id` | `admin.employees.people:update` | `updatePersonIdentity` (MERGED → 409 `PERSON_MERGED`) + `IDENTITY_UPDATED` |
| POST | `/api/people/:id/status` | `admin.employees.people:manage` (`employees.edit` ou `users.manage`) | `setPersonStatus`: INACTIVE só sem vínculos ativos (409 `PERSON_HAS_ACTIVE_LINKS`); `PERSON_INACTIVATED`/`PERSON_REACTIVATED` com motivo; CAS na situação |
| POST | `/api/people/:id/access` | `admin.settings.security:manage` (a mesma de Usuários) | `createAppUserAccount` (origem `person`): Pessoa ACTIVE e sem conta; com colaborador ativo sem conta → `employeeId`; sem colaborador → conta só com `personId`; VIEWER, sem permissões/perfil/vendedor, senha temporária; `USER_CREATED` + `LINKED` |
| GET | `/api/people/:id/access/candidates` | `links:manage` + `user_link:manage` | contas sem Pessoa (ou ligadas ao colaborador desta Pessoa), e-mail mascarado sem PII, evidência `EMPLOYEE_LINK`/`EMAIL_EXACT`/`MANUAL` |
| POST | `/api/people/:id/access/attach/preview` | idem | `previewAttachAccount` (somente leitura; SUPER_ADMIN vê o plano antes do step-up) |
| POST | `/api/people/:id/access/attach` | idem; conta SUPER_ADMIN exige SUPER_ADMIN elevado | `attachAccountToPerson`: CAS único em `{personId, employeeId}`; `employeeId` só quando a conta não tinha; `Employee.personId` preenchido quando nulo; `USER_IDENTITY_LINKED` + `LINKED/RELINKED`; e-mail divergente exige `confirmEmailMismatch` |
| GET | `/api/people/:id/driver/preview` | cadeia da Frota (`operations.fleet:view`) | `previewDriverEnable`: CREATE/LINK/REACTIVATE/ALREADY_ENABLED/CONFLICT/BLOCKED |
| POST | `/api/people/:id/driver` | cadeia da Frota (`driversManage`) | `enableDriverForPerson` em transação; um motorista não-INACTIVE por Pessoa; `FleetAuditLog` com CPF mascarado + `LINKED` |

`POST /api/admin/users` passou a delegar ao mesmo serviço (`src/lib/adminUserCreation.server.ts`, origem `employee`), com os mesmos códigos de erro e a mesma auditoria.

### 11.3 Invariantes garantidas em código

- Conta nova sempre nasce com `personId` quando a Pessoa existe (origem `person`) ou com a Pessoa do colaborador (origem `employee`); nunca cria Pessoa.
- `AppUser.personId`/`employeeId` e `Employee.personId` únicos no banco; P2002 → 409 com código (`PERSON_ALREADY_HAS_USER`, `EMPLOYEE_ALREADY_LINKED`, `UNIQUE_CONFLICT`).
- Pessoa `MERGED` nunca recebe vínculo (`TARGET_MERGED`, `PERSON_MERGED`); Pessoa `INACTIVE` também não (`TARGET_INACTIVE`) — reativação é explícita e auditada.
- Operações sobre contas SUPER_ADMIN (vincular, corrigir, desvincular, regularizar) exigem SUPER_ADMIN com step-up (`evaluateSuperAdminAccountOperation`), além de `links:manage`.
- Comparação-e-troca em todas as escritas de vínculo e na situação da Pessoa; confirmações repetidas viram `SAME`/`STALE`, não eventos duplicados.
- Inativar Pessoa não desliga colaborador nem revoga conta: é recusado enquanto houver vínculo ativo (regras separadas e explícitas).
- E1–E4 e a flag `HR_TERMINATION_REVOKES_ACCESS` intocados; `linkEmployeeToAppUser` (RH) ganhou recusa de Pessoa inativa, P2002 → 409 e `PersonLinkEvent`.

### 11.4 Auditoria e diagnóstico

`scripts/auditPeopleIdentity.ts` ganhou `USUARIO_COLABORADOR_PESSOA_INATIVA` (caso Eduardo), `USUARIO_EMAIL_DIVERGE_DO_COLABORADOR` (caso Leticia) e `--only=CATEGORIA[,…]`. Eventos novos em `PersonLinkEvent`: `IDENTITY_UPDATED`, `PERSON_INACTIVATED`, `PERSON_REACTIVATED`; em `SecurityAuditLog`: `USER_IDENTITY_LINKED`.

### 11.5 Limitações conhecidas

- Conta criada a partir de Pessoa sem colaborador fica fora do E1 (desligamento não a revoga) e da propagação de Pessoa: revisão periódica pela lista `has=app_user&missing=employee`.
- Importação de comissionáveis do Nomus continua sem vínculo automático (não há documento na origem).
- Sem acesso ao servidor de homologação a partir desta máquina: o procedimento foi escrito e os casos reproduzidos localmente, não executados em `teste_bi_homolog`.
