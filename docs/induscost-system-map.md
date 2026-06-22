# IndusCost — Mapa do sistema

> **Atualizado:** 2026-06-17  
> **Branch:** `main`  
> **Commit HEAD:** `13f39bb`

Mapas operacionais derivados de inspeção direta do código. Útil para localizar o caminho **frontend → cliente REST → endpoint → lib → modelo Prisma** de cada fluxo.

---

## 1. Modelos Prisma agrupados

> Total: **95 models + 55 enums** em `prisma/schema.prisma` (era 51 + 22 em `7c57130`).

### Identidade & permissões
- `AppUser`, `AppSession`, `AppUserRole`, `AccessProfile`, `AccessProfilePermission`

### Manufatura (núcleo)
- `Product`, `ProductBOM`, `ProductRouting`
- `Material`, `MaterialPriceHistory`
- `Machine`, `MachineCostComponent`
- `Role`, `Employee`, `PayrollComponent`, `EmployeePayrollComponent`

### Custos & preço
- `IndirectCost`, `TaxRule`, `TaxComponent`, `ProductPricing`
- `PriceTable`, `PriceTableVersion`, `PriceTableItem`
- `Simulation`, `NewProductSimulation`
- `CostCalculationLog`, `CostCenter`, `ProductionHourCostSimulation`

### Comercial
- `Customer`, `Proposal`, `ProposalItem`, `BrandingSettings`
- **`SalesOrder`, `SalesOrderItem`** — fonte principal dashboards comerciais e financeiros

### CRM
- `CommercialActivity`, `CrmCustomerProfile`, `CommercialAuditLog`, `IntegrationRun`

### Financeiro Nomus (novo desde auditoria anterior)
- **`NomusAccountsReceivable`** — Contas a Receber oficial
- **`NomusAccountsPayable`** — Contas a Pagar oficial
- **`NomusNfe`** — NF-e fiscal para Faturamento

### Financeiro gerencial (centros de custo / fornecedores)
- **`FinancialSupplier`**, **`FinancialSupplierAlias`**
- **`FinancialCostCenter`**
- **`SupplierCostCenterRule`**
- **`AccountsPayableCostCenterAllocation`**
- **`FinancialCostCenterAuditLog`**

### Projetos (novo)
- `Project`, `ProjectVersion`, `ProjectPricingConfig`, `ProjectPricingItem`
- `ProjectSimulatedProduct`, `ProjectSimulatedItem`
- **`ProjectStructureLine`** — BOM hierárquica isolada do projeto (não há model `ProjectLaborLine`)
- `ProjectMold`, `ProjectCostAmortization`, `ProjectCostAmortizationAllocation`

### Frota (novo)
- `FleetVehicle`, `FleetDriver`, `FleetReservation`, `FleetReservationChecklist`, `FleetReservationChecklistItem`
- `FleetMaintenance`, `FleetFueling`, `FleetFine`, `FleetIncident`, `FleetCost`, `FleetUsage`
- `FleetPublicReservationRequest`, `FleetPublicReservationApprovalHistory`
- `FleetVehicleChecklistToken`, `FleetChecklist`, `FleetChecklistItem`, `FleetSettings`, `FleetAuditLog`
- `FleetVehicleContract`, `FleetVehicleDocument`, `FleetAttachment`

### Nomus — stage, opcionais, governança
- `NomusProductCatalog`, `NomusBomComponentStage`
- `NomusOptionalPricingGroup`, `NomusOptionalPricingChoice` (+ `nomusStructureFingerprint`)
- **`NomusBomReviewDecision`** (+ fingerprint, tipos de decisão)

### Nomus — execução & sync financeiro
- `NomusBomApplyRun`, `NomusBomApplyRunLine`
- `NomusProductImportRun`, `NomusProductImportRunLine`
- `EngineeringSyncRun`, `EngineeringChangeLog`

### Compras & Manutenção predial
- `PurchaseRequest`, `PurchaseRequestItem`
- `MaintenanceRequest`, `MaintenanceRequestStatusHistory`

### Backups históricos (persistidos)
9 models `*_backup_*_20260413` — candidatos a arquivamento.

---

## 2. Endpoints — visão por módulo

> **~197** rotas em `server.ts` + registradores modulares. Contagem via `Select-String app\.(get|post|put|patch|delete)` em `server.ts`.

### 2.1 Financeiro — `/api/finance/*`

Registradores: `finance*Routes.ts` (importados em `server.ts` L132–137).

