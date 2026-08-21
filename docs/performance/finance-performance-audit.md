# Finance Performance Audit

Auditoria de performance e consolidação canônica de valores da superfície **Financeiro**.

Ambiente da auditoria: **somente repositório Git + build local**. Sem acesso a servidor,
homologação, produção, PostgreSQL real, Nomus, AWS, Nginx, Cloudflare ou Tailscale.
Toda métrica dependente de runtime real está marcada `SERVER_VALIDATION_PENDING`.

## Scope

Raiz: `src/components/FinanceModule.tsx`, rota `/finance/*` registrada em `src/App.tsx`.

Inclui as 8 seções canônicas de `FINANCE_UI_SECTIONS` (`src/lib/internalSurfaceAccess.ts`),
suas sub-abas, dialogs, drawers, gráficos, exportações, clients HTTP, rotas Express e
serviços/motores de domínio consumidos.

Tocados apenas como leitura/consumidores de motores compartilhados: Tesouraria
(`/finance/treasury/*`, módulo próprio), Fornecedores, Conciliação de Carteira,
Recuperação de Capital Investido, Comissões.

## Architecture

`FinanceModule` **não** é um container de abas com estado: é um **roteador**
(`react-router` `<Routes>`), e cada seção é uma rota filha.

Consequências estruturais, verificadas no código:

- Apenas a rota casada renderiza → **não existe mount de aba inativa** e portanto
  **não existe fetch de aba escondida**.
- Permissão é resolvida **antes** do mount (`useAuthorizedTabs` + `UnauthorizedAccessGate
  forceDenied`) → seção sem grant não monta e **não dispara request**.
- O problema real da abertura da tela nunca foi *fetch*: era **download**.
  `App.tsx` importava `FinanceModule` estaticamente e `FinanceModule` importava as 8
  páginas estaticamente, colocando toda a superfície Financeiro no chunk inicial.

## Tabs Inventory

| # | TAB ID | LABEL | COMPONENT | PERMISSÃO | LOAD BEFORE | LOAD AFTER |
|---|---|---|---|---|---|---|
| 1 | `cash-flow` | Fluxo de Caixa | `finance/FinanceCashFlowPage.tsx` | `…["cash-flow"]` | chunk inicial | chunk próprio 91,99 kB |
| 2 | `accounts-receivable` | Contas a Receber | `finance/FinanceAccountsReceivablePage.tsx` | `…["accounts-receivable"]` | chunk inicial | chunk próprio 92,81 kB |
| 3 | `accounts-payable` | Contas a Pagar | `finance/FinanceAccountsPayablePage.tsx` | `…["accounts-payable"]` | chunk inicial | chunk próprio 83,99 kB |
| 4 | `billing` | Faturamento | `finance/FinanceBillingPage.tsx` | `…billing` | chunk inicial | chunk próprio 60,00 kB |
| 5 | `sales-orders` | Pedidos de Venda | `finance/FinanceSalesOrdersPage.tsx` | `…["sales-orders"]` | chunk inicial | chunk próprio 22,02 kB |
| 6 | `cost-centers` | Centros de Custo | `finance/cost-centers/FinanceCostCentersPage.tsx` | `…["cost-centers"]` | chunk inicial | chunk próprio 156,51 kB |
| 7 | `executive-report` | Relatório Presidencial | `finance/FinanceExecutiveReportPage.tsx` | `…["executive-report"]` | chunk inicial | chunk próprio 204,80 kB |
| 8 | `dre` | DRE Gerencial | `finance/FinanceManagerialDrePage.tsx` | `…dre` | chunk inicial | chunk próprio 76,71 kB |

Rotas aninhadas do mesmo módulo:

| Rota | Componente | Permissão | LOAD AFTER |
|---|---|---|---|
| `cost-centers/:costCenterId` | `FinanceCostCenterDetailPage` | `cost-centers` | chunk próprio 14,96 kB |
| `dre/parametrizacao` | `FinanceDreCostCenterMappingPage` | `dre` | chunk próprio 4,53 kB |
| `*` | `FinanceCanonicalRedirect` | — | inline |

Endpoint principal por seção (um dashboard por filtro aplicado, com abort):

