# Relatório — validador automático de permissões

| | |
|---|---|
| Gerado em | 2026-07-17T01:00:21.388Z |
| Modo | report |
| OK (modo) | sim |
| Catálogo | 204 |
| Contrato | 84 |
| Seed relacional | 128 |
| Uso FE (chaves) | 36 |
| Uso BE (chaves) | 127 |
| Rotas escaneadas | 760 |
| Findings | error 0 · warn 38 · info 95 |
| Known gaps | 103 |
| Erros acionáveis | 0 |

## Limitações
- Scan AST não resolve spreads de constantes importadas de outros arquivos.
- Guards fleet/custom (createFleetRouteGuards) e checks inline em handlers não contam como permissionKeys.
- Botões sensíveis sem hasPermission exigem heurística UI — não classificados como erro automático nesta versão.
- Rotas registradas via wrappers (registerXRoutes) são cobertas se o arquivo *Routes.ts usa app/router.METHOD.
- CATALOG_NEVER_USED ignora uso indireto via arrays tipados sem literal no call site.

## Fantasmas (usado ∉ catálogo)
_Nenhum._

## Findings (agrupados)
### CATALOG_NEVER_USED (74)
- **info** _(known)_: Chave no catálogo sem uso literal detectado: reports.material_demand.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.reports.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.activities.create
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.activities.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.profile.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.customers.assign_seller
- **info** _(known)_: Chave no catálogo sem uso literal detectado: proposals.material_report.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: products.tab.routing
- **info** _(known)_: Chave no catálogo sem uso literal detectado: purchases.indicators.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: taxes.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.tax_apuration.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.tax_apuration.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.tax_allocation.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: engineering.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_intelligence.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_intelligence.home.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_intelligence.material_360.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_intelligence.quotes.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: transformation_simulator.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.accountsReceivable.sync
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.accountsPayable.sync
- … +49 omitidos

### CONTRACT_ACTION_UNUSED (21)
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.products.tab.routing.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.materials.market_intelligence.quotes.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.activities.create
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.activities.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.assign_seller.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.close
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.customer_exclusions.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.reprocess.reprocess
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.reprocess.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.opex.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.taxes.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.tax_apuration.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.tax_apuration.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.items.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.warehouses.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.movements.create
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.counts.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.counts.approve

### FE_BE_GUARD_STYLE_MISMATCH (1)
- **warn**: Backend referencia settings.nomus.sync e settings.view (possível OR largo em sync).

### MUTATION_AUTH_ONLY (33)
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
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): POST /api/admin/users/bootstrap-super-admin
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/machines
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PUT /api/machines/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/machines/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/employees
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PUT /api/employees/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/employees/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/cost-centers
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PATCH /api/cost-centers/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/purchase-requests
- … +8 omitidos

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
- `crm.activities.create`
- `crm.activities.edit`
- `crm.profile.edit`
- `crm.customers.assign_seller`
- `proposals.material_report.view`
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
- `settings.branding.edit`
- `fleet.dashboard.view`
- `fleet.reports.view`
- `fleet.vehicles.view`
- `fleet.vehicles.create`
- `fleet.vehicles.edit`
- `fleet.vehicles.status.manage`
- `fleet.contracts.view`
- `fleet.contracts.manage`
- `fleet.documents.view`
- `fleet.documents.manage`
- `fleet.drivers.view`
- … +34

_Sem dados sensíveis (sem emails, tokens ou conteúdo de produção)._
