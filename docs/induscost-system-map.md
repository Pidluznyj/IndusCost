# IndusCost — Mapa do sistema

Mapas operacionais derivados de inspeção direta do código. Útil para
localizar o caminho frontend → cliente REST → endpoint → lib server →
modelo Prisma de cada fluxo.

## 1. Modelos Prisma agrupados

> Total: **51 models + 22 enums** em `prisma/schema.prisma`.

### Identidade & permissões
- `AppUser`, `AppSession`, `AppUserRole` (enum)

### Manufatura (núcleo)
- `Product`, `ProductBOM`, `ProductRouting`
- `ItemType` (enum: `PRODUCT | COMPONENT`)
- `ProductCostingMode` (enum: `OWN_PROCESS | BOM_ONLY | FINISHING_SERVICE`)
- `Material`, `MaterialPriceHistory`
- `Machine`, `MachineCostComponent`
- `Role`, `Employee`, `PayrollComponent`, `EmployeePayrollComponent`

### Custos & preço
- `IndirectCost`, `TaxRule`, `TaxComponent`
- `ProductPricing` (margem desejada × TaxRule)
- `PriceTable`, `PriceTableVersion`, `PriceTableItem`
- `Simulation`, `NewProductSimulation` + status enum
- `CostCalculationLog`, `CostCenter`
- `ProductionHourCostSimulation`

### Comercial
- `Customer`, `Proposal`, `ProposalItem`, `ProposalStatus` (enum)
- `SalesOrder`, `SalesOrderItem`, `SalesOrderStatus` (enum)
- `BrandingSettings`

### CRM
- `CommercialActivity`, `CrmCustomerProfile`, `CommercialAuditLog`
- `IntegrationRun`

### Compras
- `PurchaseRequest`, `PurchaseRequestItem` + enums (`PurchaseRequestStatus`,
  `PurchasePriority`, `PurchaseLineType`, `PurchaseItemLineStatus`)

### Manutenção predial
- `MaintenanceRequest`, `MaintenanceRequestStatusHistory`
- `MaintenanceStatus`, `MaintenancePriority`, `MaintenanceCategory` (enums)

### Nomus — stage e governança
- `NomusBomComponentStage` (ingestão de BOM crua + payload)
- `NomusOptionalPricingGroup`, `NomusOptionalPricingChoice`,
  `NomusOptionalPricingSelectionMode` (enum)
- `NomusBomReviewDecision` + `NomusBomReviewDecisionType` (enum)

### Nomus — execução
- `NomusBomApplyRun`, `NomusBomApplyRunLine` + enums de status
- `NomusProductImportRun`, `NomusProductImportRunLine` + status enum
- `EngineeringSyncRun` + `EngineeringSyncRunMode`, `EngineeringSyncRunStatus` (enums)
- `EngineeringChangeLog` + `EngineeringChangeEntityType`,
  `EngineeringChangeOrigin` (enums) → tabela canônica de auditoria

### Backups históricos (persistidos no schema)
> 9 modelos `*_backup_*_20260413` — ver auditoria para recomendação de
> arquivamento.

- `ProductBOM_backup_420_01A_20260413`
- `ProductBOM_backup_61051_mola_atual_20260413`
- `ProductBOM_backup_add_80001_montagem_20260413`
- `ProductBOM_backup_auto_remap_componentes_comprados_20260413`
- `ProductBOM_backup_remap_material_lote2_20260413`
- `ProductBOM_backup_remap_material_lote4_20260413`
- `ProductBOM_backup_remove_obsoletos_20260413`
- `Product_backup_process_componentes_materiais_20260413`
- `Product_backup_process_xlsx_20260413`

## 2. Endpoints `server.ts` (176 rotas) — agrupados

> Lista exaustiva derivada de `Select-String app\.(get|post|put|patch|delete)`.
> Linhas dadas para localização rápida.

### Auth & bootstrap
- `GET /api/health` · `GET /api/bootstrap-admin/status` · `POST /api/bootstrap-admin/login` · `POST /api/bootstrap-admin/logout`
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`

### Admin / RBAC
- `GET /api/admin/permissions/catalog`
- `GET /api/admin/seller-options`
- `GET /api/admin/users` · `POST /api/admin/users` · `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `POST /api/admin/users/bootstrap-super-admin`