| Seção | Endpoint principal | Endpoints secundários |
|---|---|---|
| Fluxo de Caixa | `GET /api/finance/cash-flow/dashboard` | `/annual-comparison`, `/daily-radar` (+ cost-centers, titles, export), `/audit`, `/export` |
| Contas a Receber | `GET /api/finance/accounts-receivable/dashboard` | `/titles`, `/overdue`, `/due-radar`, `/horizon/bucket-customers`, exports |
| Contas a Pagar | `GET /api/finance/accounts-payable/dashboard` | `/titles`, `/due-radar`, `/unclassified`, `/classification-summary`, exports |
| Faturamento | `GET /api/finance/billing/dashboard` | `/comparison`, `/audit`, `/nfes`, `/horizon/orders`, `/sync-status` |
| Pedidos de Venda | `GET /api/finance/sales-orders/dashboard` | `/export` |
| Centros de Custo | `GET /api/finance/cost-centers/dashboard` | `/cost-centers`, `/monthly-chart`, `/cost-center-audit`, regras, não classificados |
| Relatório Presidencial | `GET /api/finance/executive-report` | `/executive-report/cash-radar`, `/api/branding-settings` |
| DRE Gerencial | `GET /api/finance/dre` | `/dre/cash-bridge`, `/dre/lines/:id/drilldown`, `/dre/cost-center-mappings` |

Sub-abas mapeadas (todas com render condicional, sem mount de aba inativa):
CR — `overview` / `titles-analytical` × `overdue`, `customers`, `aging`, `audit`, `schedule`,
`payment-methods`, `companies`. CP — `overview` / `titles-analytical` × `titles`, `suppliers`,
`aging`, `audit` + `schedule`, `payment-methods`, `companies`. Faturamento — `overview`,
`accumulated`, `monthly`, `projection`, `forecast`. Centros de Custo — `overview`, `centers`,
`suppliers`, `rules`, `unclassified`, `audit`. DRE — `dre`, `cash-bridge`.

## Canonical Value Matrix

| VALUE | SEMANTIC | CANONICAL ENGINE | CONSUMERS | CONSISTENT? | ACTION |
|---|---|---|---|---|---|
| Títulos efetivos CR | Lista deduplicada de CR após FIN-08/FIN-05 | `finance/financeArEffectiveTitlesSource.ts` → `financeArEffectivePortfolio.ts` | Títulos CR, Fluxo de Caixa, radar diário, comparativo anual, Presidencial | Sim | Preservar |
| Total a receber / em aberto / vencido / a vencer | Métricas gerenciais CR | `financeAccountsReceivableRulesEngine.ts` via `buildOfficialAccountsReceivableDashboard` | Dashboard CR, Fluxo de Caixa, Presidencial, reconciliação cross-module | Sim | Preservar |
| Recebido | CR baixado por data de liquidação | `sumFinanceArReceivedBySettlementInPeriod` | Dashboard CR, Fluxo de Caixa realizado, Presidencial | Sim | Preservar |
| Total a pagar / AP aberta / vencida | Métricas gerenciais CP por `dueDate` | `financeAccountsPayableRulesEngine.ts` via `buildOfficialAccountsPayableDashboard` | Dashboard CP, Fluxo de Caixa, Centros de Custo, Presidencial | Sim | Preservar |
| Pago | CP liquidada alocada no vencimento | `sumOfficialApPaidInPaymentPeriod` + `normalizeAccountsPayableTitle` | Dashboard CP, Fluxo de Caixa, DRE ponte caixa | Sim | Preservar |
| Previsão / cobertura do Pedido | Previsão residual após CR e Documento de Saída | `finance/salesOrderPlannedReceivables.ts` + `salesOrderEffectiveFinancialSchedule.ts` (FIN-05) | Pedidos de Venda, Fluxo de Caixa, Conciliação, Recuperação de Capital | Sim | Preservar |
| Realizado canônico do Fluxo de Caixa | Entradas/saídas realizadas do ano | `finance/financeCashFlowCanonicalRealized.server.ts` | Fluxo de Caixa, Presidencial | Sim | Preservar |
| Faixas de aging / dias em atraso | Buckets `upcoming`, `dueToday`, 1–7, 8–15, 16–30, 31–60, 61–90, 91+ | `financeDashboardAgingBuckets.ts` (`assignFinanceDashboardAgingBucketKey`) | Dashboard CR, Dashboard CP, motores de regras, horizonte, radar | Sim — todos delegam | Preservar |
| Horizonte a vencer | Buckets futuros `0_7` … `46_60`, `overdue`, `total_60` | `financeHorizonBuckets.ts` | CR, CP, Faturamento | Sim | Preservar |
| Status do título | `suspended` / `settled` / `overdue` / `dueToday` / `upcoming` | `classifyFinanceArTitle`, `classifyFinanceApTitle` | Todas as grades e cards CR/CP | Sim | Preservar |
| Precisão monetária | `Decimal.toNumber()` + `roundMoney` (2 casas); FIN-05 em `Prisma.Decimal` `ROUND_HALF_UP`, tolerância 0,01 | `financeAccountsReceivableDashboard.ts`, `financeAccountsPayableRules.ts`, `salesOrderEffectiveFinancialSchedule.ts` | Toda a superfície | Sim | Preservar |

