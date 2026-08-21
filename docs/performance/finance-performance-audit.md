# Finance Performance Audit

Auditoria de performance e consolidação canônica de valores da superfície **Financeiro**.

Ambiente da auditoria: **somente repositório Git + build local**. Sem acesso a servidor,
homologação, produção, PostgreSQL real, Nomus, AWS, Nginx, Cloudflare ou Tailscale.
Toda métrica dependente de runtime real está marcada `SERVER_VALIDATION_PENDING`.

## Scope

Raiz: `src/components/FinanceModule.tsx`, rota `/finance/*` registrada em `src/App.tsx`.

Inclui as 8 seções canônicas de `FINANCE_UI_SECTIONS`
(`src/lib/internalSurfaceAccess.ts`), suas sub-abas, dialogs, drawers, gráficos,
exportações, clients HTTP, rotas Express e serviços/motores de domínio consumidos.

Fora de escopo: Tesouraria (`/treasury/*`, módulo próprio), Comissões e
Invested Capital Recovery — tocados apenas como consumidores de motores compartilhados
quando a dependência é real.

## Architecture

`FinanceModule` não é um container de abas com estado: é um **roteador**
(`react-router` `<Routes>`), e cada seção é uma rota filha.

Consequência estrutural relevante:

- Apenas a rota casada renderiza → **não há mount de aba inativa** e portanto
  **não há fetch de aba escondida** (item 20/46 da missão já satisfeito pela arquitetura).
- Porém `FinanceModule.tsx` faz **import estático** das 8 páginas de seção
  (linhas 5–14), e `App.tsx` importa `FinanceModule` estaticamente (linha 17).
  Logo, todo o código das 8 seções entra no **chunk inicial** (`main-*.js`).

Permissões: `useAuthorizedTabs` + `FINANCE_SECTION_FE_RESOURCE_KEYS`; seção sem grant
renderiza `UnauthorizedAccessGate forceDenied` e **não** monta a página → sem request.

## Tabs Inventory

| # | TAB ID | LABEL | COMPONENT | RESOURCE KEY (permissão) |
|---|---|---|---|---|
| 1 | `cash-flow` | Fluxo de Caixa | `src/components/finance/FinanceCashFlowPage.tsx` | `FINANCE_SECTION_FE_RESOURCE_KEYS["cash-flow"]` |
| 2 | `accounts-receivable` | Contas a Receber | `src/components/finance/FinanceAccountsReceivablePage.tsx` | `…["accounts-receivable"]` |
| 3 | `accounts-payable` | Contas a Pagar | `src/components/finance/FinanceAccountsPayablePage.tsx` | `…["accounts-payable"]` |
| 4 | `billing` | Faturamento | `src/components/finance/FinanceBillingPage.tsx` | `…billing` |
| 5 | `sales-orders` | Pedidos de Venda | `src/components/finance/FinanceSalesOrdersPage.tsx` | `…["sales-orders"]` |
| 6 | `cost-centers` | Centros de Custo | `src/components/finance/cost-centers/FinanceCostCentersPage.tsx` | `…["cost-centers"]` |
| 7 | `executive-report` | Relatório Presidencial | `src/components/finance/FinanceExecutiveReportPage.tsx` | `…["executive-report"]` |
| 8 | `dre` | DRE Gerencial | `src/components/finance/FinanceManagerialDrePage.tsx` | `…dre` |

Rotas adicionais dentro do módulo:

- `cost-centers/:costCenterId` → `FinanceCostCenterDetailPage` (gated por `cost-centers`)
- `dre/parametrizacao` → `FinanceDreCostCenterMappingPage` (gated por `dre`)
- `*` → `FinanceCanonicalRedirect`

LOAD BEFORE (todas): **eager no bundle inicial** (import estático), lazy no *mount*
(roteamento). Nenhuma seção monta sem estar na URL.

## Baseline

Medida no worktree `perf/finance-screen-and-tabs`, a partir de `origin/main`.

| Métrica | Valor BEFORE |
|---|---|
| INITIAL ORIGIN/MAIN | `1147600c68e0be393580e3ea2035973bfa5d0e2a` |
| `dist/assets/main-*.js` | **8.124,03 kB** (gzip **1.917,27 kB**) |
| `dist/assets/main-*.css` | 432,39 kB (gzip 58,60 kB) |
| `dist/assets/client-*.js` | 194,97 kB (gzip 60,99 kB) |
| Chunks separados existentes | `SalesOrderManagementFulfillmentPanel` (7,05 kB), `satisfaction` (11,16 kB) |
| Build | PASS — `✓ built in 1m41s` |
| Typecheck (`tsc --noEmit`) | **1370 erros pré-existentes** (baseline histórica; `src/` = 1204) |
| Finance sections no chunk inicial | **8 de 8** |
| Mount de aba inativa | **0** (arquitetura de rotas) |
| Fetch de aba escondida | **0** |
| Fetch de aba sem permissão | **0** (gate antes do mount) |

Métricas não mensuráveis neste ambiente: `SERVER_VALIDATION_PENDING`
(latência HTTP real, tempo de query, EXPLAIN ANALYZE, payload de produção,
volume real de linhas, eficácia de índice).

## Canonical Value Matrix

Preenchida na fase de discovery — ver seção `Divergences Found`.

## Sources of Truth

Motores canônicos identificados no domínio financeiro (leitura de código e doc-comments):

- `src/lib/finance/financeArEffectiveTitlesSource.ts` (+ `.server.ts`) — fonte efetiva de títulos de CR
- `src/lib/finance/financeAccountsReceivableEffectiveTitles.server.ts`
- `src/lib/finance/financeCashFlowCanonicalRealized.server.ts` — realizado canônico
- `src/lib/finance/financeCashFlowEffectiveAr.ts`
- `src/lib/finance/salesOrderEffectiveFinancialSchedule.ts` — cronograma financeiro efetivo do PV
- `src/lib/finance/orderReceivablesResolver.ts`
- `src/lib/financeOfficialArApMetricsProjection.*` / `financeOfficialEngineProjection.*`
- `src/lib/financeCrossModuleReconciliation.ts`

Suítes de consistência já existentes (auditoria cross-consumer pré-existente):
`financeDashboardConsistencyAudit.test.ts`, `financeCashFlowArApReconciliation.test.ts`,
`financeAccountsReceivableCalculationAudit.test.ts`,
`financeAccountsPayableCalculationAudit.test.ts`,
`finance/effectiveScheduleConsumers.test.ts`,
`finance/financeArTitlesSourceValidation.test.ts`.

## Financial Contracts

Preenchido após discovery.

## Divergences Found

Preenchido após discovery.

## Frontend Findings

Preenchido após discovery.

## API Findings

Preenchido após discovery.

## Query Structural Findings

Preenchido após discovery.

## Bundle Findings

Preenchido após discovery.

## Performance Prioritization

Preenchido após discovery.

## Changes Implemented

Preenchido ao final.

## Canonical Consolidations

Preenchido ao final.

## Changes Rejected

Preenchido ao final.

## Deferred High Risk

Preenchido ao final.

## Business Decisions Required

Preenchido ao final.

## Before vs After

Preenchido ao final.

## Regression Safety

Preenchido ao final.

## Server Validation Pending

Preenchido ao final.

## Remaining Bottlenecks

Preenchido ao final.

## Recommended Next Phase

Preenchido ao final.
