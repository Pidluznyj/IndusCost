# Central de Tesouraria — Implementation Status

**Atualizado:** 2026-07-27  
**Programa:** implementação integral da Central de Tesouraria no IndusCost  
**Regra:** cada prompt atualiza este arquivo; não avançar etapas automaticamente.

---

## Legenda

| Status | Significado |
|--------|-------------|
| `NOT_STARTED` | Ainda não iniciado |
| `IN_PROGRESS` | Em andamento |
| `DONE` | Concluído com evidências |
| `BLOCKED` | Bloqueado (detalhar) |
| `N/A` | Não aplicável nesta fase |

---

## Progresso por prompt

| Prompt | Título | Status | Commit | Evidências |
|--------|--------|--------|--------|------------|
| **00a** | Discovery técnico / auditoria do repositório | `DONE` | `cbd77ef` (+ `eb411b3` hash) | `docs/treasury/01-DISCOVERY.md`; checks FE/server imports + startup OK |
| **00b** | Requirements mapping + plano de implementação | `DONE` | `7dbf0b4` — `docs(treasury): mapear requisitos e plano da Central de Tesouraria` | `02-REQUIREMENTS-MAPPING.md`, `03-IMPLEMENTATION-PLAN.md`; anti-duplicação documentada; sem código funcional |
| **00c** | Baseline real + branch `feature/treasury-center` | `DONE` | `2cdc68e` — `chore(treasury): registrar baseline e branch feature/treasury-center` | `04-BASELINE.md`; `validate:treasury-baseline`; WIP Lucro×Caixa stashed; build OK; lint 1236 preexistente; cash-flow 441/441 |
| **01** | Foundation modular (flag, money, routes, scaffold FE) | `DONE` | `af2deff` — `feat(treasury): scaffold modular da Central de Tesouraria` | `src/lib/treasury/**`, `src/components/finance/treasury/**`, `GET /api/finance/treasury/availability`; `test:treasury` 16/16; build OK; sem regras financeiras |
| **02** | Feature flags + permissões Tesouraria | `DONE` | `31800a0` — `feat(treasury): adicionar feature flags e permissões da Central de Tesouraria` | Contrato `finance.treasury*`; bags; flags `treasury.*.enabled`; `requireResource` na availability; `test:treasury` 31/31 |
| **03** | Contratos client-safe (enums/DTOs/schemas) | `DONE` | `56780b5` — `feat(treasury): adicionar contratos client-safe da Central de Tesouraria` | `src/lib/treasury/contracts/**`; money/date/timestamp/pagination/sort; parse tipado (sem Zod); FE importa contratos; `test:treasury` 45/45; `check:frontend-server-imports` OK |
| **04** | Schema Prisma contas + acesso + snapshots | `DONE` | *(este commit)* | `TreasuryFinancialAccount`, `TreasuryFinancialAccountAccess`, `TreasuryBalanceSnapshot`; migration `20260805120000_*`; FKs `AppUser`; `companyCode` (sem model Company); prisma format/validate/generate OK; `test:treasury` 47/47; build OK; **não** aplicada em prod |

> **Nota de ordem:** contratos client-safe foram inseridos como **03**; schema Prisma accounts é **04** no plano (`03-IMPLEMENTATION-PLAN.md`).

---

## Capabilidades do domínio (visão agregada)

| Capabilidade | Status | Notas / reuso |
|--------------|--------|---------------|
| Contas financeiras | `PARTIAL` | Schema `TreasuryFinancialAccount` + access; CRUD API/UI ainda P05 |
| Saldos manuais e históricos | `PARTIAL` | Schema `TreasuryBalanceSnapshot` (idempotência por origem); API ainda P06 |
| Saldo observado / calculado / conciliado | `NOT_STARTED` | — |
| Contas a receber (títulos) | `REUSE` | Model `NomusAccountsReceivable`; APIs `/api/finance/accounts-receivable/*` |
| Contas a pagar (títulos) | `REUSE` | Model `NomusAccountsPayable`; APIs `/api/finance/accounts-payable/*` |
| Previsto vs realizado | `PARTIAL` | Fluxo de Caixa `projected`/`realized`/`combined` — não é caixa bancário |
| Datas esperadas | `NOT_STARTED` | Existe `scheduleDate` Nomus; não substituir `dueDate` |
| Promessas de pagamento | `NOT_STARTED` | — |
| Ações de cobrança | `NOT_STARTED` | — |
| Contestações | `NOT_STARTED` | — |
| Programação de pagamentos | `PARTIAL` | Due Radar / Daily Radar / classificação CC |
| Projeção contratual / provável / confirmada | `PARTIAL` | Cenários cash-flow + portfolio forecast |
| Agenda financeira | `PARTIAL` | Calendário cash-flow |
| Transferências | `NOT_STARTED` | Regra: transferência interna não altera caixa consolidado |
| Lançamentos manuais | `NOT_STARTED` | — |
| Exceções / alertas | `PARTIAL` | Insights CFO derivados; sem exceções de tesouraria |
| Fechamento diário | `NOT_STARTED` | Imutável + versionado (requisito) |
| Reabertura | `NOT_STARTED` | — |
| Importação OFX | `NOT_STARTED` | — |
| Conciliação bancária | `NOT_STARTED` | Distinto de `finance.portfolio_reconciliation` |
| Relatórios tesouraria | `NOT_STARTED` | Reusar padrão export XLSX/CSV |
| Exportações | `PARTIAL` | Exports AR/AP/cash-flow existem |
| Auditoria domínio | `NOT_STARTED` | Padrão: `*AuditLog` por domínio |
| Permissões | `DONE` | Contrato `finance.treasury*` + bags; deny>allow; unknown deny |
| Observabilidade | `PARTIAL` | `/api/health`, logs console, Nomus sync logs |
| Testes domínio | `PARTIAL` | `npm run test:treasury` 47 testes; suíte plena em P28 |
| Contratos DTO/schema | `DONE` | Enums, DTOs, parse tipado, paginação, sort whitelist, money/date/timestamp |
| Documentação | `IN_PROGRESS` | Discovery + mapping + plano (Prompt 00) feitos; runbook ainda não |
| Feature flags | `DONE` | Mestra + 7 subflags fail-closed (`treasury.*.enabled`) |
| Scripts deploy/validação | `NOT_STARTED` | Produção: usuário aplica; Cursor não deploya |