### Cadastros base
- **Roles**: `GET/POST/PUT/DELETE /api/roles[:id]`
- **Payroll**: `GET/POST/PUT/DELETE /api/payroll-components[:id]`
- **Employees**: `GET/POST/PUT/DELETE /api/employees[:id]` + `PATCH /:id/status`
- **Machines**: `GET/POST/PUT/DELETE /api/machines[:id]`
- **Materials**: importer + CRUD completo + `PATCH /:id/status`
- **Cost centers**: `GET/POST/PATCH /api/cost-centers[:id]`
- **Products**: importer + CRUD + `bulk-delete` + `/:id/tree`
- **Indirect costs**: `GET/POST/PUT/DELETE /api/indirect-costs[:id]` com `requireBootstrapForGlobalParamMutation`
- **Tax rules**: `GET/POST/PUT/DELETE /api/tax-rules[:id]`

### Custos & cálculo
- `GET /api/products/:id/cost-analysis`
- `GET /api/products/:id/pricing-snapshot`
- `GET /api/products/:id/tree`
- `GET /api/products/bom-item-options`

### Pricing
- `GET /api/pricing` · `POST /api/pricing` · `POST /api/pricing/bulk-delete` · `DELETE /api/pricing/:id`
- `GET /api/pricing/:productId/:taxRuleId/calculate`
- `POST /api/pricing/simulate-unit` · `POST /api/pricing/simulate-batch`
- `POST /api/pricing/apply-batch` ⚠️ **sem confirmação textual** (ver auditoria)

### Price tables
- `GET /api/price-tables`
- `POST /api/price-tables/:priceTableId/versions/generate-draft`
- `GET /api/price-table-versions/:id/items`
- `GET /api/price-tables/:priceTableId/products/:productId/published-price`
- `POST /api/price-table-versions/:id/publish`

### Simulações
- `GET/POST/DELETE /api/simulations[:id]`
- `GET /api/simulations/:id/compare`
- `GET/POST/DELETE /api/new-product-simulations[:id]`
- `POST /api/new-product-simulations/save` · `POST /:id/clone`

### Branding / settings / nomus health
- `GET/PUT /api/branding-settings`
- `GET /api/settings/globals`
- `GET /api/integrations/nomus/health`
- `GET /api/settings/nomus-sync/logs[/:fileName]`
- `GET/POST/DELETE /api/settings/production-hour-cost-simulations[/:id]`

### Reports / consumo de material
- `GET /api/reports/data`
- `GET /api/products/material-demand/{summary|rows|facets|analysis}`
- `GET /api/products/material-demand/materials/:materialId/details`

### Nomus — BOM core
- `GET /api/nomus/bom-comparison/report` · `/classification` · `/apply-plan`
- `GET /api/nomus/parent-code-options`

### Nomus — opcionais
- `GET /api/nomus/bom-optionals/pricing-selection`
- `GET /api/nomus/bom-optionals/pricing-selection/detail`
- `GET /api/nomus/bom-optionals/pricing-selection/groups`
- `GET/PUT/DELETE /api/nomus/bom-optionals/pricing-selection/groups/:groupId`
- `POST /api/nomus/bom-optionals/pricing-selection/groups/:groupId/selection`

### Nomus — BOM efetiva, impacto, decisões de revisão
- `GET /api/nomus/effective-pricing-bom` · `/cost-impact`
- `GET/POST/DELETE /api/nomus/effective-pricing-bom/review-decisions`
- `GET /api/nomus/effective-pricing-bom/apply-preview`
- `POST /api/nomus/effective-pricing-bom/apply` 🔒 **confirmação `APLICAR BOM NOMUS <CÓDIGO>`**

### Nomus — Import simulação (produto novo)
- `GET /api/nomus/product-import-simulation/preview`
- `POST /api/nomus/product-import-simulation/import`

### Nomus — Engenharia (cockpit + action plan + master data + equalize)
- `GET /api/nomus/engineering-operations-cockpit`
- `GET /api/nomus/engineering-equalization-action-plan`
- `GET /api/nomus/master-data-import/diagnostic`
- `GET /api/nomus/master-data-import/preview`
- `POST /api/nomus/master-data-import/apply-safe` 🔒 **`IMPORTAR CADASTRO MESTRE NOMUS`**
- `GET /api/nomus/master-data-equalize/preview`
- `POST /api/nomus/master-data-equalize/apply` 🔒 **`IGUALAR BASES NOMUS`**
- `GET /api/nomus/engineering-runs/recent`
- `GET /api/products/:id/change-history`