Nenhuma grandeza foi recalculada, reagrupada, rearredondada ou reancorada nesta missão.

## Sources of Truth

| Motor | Grandeza | Evidência de canonicidade |
|---|---|---|
| `financeAccountsReceivableRulesEngine.ts` | métricas CR | doc-comment: *"Motor oficial de regras de Contas a Receber — fonte única server-side para métricas AR"* |
| `financeAccountsPayableRulesEngine.ts` | métricas CP | doc-comment: *"Motor oficial de regras de Contas a Pagar"*; *"pago alocado por vencimento (dueDate)"* |
| `finance/financeArEffectiveTitlesSource.ts` | títulos efetivos CR | doc-comment: *"Fonte canônica de títulos efetivos AR"* (motor FIN-08) |
| `finance/financeArEffectivePortfolio.ts` | dedup pré-NF / NF→Pedido | motor compartilhado Títulos + Fluxo de Caixa |
| `finance/salesOrderEffectiveFinancialSchedule.ts` | cronograma efetivo do Pedido | *"FIN-05 — Motor único… Precedência: CR real > condição comprovada do Documento > previsão residual do Pedido"* |
| `finance/salesOrderPlannedReceivables.ts` | previsão e cobertura | *"cobertura por valor, sem dupla contagem: CR real ≥ Documento de Saída válido ≥ previsão do Pedido"* |
| `financeAccountsPayableRules.ts` | normalização CP | *"Regras saneadas… fonte única para AP e Fluxo de Caixa"* |
| `finance/financeCashFlowCanonicalRealized.server.ts` | realizado do Fluxo de Caixa | amarrado a `sumOfficialArReceivedBySettlementInPeriod` / `sumOfficialApPaidInPaymentPeriod` |
| `financeDashboardAgingBuckets.ts` | faixas de aging | único definidor; CR e CP delegam |

## Financial Contracts

| Contrato | Situação | Evidência |
|---|---|---|
| CR REAL PRECEDENCE | **PASS** | `salesOrderPlannedReceivables.ts` (CR real ≥ DS ≥ previsão); `suppressPreNfReplacedByRealCrOnSameOrder` |
| FORECAST REPLACEMENT | **PASS** | `replacedByRealCr` / `replacedBySource` (`REAL_RECEIVABLE`, `OUTPUT_DOCUMENT`, `VALUE_COVERAGE`); teste *"CR em 2 parcelas substitui previsão… sem duplicar"* |
| PV/NF/DS/CR DOUBLE COUNT PROTECTION | **PASS** | `deduplicateFinanceArRows`, `suppressObsoleteOpenPreNfNomusArRows`, `dedupOrderAuditReceivables`; `financeCashFlowReconciliationMap.test.ts` assere `duplicateIds.length === 0`; `effectiveScheduleMatrix.integration.test.ts` |
| PARTIAL RECEIPTS | **PASS** | `isFinanceArOpen` = `balanceReceivable > 0`; parcial permanece aberto e classificado por `dueDate` |
| PARTIAL PAYMENTS | **PASS** | `normalizeAccountsPayableTitle`: parcial → `realizedAmount = amountPaid`, `openAmount = balancePayable` |
| AP DATE AXIS | **PASS** | `financeAccountsPayableAccess.ts`: *"Eixo oficial Contas a Pagar: Data de Vencimento (NomusAccountsPayable.dueDate)"*; `financeAccountsPayableRules.ts`: *"Fluxo de Caixa AP: agrupamento sempre por data de vencimento"*; teste *"eixo oficial AP por dueDate preservado"* |
| CANCELED | **PASS** | `isFinanceApCancelledTitle` → `effectiveStatus: CANCELLED`, fora de aberto e liquidado; CR via `isFinanceArAllowedInManagementReport` |
| NULL | **PASS** | meses futuros do Faturamento exibem `null`, não zero — texto no próprio cabeçalho da tela e testes de formato |
| ZERO | **PASS** | zero legítimo preservado (`amountReceived` zerado em título liquidado não vira recebido) |
| MONEY PRECISION | **PASS** | não houve introdução de `parseFloat`, `toFixed` como regra, nem arredondamento intermediário novo |