```
GET  /api/finance/cash-flow/dashboard
GET  /api/finance/cash-flow/audit
GET  /api/finance/cash-flow/export

GET  /api/finance/accounts-receivable/dashboard
GET  /api/finance/accounts-receivable/titles
GET  /api/finance/accounts-receivable/export
GET  /api/finance/accounts-receivable/overdue
GET  /api/finance/accounts-receivable/overdue/export.xlsx

GET  /api/finance/accounts-payable/dashboard
GET  /api/finance/accounts-payable/titles
GET  /api/finance/accounts-payable/titles/:id/classification
GET  /api/finance/accounts-payable/export
GET  /api/finance/accounts-payable/classification-summary
GET  /api/finance/accounts-payable/unclassified
POST /api/finance/accounts-payable/classify-batch-preview   # finance.ap_allocations.apply_batch
POST /api/finance/accounts-payable/classify-batch-apply     # finance.ap_allocations.apply_batch
POST /api/finance/accounts-payable/:id/cost-center-allocation  # finance.ap_allocations.manage

GET  /api/finance/cost-centers
GET  /api/finance/cost-centers/dashboard
GET  /api/finance/cost-centers/:id
POST /api/finance/cost-centers
PATCH /api/finance/cost-centers/:id
GET  /api/finance/cost-center-audit

GET  /api/finance/supplier-cost-center-rules
POST /api/finance/supplier-cost-center-rules
PATCH /api/finance/supplier-cost-center-rules/:id
DELETE /api/finance/supplier-cost-center-rules/:id

GET  /api/finance/suppliers/rebuild-from-ap-preview
POST /api/finance/suppliers/rebuild-from-ap-apply

GET  /api/finance/billing/dashboard
GET  /api/finance/billing/nfes
GET  /api/finance/billing/export
GET  /api/finance/billing/audit
GET  /api/finance/billing/audit/export
GET  /api/finance/billing/comparison
GET  /api/finance/billing/sync-status
POST /api/finance/billing/sync

GET  /api/finance/sales-orders/dashboard
GET  /api/finance/sales-orders/export

GET  /api/finance/executive-report
```

### 2.2 CRM Comercial — `/api/crm/*`

```
GET  /api/crm/dashboard/basic
GET  /api/crm/management-dashboard          # Gestão Geral
GET  /api/crm/seller-dashboard            # Gestão por Vendedor / Meu Dashboard
GET  /api/crm/customers                     # Carteira de Clientes
GET  /api/crm/customers/:id/profile
PUT  /api/crm/customers/:id/profile
GET  /api/crm/customers/:id/commercial-intelligence   # Inteligência do Cliente
```

Escopo vendedor: `crmCommercialAccessScope.ts` + `resolveSellerDashboardScope` em `appAuthMiddleware.ts`.

### 2.3 Pedidos de Venda — operacional

```
GET  /api/sales-orders
GET  /api/sales-orders/:id
GET  /api/sales-orders/management           # Gestão de Pedidos + cards BI
GET  /api/sales-orders/:id/intelligence     # Drawer raio-x
```

Registro: `registerSalesOrderIntelligenceRoutes` (`salesOrderIntelligenceRoutes.ts`).

### 2.4 Projetos — `/api/projects/*`

Registro: `registerProjectsRoutes` (`projectsRoutes.ts`, ~30 rotas).

Principais:

```
GET  /api/projects/dashboard
GET  /api/projects
POST /api/projects
GET  /api/projects/:id
PATCH /api/projects/:id
DELETE /api/projects/:id
GET  /api/projects/lookup/{commercial-owners,customers,products,materials,simulations}
GET  /api/projects/lookup/products/:productId/{snapshot,engineering-snapshot}
POST /api/projects/:id/import-product-snapshot
POST /api/projects/:id/simulated-products | simulated-items | structure-lines | molds
GET/PUT /api/projects/:id/{pricing,cost-amortizations}
```

### 2.5 Nomus Engenharia — endpoints novos/relevantes

```
GET  /api/nomus/auto-apply-bom-dashboard
GET  /api/nomus/bom-auto-apply/products/apply-readiness
POST /api/nomus/bom-auto-apply/products/:parentCode/apply
POST /api/nomus/bom-auto-apply/products/apply-batch

# Legado (mantidos)
GET  /api/nomus/bom-comparison/{report,classification,apply-plan}
GET  /api/nomus/effective-pricing-bom[/cost-impact|/apply-preview]
POST /api/nomus/effective-pricing-bom/apply          🔒 APLICAR BOM NOMUS <CÓDIGO>
GET/POST/DELETE /api/nomus/effective-pricing-bom/review-decisions
GET/PUT/DELETE /api/nomus/bom-optionals/pricing-selection/...
POST /api/nomus/master-data-import/apply-safe         🔒 IMPORTAR CADASTRO MESTRE NOMUS
POST /api/nomus/master-data-equalize/apply            🔒 IGUALAR BASES NOMUS
GET  /api/nomus/engineering-operations-cockpit
GET  /api/nomus/engineering-equalization-action-plan
GET  /api/products/:id/change-history
```