### Nomus — Engineering sync legado
- `GET /api/nomus/engineering-sync/preview`
- `POST /api/nomus/engineering-sync/apply`

### Customers / CRM

**Fonte comercial principal (2026-06):** Pedidos de Venda (`SalesOrder`). Propostas = pré-venda, CRUD, impressão e geração de pedido — não são proxy de receita/pipeline nos dashboards globais. Ver `docs/commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`.

- Importer + CRUD + `GET /api/customers/indicators[/drilldown]`
- `GET /api/customers/:id/commercial-360` — SalesOrder + ABC
- `GET/POST/PATCH /api/customers/:customerId/commercial-activities[/:id]`
- `GET /api/crm/dashboard/basic` · `/management-dashboard` · `/seller-dashboard`
- `GET /api/crm/customers` · `/:customerId/profile` · `/commercial-intelligence`
- `PUT /api/crm/customers/:customerId/profile`

### Proposals & Sales orders
- `GET /api/proposals` (+ filtros) · `:id` · `responsibles`
- `POST/PUT/PATCH/DELETE /api/proposals[:id|:id/status]`
- `POST /api/proposals/:id/generate-sales-order`
- `GET /api/sales-orders[/:id]`

### Maintenance
- CRUD `/api/maintenance-requests` + history + status

## 3. Mapa fluxo Nomus (frontend → backend → modelo)

```text
NomusMaintenanceOverviewPanel.tsx
│
├─► [sem produto]
│   ├─ NomusEngineeringStatusBoard.tsx
│   │  ├─► /api/nomus/engineering-operations-cockpit
│   │  ├─► /api/nomus/master-data-import/diagnostic
│   │  ├─► /api/nomus/master-data-equalize/preview
│   │  └─► /api/nomus/engineering-runs/recent
│   │
│   ├─ NomusMasterDataImportPanel.tsx
│   │  ├─► /api/nomus/master-data-import/{diagnostic|preview|apply-safe}
│   │  └─► /api/nomus/master-data-equalize/{preview|apply}
│   │
│   └─ NomusEngineeringOperationsCockpitPanel.tsx
│      ├─► /api/nomus/engineering-operations-cockpit
│      └─► /api/nomus/engineering-equalization-action-plan
│
└─► [com produto]
    ├─ ProductReleaseChecklist.tsx
    │  └─► /api/nomus/engineering-equalization-action-plan
    │
    ├─ NomusEffectivePricingBomPanel
    │  └─► /api/nomus/effective-pricing-bom
    │
    ├─ NomusEffectiveBomCostImpactPanel
    │  └─► /api/nomus/effective-pricing-bom/cost-impact
    │
    ├─ NomusBomApplyPlanPanel
    │  └─► /api/nomus/bom-comparison/apply-plan
    │
    ├─ NomusBomControlledApplySection (Aplicar BOM Nomus)
    │  ├─► /api/nomus/effective-pricing-bom/apply-preview
    │  └─► /api/nomus/effective-pricing-bom/apply  🔒
    │
    └─ ProductHistoryTab
       └─► /api/products/:id/change-history
```

Backend (lib server-side) por endpoint:

| Endpoint Nomus | Lib server-side | Modelo Prisma escrito |
|---|---|---|
| `master-data-import/{diagnostic,preview}` | `nomusMasterDataImport.ts` | — |
| `master-data-import/apply-safe` | `nomusMasterDataImport.ts` | `Product`, `Material`, `EngineeringChangeLog` (via productChangeHistory)\* |
| `master-data-equalize/preview` | `nomusMasterDataEqualize.ts` | — |
| `master-data-equalize/apply` | `nomusMasterDataEqualize.ts` | `Product`, `Material`, `EngineeringSyncRun`, `EngineeringChangeLog` |
| `engineering-operations-cockpit` | `nomusEngineeringOperationsCockpit.ts` | — |
| `engineering-equalization-action-plan` | `nomusEngineeringEqualizationActionPlan.ts` | — |
| `effective-pricing-bom` | `nomusEffectivePricingBom.ts` | — (lê stage + ProductBOM) |
| `effective-pricing-bom/cost-impact` | `nomusEffectiveBomCostImpact.ts` | — |
| `effective-pricing-bom/apply-preview` | `nomusBomControlledApply.ts` | — |
| `effective-pricing-bom/apply` | `nomusBomControlledApply.ts` | `ProductBOM`, `NomusBomApplyRun`, `NomusBomApplyRunLine`, `EngineeringSyncRun`, `EngineeringChangeLog` |
| `engineering-runs/recent` | inline em `server.ts` | — |
| `products/:id/change-history` | `productChangeHistory.ts` | — |