---

## Inventário de reuso (âncoras reais)

### Models Prisma (fonte de títulos)

- `NomusAccountsReceivable`
- `NomusAccountsPayable`
- `NomusSourceSyncRun`
- `IntegrationRun`
- `NomusNfe` / `SalesOrder` / `SalesOrderNfeLink` / `Customer` / `FinancialSupplier`

### Auth / ACL

- Cookie `induscost_session` → `AppSession`
- `requireAppAuth` / `requireResource` (`src/lib/appAuthMiddleware.ts`, `src/lib/security/requireResource.ts`)
- Resource keys finance: `src/lib/financeModulesAccess.ts`

### Datas / money

- `src/lib/financeCivilDate.ts`
- Prisma `Decimal` (`Decimal(20,2)` em AR/AP)
- Evitar padrão atual `decimalToNumber` em cálculos críticos da Tesouraria

### UI

- `src/components/FinanceModule.tsx`
- `src/components/ui/overlay/*`
- `src/components/finance/bi/*`

### Guardrails

- `npm run check:frontend-server-imports`
- `npm run check:server-imports`
- `npm run build:safe`

---

## Prompt 00 — checklist de conclusão

### 00a — Discovery
- [x] Estrutura FE/BE mapeada
- [x] Package manager e scripts mapeados (npm)
- [x] `server.ts` e registro de routers mapeados
- [x] `schema.prisma` auditado (finance spine)
- [x] Models AR/AP / baixas / sync mapeados
- [x] Clientes / fornecedores / pedidos / NFe mapeados
- [x] Permissões e autenticação mapeadas
- [x] Auditoria existente mapeada
- [x] Decimal e datas mapeados
- [x] Componentes UI reutilizáveis mapeados
- [x] Exportações / testes / jobs / health / flags / logs mapeados
- [x] Migrations contadas (128)
- [x] Risco Prisma→FE avaliado + checks OK
- [x] `docs/treasury/01-DISCOVERY.md` criado
- [x] Commit discovery — `cbd77ef`

### 00b — Mapping + plano
- [x] `docs/treasury/02-REQUIREMENTS-MAPPING.md` criado (30 requisitos + anti-duplicação)
- [x] `docs/treasury/03-IMPLEMENTATION-PLAN.md` criado (prompts 01–29 ordenados)
- [x] Validação explícita: Tesouraria não duplica financeiro oficial (títulos Nomus, cash-flow, portfolio)
- [x] Nenhum código funcional alterado neste passo
- [x] Sem avanço automático para Prompt 01

### 00c — Baseline
- [x] Branch `feature/treasury-center` criada
- [x] WIP não relacionado preservado (stashes + backup `%TEMP%`)
- [x] `docs/treasury/04-BASELINE.md` com resultados classificados
- [x] Script `npm run validate:treasury-baseline` + `scripts/runTreasuryBaseline.mjs`
- [x] Falhas preexistentes de `tsc` **não** corrigidas
- [x] Sem avanço automático para Prompt 01

---

## Validação anti-duplicação (Prompt 00b)

| Gate | Resultado |
|------|-----------|
| Títulos CR/CP oficiais permanecem `NomusAccountsReceivable` / `NomusAccountsPayable` | Documentado — overlays laterais apenas |
| Fluxo de Caixa não vira extrato bancário | Documentado — fronteira explícita |
| Portfolio reconciliation ≠ conciliação bancária | Documentado |
| Pedido/NF não entram como caixa | Documentado (ref. `order-nfe-cr-financial-separation.md`) |
| Scaffold Tesouraria não grava/copia títulos Nomus | Confirmado (P01 — só availability) |

