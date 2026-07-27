# Relatório — validador automático de permissões

| | |
|---|---|
| Gerado em | 2026-07-27T17:32:04.940Z |
| Modo | report |
| OK (modo) | sim |
| Catálogo | 224 |
| Contrato | 104 |
| Seed relacional | 151 |
| Uso FE (chaves) | 33 |
| Uso BE (chaves) | 129 |
| Rotas escaneadas | 797 |
| Findings | error 2 · warn 42 · info 132 |
| Known gaps | 140 |
| Erros acionáveis | 2 |

## Limitações
- Scan AST não resolve spreads de constantes importadas de outros arquivos.
- Guards fleet/custom (createFleetRouteGuards) e checks inline em handlers não contam como permissionKeys.
- Botões sensíveis sem hasPermission exigem heurística UI — não classificados como erro automático nesta versão.
- Rotas registradas via wrappers (registerXRoutes) são cobertas se o arquivo *Routes.ts usa app/router.METHOD.
- CATALOG_NEVER_USED ignora uso indireto via arrays tipados sem literal no call site.

## Fantasmas (usado ∉ catálogo)
_Nenhum._

## Findings (agrupados)
### CATALOG_NEVER_USED (93)
- **info** _(known)_: Chave no catálogo sem uso literal detectado: reports.material_demand.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.reports.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: commercial.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.activities.create
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.activities.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.profile.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.customers.assign_seller
- **info** _(known)_: Chave no catálogo sem uso literal detectado: customers.commercial360.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: proposals.material_report.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow.values.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow.financial.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow.inconsistencies.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow.timeline.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow_management.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow_management.priority.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow_management.responsibility.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow_management.blocking.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.flow.rebuild.execute
- **info** _(known)_: Chave no catálogo sem uso literal detectado: output_documents.detail.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: products.tab.routing
- **info** _(known)_: Chave no catálogo sem uso literal detectado: purchases.indicators.view
- … +68 omitidos

### CONTRACT_ACTION_UNUSED (39)
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.products.tab.routing.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.materials.market_intelligence.quotes.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.activities.create
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.activities.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.assign_seller.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow.values.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow.financial.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow.inconsistencies.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow.timeline.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow_management.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow_management.priority.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow_management.responsibility.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow_management.blocking.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.flow_rebuild.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.close
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.export
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.closings.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.closings.export
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.customer_exclusions.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.customer_exclusions.manage
- … +14 omitidos

### CONTRACT_ISSUE (1)
- **error**: sortOrder 34 duplicado sob commercial: commercial.sales_orders e commercial.price_table

### FE_BE_GUARD_STYLE_MISMATCH (1)
- **warn**: Backend referencia settings.nomus.sync e settings.view (possível OR largo em sync).

### MUTATION_AUTH_ONLY (37)
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/market-intelligence/commodities/brent/collect
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PATCH /api/crm/customers/:customerId/commercial-owner
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/employees/:id/link-user
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/employees/:id/unlink-user
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/finance/suppliers/:id
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): POST /api/fleet/admin/reservations-cleanup
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/market-intelligence/global-indicators/refresh
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PATCH /api/materials/market-intelligence/:materialId/quotes/:quoteId
- **warn**: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/materials/market-intelligence/:materialId/quotes/:quoteId
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/materials/market-intelligence/:materialId/quotes/:quoteId/submit-approval
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/materials/market-intelligence/:materialId/quotes/:quoteId/approve
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/materials/market-intelligence/:materialId/quotes/:quoteId/reject
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/materials/market-intelligence/:materialId/quotes/:quoteId/set-official
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/projects/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/market-intelligence/ptax/collect
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PATCH /api/commercial/sales-order-flow/:salesOrderId/management
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/commercial/sales-order-flow/:salesOrderId/recompute
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): POST /api/admin/users/bootstrap-super-admin
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/machines
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PUT /api/machines/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/machines/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/employees
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PUT /api/employees/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/employees/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/cost-centers
- … +12 omitidos

### SIDEBAR_WITHOUT_CONTRACT (1)
- **error**: Módulo sidebar sem recurso canônico (moduleId): org-chart

### TAB_WITHOUT_CONTRACT (4)
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: overview
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: balances
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: reservations
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: audit

## Catálogo sem uso literal (amostra)
- `reports.material_demand.view`
- `finance.reports.view`
- `finance.suppliers.service_termination.update`
- `finance.suppliers.service_termination.cancel`
- `suppliers.serviceTermination.update`
- `suppliers.serviceTermination.cancel`
- `commercial.view`
- `crm.activities.create`
- `crm.activities.edit`
- `crm.profile.edit`
- `crm.customers.assign_seller`
- `customers.commercial360.view`
- `proposals.material_report.view`
- `sales_orders.flow.values.view`
- `sales_orders.flow.financial.view`
- `sales_orders.flow.inconsistencies.view`
- `sales_orders.flow.timeline.view`
- `sales_orders.flow_management.manage`
- `sales_orders.flow_management.priority.manage`
- `sales_orders.flow_management.responsibility.manage`
- `sales_orders.flow_management.blocking.manage`
- `sales_orders.flow.rebuild.execute`
- `output_documents.detail.view`
- `products.tab.routing`
- `purchases.indicators.view`
- `taxes.edit`
- `finance.tax_apuration.view`
- `finance.tax_apuration.manage`
- `finance.tax_allocation.manage`
- `engineering.view`
- `materials.market_intelligence.view`
- `materials.market_intelligence.home.view`
- `materials.market_intelligence.material_360.view`
- `materials.market_intelligence.quotes.view`
- `transformation_simulator.view`
- `finance.accountsReceivable.sync`
- `finance.accountsPayable.sync`
- `finance.billing.sync`
- `materials.market_quote.manual_exchange`
- `opex.edit`
- … +53

_Sem dados sensíveis (sem emails, tokens ou conteúdo de produção)._