## Baseline

Worktree `perf/finance-screen-and-tabs`, a partir de `origin/main` `1147600c`.

| Métrica | BEFORE |
|---|---|
| `dist/assets/main-*.js` | **8.124,03 kB** (gzip **1.917,27 kB**) |
| `dist/assets/main-*.css` | 432,39 kB (gzip 58,60 kB) |
| `dist/assets/client-*.js` | 194,97 kB (gzip 60,99 kB) |
| Chunks separados | 2 (`SalesOrderManagementFulfillmentPanel`, `satisfaction`) |
| Seções Financeiro no chunk inicial | 8 de 8 |
| `html2canvas` | no chunk inicial |
| Build | PASS |
| Typecheck | 1370 erros pré-existentes (`src/` = 1204) |
| Mount de aba inativa | 0 |
| Fetch de aba escondida | 0 |
| Fetch de aba sem permissão | 0 |
| Páginas de seção com proteção de corrida | 6 de 8 |

Falhas de teste pré-existentes na baseline (13, nenhuma causada por esta missão):

- `test:finance:cash-flow` (472/470/2): *"2. endpoint continua independente dos filtros da tela"*, *"meta aparece quando há base do ano anterior"*
- `test:finance:accounts-receivable` (306/305/1) e `test:finance:accounts-payable` (260/259/1): *"Faturamento: painel executivo e NF-e usam filtros aplicados distintos"*
- `test:finance:billing` (126/122/4): *"UI billing possui resumo executivo, export e erro de comparativo"*, *"página billing usa design executivo e abas inferiores"*, *"FinanceBillingPage mantém NF-e como fonte padrão e SalesOrder só em comparativo"*, *"Faturamento: painel executivo e NF-e usam filtros aplicados distintos"*
- `test:finance:executive-report` (186/184/2): *"mapeia fontes oficiais AR/AP/Fluxo/Faturamento/Pedidos"*, *"KPI card suporta tooltip/hint"*
- lote estrutural/navegação (177/174/3): *"permissões escondem tela"*, *"cards principais aparecem"*, *"cards financeiros usam amountFormat currency com campos do summary"*

## Divergences Found

**NONE FOUND.**

A superfície já estava consolidada em motores canônicos antes desta missão, com suítes
cross-consumer pré-existentes provando paridade (`financeArTitlesSourceValidation.test.ts`,
`financeCashFlowArApReconciliation.test.ts`, `financeDashboardConsistencyAudit.test.ts`,
`financeAccountsReceivableCalculationAudit.test.ts`,
`financeAccountsPayableCalculationAudit.test.ts`, `effectiveScheduleConsumers.test.ts`,
`financeCashFlowReconciliationMap.test.ts`).

Verificações feitas nesta auditoria, todas sem divergência:

- Faixas de aging: CR e CP **delegam** ao mesmo `assignFinanceDashboardAgingBucketKey`;
  não há duas definições de bucket.
- Eixo temporal CP: nenhum consumidor gerencial agrega por `issueDate`, `competenceDate`
  ou `createdAt` onde o contrato exige `dueDate`.
- Títulos efetivos CR: todos os consumidores passam por
  `resolveFinanceArCanonicalEffectiveTitles` / `loadFinanceArTitlesSourceBundle` /
  `buildFinanceCashFlowArRowsAlignedWithTitles`.