---

### 01 — Foundation modular
- [x] `src/lib/treasury/` com routers/controllers/services/repositories/domain/queries/mappers/jobs/contracts
- [x] FE `src/components/finance/treasury/` (placeholder, sem Prisma)
- [x] `registerTreasuryRoutes` no `server.ts` (registro mínimo)
- [x] `GET /api/finance/treasury/availability` (auth + flag fail-closed)
- [x] Money kit string decimal + feature flag
- [x] `npm run test:treasury` 16/16
- [x] `check:frontend-server-imports` OK; `build` OK
- [x] Sem regras financeiras / sem schema Prisma novo
- [x] Sem avanço automático para Prompt 02

### 02 — Flags + permissões
- [x] Flags `treasury.enabled` + subflags (accounts/projection/promises/payablesProgramming/dailyClosing/reconciliation/ofxImport)
- [x] Bags mínimas no `permissionCatalog`
- [x] Recursos `finance.treasury*` no contrato (`resources.ts`)
- [x] `financeModulesAccess` + Leticia deny list + pilot availability
- [x] `requireResource(finance.treasury, view)` na availability
- [x] Testes deny>allow, unknown deny, isolation irmãos; `test:treasury` 31/31
- [x] Sem avanço automático para Prompt 03

### 03 — Contratos client-safe
- [x] Enums de domínio (side, accountType, ledger, promise, projection, closing, etc.)
- [x] DTOs compartilhados (accounts, balances, ledger, transfers, overlays, closing…)
- [x] Schemas de validação (parse tipado IndusCost — projeto sem Zod)
- [x] Paginação + ordenação autorizada (unknown sort denied)
- [x] Filtros de lista/intervalo civil
- [x] Money string decimal; civil YYYY-MM-DD; timestamp ISO com offset
- [x] Códigos de erro + constantes/limites de tamanho
- [x] Helpers sem Prisma; FE importa `contracts/` sem bundle Prisma
- [x] Testes money/dates/enums/pagination/required/limits; `test:treasury` 45/45
- [x] Sem schema Prisma / sem avanço automático para accounts schema

### 04 — Schema Prisma contas + acesso + snapshots
- [x] `TreasuryFinancialAccount` (empresa via `companyCode`, instituição, tipo, moeda, máscaras, consolidado, saldo mínimo, negativo, liquidez, origem padrão, sortOrder, ativo, criação/desativação)
- [x] `TreasuryFinancialAccountAccess` (user ↔ conta, nível, saldo view/mutate)
- [x] `TreasuryBalanceSnapshot` (referenceAt, disponível/bloqueado/aplicações/limite, origem, notes, attachment, user, previousSnapshot, idempotency)
- [x] FKs reais em `AppUser`; sem model Company no IndusCost (`companyCode` operacional)
- [x] Migration aditiva versionada `20260805120000_treasury_financial_accounts_and_balance_snapshots`
- [x] `prisma format` + `validate` (URL dummy) + `generate`
- [x] `test:treasury` 47/47; `check:frontend-server-imports` OK; `build` OK
- [x] Migration **não** aplicada em produção
- [x] Sem avanço automático para CRUD contas

---

## Riscos / pendências abertas

1. Branch `feat/finance-lucro-caixa` coexiste — não misturar commits.
2. Seed DB (`permissions:seed:contract:apply`) ainda a cargo do usuário/ops — contrato tipado já está no código.
3. Migration Tesouraria criada mas **não deployada** — usuário aplica com `migrate deploy`.
4. Deploy produção permanece com o usuário.
5. `TreasuryScaffoldPage` ainda sem wiring em `FinanceModule`/nav (proposital).
6. Alias relacional PT `financeiro.tesouraria` ainda não criado no seed legado (de propósito nesta etapa).
7. IndusCost não tem model `Company` — Tesouraria usa `companyCode`/`companyName` até existir entidade canônica.

---

## Histórico curto

| Data | Evento |
|------|--------|
| 2026-07-27 | Prompt 00a: discovery completo; docs criados; validações de leitura OK |
| 2026-07-27 | Prompt 00b: requirements mapping + implementation plan; sem código funcional |
| 2026-07-27 | Prompt 00c: baseline em `feature/treasury-center`; WIP Lucro×Caixa protegido; build/tests adjacentes OK |
| 2026-07-27 | Prompt 01: scaffold modular + availability endpoint; test:treasury 16/16; build OK |
| 2026-07-27 | Prompt 02: flags + permissões Tesouraria; test:treasury 31/31 |
| 2026-07-27 | Prompt 03: contratos client-safe (enums/DTOs/schemas); test:treasury 45/45; FE sem Prisma |
| 2026-07-27 | Prompt 04: schema Prisma contas/acesso/snapshots + migration aditiva; generate/build OK; sem deploy |