### 2.6 Frota — `/api/fleet/*`

Registro: `registerFleetManagementRoutes` (`fleetManagementRoutes.ts`) — alertas, veículos, reservas, checklist, relatórios, rotas públicas de reserva.

### 2.7 Cadastros, pricing, auth (resumo — ver `server.ts`)

Mantidos do mapa anterior: auth, admin/RBAC, roles, employees, machines, materials, products, indirect-costs, tax-rules, pricing, price-tables, simulations, branding, maintenance, purchase-requests, customers CRUD, proposals, sales-orders CRUD básico.

---

## 3. Fluxos frontend → backend → lib → model

### 3.1 Financeiro — Fluxo de Caixa

```text
FinanceCashFlowPage.tsx
  → GET /api/finance/cash-flow/dashboard
    → financeCashFlowRoutes.ts
      → loadCashFlowRows (Prisma AR + AP)
      → buildFinanceCashFlowDashboard (financeCashFlowDashboard.ts)
        → NomusAccountsReceivable + NomusAccountsPayable
  → FinanceDataAuditDrawer (audit via ?audit=1 ou /cash-flow/audit)
  → GET /api/finance/cash-flow/export (CSV)
```

Exceção YTD: `financeCashFlowExecutiveYtd.ts` — filtro mensal não altera acumulado anual.

### 3.2 Financeiro — Contas a Receber

```text
FinanceAccountsReceivablePage.tsx
  → GET /api/finance/accounts-receivable/dashboard
    → loadFinanceArManagementRowsFromPrisma
      → filterFinanceArManagementReportRows (fiscal backing, dedup, stale)
        → NomusAccountsReceivable
  → sub-aba Atrasados → GET …/overdue (+ export.xlsx)
  → Horizonte carteira aberta: loadFinanceArOpenHorizonRowsFromPrisma (ignora período)
```

### 3.3 Financeiro — Faturamento

```text
FinanceBillingPage.tsx
  → GET /api/finance/billing/dashboard?billingSource=nfe|sales_order
    → billingSource=nfe  → buildBillingDashboardFromNfes → NomusNfe
    → billingSource=sales_order → buildBillingDashboardTab → SalesOrder
  → GET /api/finance/billing/nfes (lista NF-e)
  → POST /api/finance/billing/sync (Nomus NF-e)
```

### 3.4 Financeiro — Pedidos de Venda (gerencial)

```text
FinanceSalesOrdersPage.tsx
  → GET /api/finance/sales-orders/dashboard
    → financeSalesOrdersDashboard.ts
      → prisma.salesOrder + SQL NF (salesOrderInvoicingSql)
      → financeSalesOrdersExtendedMetrics.ts (BI logístico, manufacturing, carteira)
  → GET /api/finance/sales-orders/export
```

**Não usa Proposal.**

### 3.5 Financeiro — Relatório Presidencial

```text
FinanceExecutiveReportPage.tsx
  → GET /api/finance/executive-report
    → buildFinanceExecutiveReport (consolida AR, AP, Fluxo×2, Pedidos, Faturamento)
  → window.print() + executive-report-print.css (A4 landscape, 12 meses caixa anual)
```

### 3.6 CRM — Gestão por Vendedor

```text
CrmSellerDashboardSection.tsx
  → GET /api/crm/seller-dashboard?sellerIdentityKey=…
    → crmSellerDashboardService.ts
      → resolveSellerDashboardScope (bloqueia vendedor own de ver outro)
      → SalesOrder (+ CommercialActivity)
```

### 3.7 Gestão de Pedidos — Status Logístico BI

```text
SalesOrdersModule (gestão)
  → GET /api/sales-orders/management?logisticStatus=…
    → salesOrderIntelligenceRoutes.ts
      → buildSalesOrderManagementCards
        → buildSalesOrderLogisticStatus (salesOrderLogisticStatus.ts)
          → nomusRawResponse (NF dataProcessamento, itens status 1–6)
```

### 3.8 Projetos — snapshot de produto