- Somas inline em componentes (Centro de Ações CR/CP, `FinanceBillingCustomersTab`,
  cards de resumo da auditoria O2C) operam sobre listas **já produzidas pelo motor
  oficial** e representam apenas o total daquela lista exibida — não são fórmulas
  paralelas de grandeza canônica. Classificação: `INTENTIONALLY_DIFFERENT` (total de
  recorte de UI), sem ação.

## Frontend Findings

| Achado | Classificação | Ação |
|---|---|---|
| 8 páginas de seção em import estático → superfície inteira no chunk inicial | P1 | **Corrigido** — `React.lazy` + `Suspense` por seção |
| `html2canvas` (202 kB) em import estático, usado só na exportação PNG do Presidencial | P1 | **Corrigido** — `await import("html2canvas")` dentro da função de captura |
| DRE Gerencial: `loadReport` sem `AbortController` | P0 (valor errado na tela) | **Corrigido** |
| Relatório Presidencial: `loadReport` sem `AbortController` | P0 (valor errado na tela) | **Corrigido** |
| `FinanceDueRadar` renderiza nas duas page views de CR | Rejeitado | Fetch já é diferido por `IntersectionObserver`; mover o painel seria mudança visual |
| Faturamento carrega `/comparison` e `/audit` na abertura | Rejeitado | Alimentam o Centro de Ações **sempre visível**; diferir esconderia dado hoje exibido |
| Painéis de sync CR/CP/NF-e com `setInterval` de 12 s | Rejeitado | Só polla enquanto a sync está rodando; comportamento correto |
| `recharts` em import estático em todos os gráficos | Rejeitado como alvo isolado | A biblioteca permanece no chunk inicial por consumidores fora do Financeiro (`DashboardModule`, `ReportsModule`, Comercial, Materiais); deferir só no Financeiro não removeria do bundle inicial |
| Abertura da tela: aba inativa monta / faz fetch | Não aplicável | Arquitetura de rotas já garantia zero |

## API Findings

24 rotas Express do Financeiro auditadas estaticamente (`financeAccountsReceivableRoutes`,
`financeAccountsReceivableOverdueRoutes`, `financeAccountsPayableRoutes`,
`financeAccountsPayableCostCenterAllocationRoutes`, `financeDueRadarRoutes`,
`financeCashFlowRoutes`, `financeBillingRoutes`, `financeSalesOrdersRoutes`,
`financeExecutiveReportRoutes`, `financeDreRoutes`, `financeCostCentersRoutes`,
`financePortfolioReconciliationRoutes`).

- Todas as rotas de leitura têm `requireAppAuth` + `requireResource(<recurso>, view)`;
  exportações exigem a ação `export`; mutações exigem `manage`/`execute`.
- Nenhuma redução de DTO aplicada: as rotas quentes já usam `select` estreito
  (`FINANCE_AP_TITLE_SELECT`, `FINANCE_CASH_FLOW_AP_SELECT`).
- Nenhum cálculo financeiro duplicado no servidor: as rotas delegam aos adapters oficiais.

## Query Structural Findings

Sem banco real, nada foi executado. Análise estrutural apenas.

| Padrão | Local | Classificação |
|---|---|---|
| `getOrderFullAudit` por pedido (~28 consultas cada) em lotes | `finance/financeAccountsReceivableEffectiveTitles.server.ts` | **DEFERRED_HIGH_RISK** — já documentado no código, com modo `light` alternativo e `take` limitando o lote; alternar o modo padrão altera o motor de projeção do Fluxo de Caixa (território PERF 2C) e exige medição real |
| `prisma.financialCostCenter.findMany` sem `where` | `financeCashFlowRoutes.ts` (drilldown de centros de custo do radar diário) | Rejeitado — tabela de dimensão, `select` estreito (`id, code, name, status`), usada como mapa de lookup; filtrar arriscaria omitir centro referenciado por alocação. Volume real: `SERVER_VALIDATION_PENDING` |
| `findMany({ include: { aliases: true } })` em fornecedores | `financeSupplierEngine.ts` | Fora do escopo desta missão (operação de rebuild, não abertura de tela) |

Nenhum `for (… of …) { await prisma… }` encontrado nas rotas do Financeiro.

## Bundle Findings