\* `apply-safe` da Carga Mestre **não** registra `EngineeringChangeLog`
por padrão; histórico é gerado retroativamente pelo Igualar Bases ou pelo
script `master-data-history-backfill` (com confirmação textual).

## 4. Scripts agrupados (42 arquivos em `scripts/`)

### Ingestão Nomus
- `nomusBomComponentsSyncV1.ts`, `nomusProductsSyncV1.ts`,
  `nomusCustomersSyncV1.ts`, `nomusProposalsSyncV1.ts`,
  `nomusSalesOrdersSyncV1.ts`
- Orquestrador: `nomusSyncOrchestrator.ts`
- Diários: `runNomusDailySync.sh`, `runNomusSalesOrdersSync.sh`

### Diagnóstico / preview Nomus (read-only)
- `nomusBomCompareV1.ts`, `nomusBomBatchReportV1.ts`,
  `nomusBomClassifyV1.ts`, `nomusBomApplyPlanV1.ts`,
  `nomusBomApplyPreviewV1.ts`, `nomusBomApplyValidationPrint.ts`
- `nomusEffectivePricingBomPreviewV1.ts`,
  `nomusEffectiveBomCostImpactV1.ts`,
  `nomusOptionalPricingStatusV1.ts`
- `nomusProductImportSimulationPreviewV1.ts`,
  `nomusProductImportDiagnosticV1.ts`
- `nomusMasterDataImportDiagnosticV1.ts`,
  `nomusMasterDataImportPreviewV1.ts`,
  `nomusMasterDataEqualizePreviewV1.ts`
- `nomusEngineeringReleaseCheckV1.ts`

### Smokes read-only (com snapshot + FK check)
- `nomusMaintenanceSmokeTestV1.ts`
- `nomusEngineeringOperationsCockpitSmokeTestV1.ts`
- `nomusEngineeringActionPlanSmokeTestV1.ts`
- `nomusMasterDataImportSmokeTestV1.ts`
- `nomusMasterDataEqualizeSmokeTestV1.ts`
- `nomusBomApplyAfterMasterDataSmokeTestV1.ts`
- `nomusEngineeringReleaseReadySmokeTestV1.ts`

### Apply mutativo Nomus (confirmação textual obrigatória)
- `nomusMasterDataImportApplySafeV1.ts` (`IMPORTAR CADASTRO MESTRE NOMUS`)
- `nomusMasterDataEqualizeApplyV1.ts` (`IGUALAR BASES NOMUS`)
- `nomusBomApplyOneV1.ts` (`APLICAR BOM NOMUS <CÓDIGO>`)
- `nomusMasterDataHistoryBackfillV1.ts` (`BACKFILL HISTORICO NOMUS`)

### Guardrail + utilitários
- `checkFrontendServerImports.ts` (rodado por `npm run check:frontend-imports`)
- `nomusNumberParser.ts` + teste
- `nomusProductStructureDiscovery.ts`
- `apply-api-permission-guards.mjs`, `fix-tags.mjs`, `patch-1f-tabs.mjs`
- `seedPriceTables.ts`

## 5. Componentes principais agrupados

### Top-level (40 arquivos em `src/components`)