```text
ProjectAddItemModal / import
  → GET /api/projects/lookup/products/:id/snapshot
  → POST /api/projects/:id/import-product-snapshot
    → projectsProductSnapshot.ts (cópia para ProjectStructureLine — não altera Product oficial)
```

Bloqueio: `PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION` em `projectsAddItemPolicy.ts`.

### 3.9 Nomus — fila Prontos para aplicar

```text
NomusAutoApplyBomDashboard (product/)
  → GET /api/nomus/auto-apply-bom-dashboard
    → nomusAutoApplyBomDashboard.ts (parse relatório JSON, readyToApply)
  → POST /api/nomus/bom-auto-apply/products/:parentCode/apply
    → applyNomusBomFromDashboard
      → nomusBomControlledApply.ts → ProductBOM, NomusBomApplyRun, EngineeringChangeLog
  → POST /api/nomus/bom-auto-apply/products/apply-batch
```

Rotina automática (separada):

```text
npm run sync:nomus:all:apply
  → nomusSyncOrchestrator.ts
    → sync bom-components
    → runNomusBomAutoApplyAfterSync (todo o stage, modo APPLY)
```

---

## 4. Mapa fluxo Nomus Engenharia (herdado + extensões)

```text
ProductModule / NomusMaintenanceOverviewPanel
│
├─ [sem produto] Central de Engenharia
│   ├─ NomusEngineeringStatusBoard → /api/nomus/engineering-operations-cockpit
│   ├─ NomusMasterDataImportPanel → master-data-import / equalize
│   └─ NomusAutoApplyBomDashboard → /api/nomus/auto-apply-bom-dashboard
│       └─ apply individual/lote → /api/nomus/bom-auto-apply/products/…
│
└─ [com produto]
    ├─ NomusEffectivePricingBomPanel → effective-pricing-bom
    ├─ NomusBomControlledApplySection → apply 🔒
    ├─ NomusOptionalPricingSelectionPanel → bom-optionals
    └─ ProductHistoryTab → /api/products/:id/change-history
```

| Operação | Lib | Models escritos |
|----------|-----|-----------------|
| Apply controlado | `nomusBomControlledApply.ts` | `ProductBOM`, `NomusBomApplyRun`, `EngineeringSyncRun`, `EngineeringChangeLog` |
| Review decision | `nomusBomReviewDecision.ts` | `NomusBomReviewDecision` (+ fingerprint) |
| Auto-apply pós-sync | `nomusBomAutoApplyAfterSync.ts` | idem (batch) |
| Apply dashboard | `applyNomusBomFromDashboard` | idem (unitário) |
| Igualar bases | `nomusMasterDataEqualize.ts` | `Product`, `Material`, `EngineeringSyncRun`, `EngineeringChangeLog` |

---

## 5. Scripts agrupados (64 arquivos em `scripts/`)

### Sync Nomus — cadastros & comercial
- `nomusCustomersSyncV1.ts`, `nomusProductsSyncV1.ts`, `nomusBomComponentsSyncV1.ts`
- `nomusProposalsSyncV1.ts`, `nomusSalesOrdersSyncV1.ts`
- `nomusSyncOrchestrator.ts` — `sync:nomus:all:{dry,apply}` (+ auto-apply BOM no final)

### Sync Nomus — financeiro
- `nomusAccountsReceivableSync.ts` — `sync:nomus:accounts-receivable:apply`
- `nomusAccountsPayableSync.ts` — `sync:nomus:accounts-payable:{preview,apply}`
- `nomusNfesSync.ts` — `sync:nomus:nfes:{preview,apply,dry}`

### BOM auto-apply & debug
- `nomusBomAutoApplyAfterSyncV1.ts` — `sync:nomus:bom-auto-apply`
- **`debug-nomus-ready-to-apply.ts`** — `debug:nomus-ready-to-apply`
- `nomusAutoSyncBomApplySmokeTestV1.ts`

### Diagnóstico / preview (read-only)
- `nomusBomCompareV1.ts`, `nomusBomBatchReportV1.ts`, `nomusBomClassifyV1.ts`
- `nomusEffectivePricingBomPreviewV1.ts`, `nomusMasterData*Preview*.ts`
- Smokes: `nomusMasterDataImportSmokeTestV1.ts`, `nomusEngineeringReleaseReadySmokeTestV1.ts`, etc.

### Apply mutativo (confirmação textual)
- `nomusMasterDataImportApplySafeV1.ts`, `nomusMasterDataEqualizeApplyV1.ts`
- `nomusBomApplyOneV1.ts`, `nomusMasterDataHistoryBackfillV1.ts`