`main-*.js` era um monólito de 8,1 MB com praticamente toda a aplicação. As 8 seções do
Financeiro respondiam por ~1,1 MB desse total (bruto), somadas aos chunks compartilhados
que se separaram junto (`financeAgingBucketDrilldownTypes`, `financeKpiTooltips`,
`financeDataAudit`, `FinanceHorizonSection`, `FinanceDueRadar`,
`FinanceCashFlowMonthlyTimelineTable`, `FinanceCostCenterExpenseMapExecutiveSummary`,
`FinanceDataAuditDrawer`, `FinanceBiCollapsibleSection`, e os pequenos de billing/DRE).

## Performance Prioritization

- **P0** — corrida de filtro no DRE e no Relatório Presidencial (resposta antiga
  sobrescrevendo o período selecionado). Corrigido.
- **P1** — 8 seções no chunk inicial; `html2canvas` no chunk inicial. Corrigido.
- **P2** — nenhuma otimização com ganho comprovável restante que não exigisse mudança de
  comportamento ou medição em servidor.
- **P3** — não perseguido.

## Changes Implemented

1. `src/components/FinanceModule.tsx` — as 8 seções e as 2 rotas aninhadas passam a
   `React.lazy`, sob uma fronteira `React.Suspense` com o `FinanceModuleLoadingFallback`
   que já existia no arquivo. Gate de permissão permanece **antes** do elemento da rota.
2. `src/lib/financeExecutiveReportImageCapture.ts` — `html2canvas` passa a ser importado
   dinamicamente dentro de `captureExecutiveReportPageImages`.
3. `src/components/finance/FinanceManagerialDrePage.tsx` — `loadReport` ganha
   `AbortController`, seguindo o padrão já usado por `loadCashBridge` no mesmo arquivo.
4. `src/components/finance/FinanceExecutiveReportPage.tsx` — mesma proteção em `loadReport`.
5. `src/lib/financeLazyBoundaries.test.ts` (novo) — 7 testes estruturais travando as
   fronteiras de code-splitting, a fronteira de Suspense, o gate de permissão antes do
   mount e o carregamento sob demanda do `html2canvas`.
6. `src/lib/financeFilterRaceProtection.test.ts` (novo) — 25 testes estruturais exigindo,
   nas 8 páginas de seção, abort da requisição anterior, propagação do `signal`, descarte
   da resposta abortada e `AbortError` não tratado como erro de tela.

## Canonical Consolidations

Nenhuma consolidação nova foi necessária: a superfície já operava com um motor por
grandeza. O trabalho canônico desta missão foi de **verificação e documentação** — a
matriz de valores, a tabela de motores oficiais e a tabela de contratos acima passam a
existir como referência única.

## Changes Rejected

- Diferir `recharts` apenas no Financeiro — sem ganho no bundle inicial enquanto módulos
  fora do Financeiro o importam estaticamente.
- Extrair metadados de exportação (`*ExportMeta`) para tirar `xlsx` dos chunks do
  Financeiro — `xlsx` permanece no chunk inicial por consumidores de Vendas, Comissões,
  Materiais e Projetos; sem ganho isolado.
- Diferir `/billing/comparison` e `/billing/audit` — alimentam o Centro de Ações sempre
  visível; diferir mudaria o que o usuário vê ao abrir.
- Mover `FinanceDueRadar` para dentro da page view "Visão Geral" — mudança visual, e o
  fetch já é diferido por visibilidade.
- Filtrar `financialCostCenter.findMany` — risco de omitir centro referenciado, sem
  evidência de volume.
- Virtualizar grades — sem evidência de escala reproduzível localmente.
- Criar índice de banco — proibido sem PostgreSQL real (ver `INDEX_CANDIDATES`).

## Deferred High Risk

- `DEFERRED_HIGH_RISK` — alternar o modo de projeção do Fluxo de Caixa de `legacy` para
  `light` em `financeAccountsReceivableEffectiveTitles.server.ts` eliminaria o padrão
  `getOrderFullAudit`-por-pedido, mas altera o motor de projeção e pode mudar números.
  Exige medição em servidor e decisão explícita.

## Business Decisions Required

Nenhuma. Não houve caso em que a semântica correta fosse indeterminável.

## Before vs After