| Categoria | Arquivos principais |
|---|---|
| Auth/portal | `LandingPage.tsx`, `AuthLoginPage.tsx`, `RequireAuth.tsx`, `AccessDenied.tsx`, `PublicLandingRoute.tsx`, `PublicLoginRoute.tsx`, `DefaultModuleRedirect.tsx` |
| Admin/RBAC | `AdminUsersModule.tsx`, `BrandingSettingsPanel.tsx`, `SettingsModule.tsx` |
| Operacional | `ProductModule.tsx`, `MaterialModule.tsx`, `MachineModule.tsx`, `EmployeeModule.tsx`, `IndirectCostModule.tsx`, `TaxModule.tsx` |
| Comercial / CRM | `ProposalModule.tsx`, `ProposalClientPreview.tsx`, `SalesOrdersModule.tsx`, `CustomerModule.tsx`, `CrmModule.tsx`, `CrmCommercialManagementTabs.tsx`, `CrmManagementDashboardSection.tsx`, `CrmManagementLists.tsx`, `CrmSellerDashboardSection.tsx`, `CrmSellerDashboardLists.tsx`, `CrmSellerSubTabs.tsx`, helpers `crmManagementTypes/ui.ts` e `crmSellerDashboardTypes/ui.ts` |
| Pricing / simulação | `PricingModule.tsx`, `SimulationModule.tsx`, `NewProductSimulationReport.tsx` + teste |
| Compras / Manutenção | `PurchaseModule.tsx`, `MaintenanceModule.tsx` |
| Painéis técnicos | `DashboardModule.tsx`, `ReportsModule.tsx`, `SystemGuideModule.tsx` |

### `src/components/product/` (29 arquivos)

| Categoria | Arquivos |
|---|---|
| Manutenção Nomus | `NomusMaintenanceOverviewPanel`, `NomusMaintenanceProductBanner`, `NomusMaintenanceStepHeader`, `NomusMaintenanceDiagnosticPanel`, `NomusMaintenanceErrorCard`, `NomusMaintenancePendingPanel`, `NomusMaintenanceProductDiagnosticView`, `NomusLocalReviewSection`, `NomusParentCodePickerModal`, `NomusBomPartialSkuPickerModal`, `NomusBomDiffModal`, `ProductNomusMaintenanceSection` |
| Central de Engenharia / Cockpit | `NomusEngineeringOperationsCockpitPanel`, `NomusEngineeringStatusBoard`, `NomusEngineeringSyncPanel` |
| Cadastro mestre & Equalização | `NomusMasterDataImportPanel`, `ProductReleaseChecklist` |
| BOM + custo + opcional | `NomusBomComparisonPanel`, `NomusBomClassificationPanel`, `NomusBomBatchReportPanel`, `NomusBomApplyPlanPanel`, `NomusBomControlledApplySection`, `NomusEffectivePricingBomPanel`, `NomusEffectiveBomCostImpactPanel`, `NomusOptionalPricingSelectionPanel`, `NomusProductImportSimulationPanel` |
| Histórico / abas técnicas | `ProductHistoryTab`, `OpenBookCompositionTab`, `ProductBomTreeContextPanel` |

## 6. Diagrama de auditoria (texto)

```text
            ┌───────────────────────────────────┐
            │       EngineeringSyncRun           │
            │  mode | status | planHash | summary│
            └───────────────┬───────────────────┘
                            │ FK runId (SetNull)
                            ▼
            ┌───────────────────────────────────┐
            │       EngineeringChangeLog        │
            │ entityType (PRODUCT | PRODUCT_BOM │
            │  | MATERIAL | ROUTING | PRICE_INPUT) │
            │ changeOrigin (NOMUS_SYNC |         │
            │  NOMUS_ENGINEERING_APPLY |         │
            │  MANUAL_EDIT | LOCAL_EXCEPTION)    │
            │ oldValue/newValue + json + summary │
            └───────────────────────────────────┘
```

Quem grava:

| Operação | Modelo run-pai | Onde |
|---|---|---|
| Carga Mestre apply | (sem run pai por padrão; backfill cria) | `nomusMasterDataImport.ts` |
| Igualar Bases apply | `EngineeringSyncRun` (mode=ALL_NOMUS_PRODUCTS) | `nomusMasterDataEqualize.ts` |
| Aplicar BOM apply | `NomusBomApplyRun` técnico + `EngineeringSyncRun` (mode=ONE_PRODUCT) | `nomusBomControlledApply.ts` |
| Backfill histórico | `EngineeringSyncRun` (origin=MASTER_DATA_HISTORY_BACKFILL) | `scripts/nomusMasterDataHistoryBackfillV1.ts` |