### Guardrail
- `checkFrontendServerImports.ts` — `npm run check:frontend-imports`

---

## 6. Componentes principais (agrupados)

### Financeiro (`src/components/finance/`)
- Páginas: `FinanceCashFlowPage`, `FinanceAccountsReceivablePage`, `FinanceAccountsPayablePage`, `FinanceBillingPage`, `FinanceSalesOrdersPage`, `FinanceExecutiveReportPage`
- Shell: `FinanceModule.tsx` (em `src/components/`)
- Shared: `finance/shared/FinanceModuleStates.tsx`, `FinanceDataAuditDrawer`, `FinanceBiFilterPanel`
- Subpastas: `cash-flow/`, `billing/`, `executive-report/`, `bi/`

### CRM (`src/components/`)
- `CrmModule.tsx`, `CrmCommercialManagementTabs.tsx`
- `CrmManagementDashboardSection.tsx`, `CrmSellerDashboardSection.tsx`
- `crm/customer-intelligence/*` — Inteligência do Cliente

### Pedidos (`src/components/sales/`)
- `SalesOrdersModule`, `SalesOrderIntelligenceDrawer`, `SalesOrderPrintView`

### Projetos (`src/components/projects/`)
- `ProjectsModule`, `ProjectStructureLineEditModal`, `ProjectIntakeActions`, `ProjectExecutiveReport`

### Frota (`src/components/fleet/`)
- 22 componentes — veículos, reservas, checklist, rotas públicas

### Produto / Nomus (`src/components/product/`)
- 29+ painéis Nomus incluindo `NomusAutoApplyBomDashboard`, cockpit, apply controlado

---

## 7. Testes por domínio (amostra)

| Domínio | Arquivos | Exemplos |
|---------|----------|----------|
| Financeiro | ~103 | `financeModuleTabsValidation`, `financeExecutiveReportConsistency`, `financeCrossModuleReconciliation` |
| CRM | ~10 | `crmCommercialAccessScope`, `crmSellerDashboard`, `crmManagementDashboard` |
| Pedidos BI | ~8 | `salesOrderLogisticStatus`, `salesOrderManagementDashboard`, `financeSalesOrdersExtendedMetrics` |
| Projetos | ~25 | `projectsService`, `projectsGuidedFlow`, `projectsProductEngineeringSnapshot` |
| Nomus BOM | ~15 | `nomusBomReadyToApply`, `nomusBomApplyStatus`, `nomusEngineeringDecisionGovernance` |
| Frota | ~10 | `fleetPublicReservation`, `fleetNavigation` |
| Core legado | ~22 | `simulationFormula`, `pricingFormationIndicatorsStats` |

Total `src/lib/*.test.ts`: **~289**.

---

## 8. Diagrama de auditoria engenharia (texto)

```text
            ┌───────────────────────────────────┐
            │       EngineeringSyncRun           │
            │  mode | status | planHash | summary│
            └───────────────┬───────────────────┘
                            │ FK runId (SetNull)
                            ▼
            ┌───────────────────────────────────┐
            │       EngineeringChangeLog        │
            │ entityType | changeOrigin | json  │
            └───────────────────────────────────┘
                            ▲
            ┌───────────────┴───────────────────┐
            │       NomusBomApplyRun             │
            │  + NomusBomApplyRunLine              │
            │  (apply controlado / auto-sync)      │
            └─────────────────────────────────────┘
```

Governança opcionais:

```text
NomusOptionalPricingGroup (nomusStructureFingerprint)
  → NomusOptionalPricingChoice
  → NomusBomReviewDecision (invalida se fingerprint + linha local divergirem)
```

---

## 9. Riscos de mapa / pendências técnicas

| ID | Risco | Impacto |
|----|-------|---------|
| P1 | `server.ts` ~12.4k linhas | Dificulta onboarding e revisão de PRs |
| P1 | Auto-sync BOM aplica do stage inteiro | Pode colidir com fila manual `ready_to_apply` |
| P2 | Endpoints financeiros espalhados em 7 registradores | Boa modularização, mas sem OpenAPI único |
| P2 | `ProjectLaborLine` não existe | Documentar como `ProjectStructureLine` + `ProjectSimulatedItem` |
| P2 | 9 models backup no schema | Poluição do Prisma Client |

---

## 10. Referências cruzadas

- Estado detalhado por aba: `docs/induscost-system-current-state.md`
- Fonte comercial SalesOrder: `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md` (se existir)
- Sync Nomus operacional: scripts `sync:nomus:*` em `package.json`