| Métrica | BEFORE | AFTER | Delta |
|---|---|---|---|
| `main-*.js` | 8.124,03 kB | **7.017,72 kB** | **−1.106,31 kB (−13,6%)** |
| `main-*.js` gzip | 1.917,27 kB | **1.655,39 kB** | **−261,88 kB (−13,7%)** |
| `main-*.css` | 432,39 kB | 386,81 kB | −45,58 kB |
| `main-*.css` gzip | 58,60 kB | 54,57 kB | −4,03 kB |
| Seções Financeiro no chunk inicial | 8 de 8 | **0 de 8** | −8 |
| `html2canvas` no carregamento da tela | sim | **não** (chunk de 202,38 kB sob demanda) | — |
| Chunks separados | 2 | 30 | +28 |
| Páginas de seção com proteção de corrida | 6 de 8 | **8 de 8** | +2 |
| Mount de aba inativa | 0 | 0 | — |
| Fetch de aba escondida | 0 | 0 | — |
| Fetch de aba sem permissão | 0 | 0 | — |
| Typecheck | 1370 | 1370 | **0 novos** |
| Build | PASS | PASS | — |

Chunks por seção criados (bruto / gzip): Presidencial 204,80 / 57,12 kB · Centros de Custo
156,51 / 36,98 kB · Contas a Receber 92,81 / 21,67 kB · Fluxo de Caixa 91,99 / 21,52 kB ·
Contas a Pagar 83,99 / 19,91 kB · DRE 76,71 / 18,82 kB · Faturamento 60,00 / 15,82 kB ·
Pedidos de Venda 22,02 / 6,33 kB · Detalhe de Centro de Custo 14,96 / 4,56 kB ·
Parametrização DRE 4,53 / 1,90 kB.

Efeito prático: abrir o sistema deixou de baixar a superfície Financeiro inteira, e abrir
uma seção baixa apenas aquela seção. Nenhum valor financeiro foi recalculado.

## Regression Safety

Nenhuma linha de cálculo financeiro foi tocada. As mudanças são de **fronteira de
carregamento** (import estático → dinâmico) e de **descarte de resposta obsoleta**
(abort), que só pode remover um resultado que já não corresponde ao filtro na tela.

Resultados após as mudanças estão na seção `Tests` do relatório final: mesmas contagens de
falha da baseline, mesmos nomes de teste falhando, zero regressão nova.

## Server Validation Pending

- `EXPLAIN ANALYZE` de qualquer consulta do Financeiro.
- Tempo real de resposta dos endpoints e latência HTTP percebida.
- Payload real de produção e volume real de linhas de CR/CP/alocações.
- Ganho real de TTI/FCP com o chunk inicial 1,1 MB menor (medido só como bytes).
- Custo real do round-trip extra ao abrir uma seção pela primeira vez.
- Verificação de índice existente ou necessário.
- Comportamento do `getOrderFullAudit` em lote sob volume real.
- Validação em navegador de homologação.

## Remaining Bottlenecks

1. `main-*.js` continua com 7,0 MB — a maior parte é não-Financeiro: `App.tsx` importa
   praticamente todos os módulos estaticamente. O mesmo padrão aplicado aqui resolveria,
   mas está fora do escopo desta missão.
2. `recharts` e `xlsx` permanecem no chunk inicial por consumidores fora do Financeiro.
3. `getOrderFullAudit` por pedido no caminho de projeção do Fluxo de Caixa.
4. Grades que trazem o conjunto filtrado inteiro antes de paginar
   (`buildFinanceApTitlesPayload`) — impacto depende de volume real.

## Recommended Next Phase

1. Aplicar o mesmo code-splitting por módulo em `App.tsx` (Comercial, Comissões,
   Materiais, Relatórios, Dashboard, Operações) — pelo padrão observado aqui, é o maior
   ganho de bundle restante e é mecânico.
2. Com isso feito, `recharts` e `xlsx` passam a ser candidatos reais a chunk sob demanda.
3. Medir em servidor os itens de `Server Validation Pending`, em especial o modo de
   projeção do Fluxo de Caixa, antes de qualquer decisão sobre o `getOrderFullAudit`.
4. Paginação server-side nas grades de títulos, se o volume real justificar.

## INDEX_CANDIDATES

Nenhum. Sem PostgreSQL real, não há evidência para propor índice; nenhuma migration de
índice foi criada nesta missão.
