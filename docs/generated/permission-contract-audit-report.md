# Relatório — validador automático de permissões

| | |
|---|---|
| Gerado em | 2026-07-15T12:12:33.694Z |
| Modo | strict |
| OK (modo) | sim |
| Catálogo | 175 |
| Contrato | 76 |
| Seed relacional | 45 |
| Uso FE (chaves) | 32 |
| Uso BE (chaves) | 112 |
| Rotas escaneadas | 716 |
| Findings | error 2 · warn 10 · info 80 |
| Known gaps | 89 |
| Erros acionáveis | 0 |

## Limitações
- Scan AST não resolve spreads de constantes importadas de outros arquivos.
- Guards fleet/custom (createFleetRouteGuards) e checks inline em handlers não contam como permissionKeys.
- Botões sensíveis sem hasPermission exigem heurística UI — não classificados como erro automático nesta versão.
- Rotas registradas via wrappers (registerXRoutes) são cobertas se o arquivo *Routes.ts usa app/router.METHOD.
- CATALOG_NEVER_USED ignora uso indireto via arrays tipados sem literal no call site.

## Fantasmas (usado ∉ catálogo)
- `finance.executiveReport.view`

## Findings (agrupados)
### CATALOG_NEVER_USED (61)
- **info** _(known)_: Chave no catálogo sem uso literal detectado: reports.material_demand.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.seller.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.customers.assign_seller
- **info** _(known)_: Chave no catálogo sem uso literal detectado: proposals.material_report.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: sales_orders.invoice.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: products.tab.routing
- **info** _(known)_: Chave no catálogo sem uso literal detectado: purchases.indicators.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: operations.component-performance.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: operations.component-performance.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_quote.manual_exchange
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_quote.approve
- **info** _(known)_: Chave no catálogo sem uso literal detectado: settings.branding.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.dashboard.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.reports.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.vehicles.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.vehicles.create
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.vehicles.edit
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.vehicles.status.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.contracts.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.contracts.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.documents.view
- … +36 omitidos

### CONTRACT_ACTION_UNUSED (19)
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.products.tab.routing.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.materials.market_intelligence.quotes.approve
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.materials.market_intelligence.quotes.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.assign_seller.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.sales_orders.invoice.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.close
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.monthly_closing.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.customer_exclusions.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.reprocess.reprocess
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.commissions.reprocess.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.suppliers.service_termination.update
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: finance.suppliers.service_termination.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.items.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.warehouses.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.movements.create
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.counts.manage
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.inventory.counts.approve
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: operations.performance.update

### FE_BE_GUARD_STYLE_MISMATCH (1)
- **warn** _(known)_: Backend referencia settings.nomus.sync e settings.view (possível OR largo em sync).

### MUTATION_AUTH_ONLY (5)
- **warn**: Mutação só com auth (sem permissão/resource no middleware): PATCH /api/crm/customers/:customerId/commercial-owner
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/finance/suppliers/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/fleet/admin/reservations-cleanup
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/projects/:id
- **warn**: Mutação só com auth (sem permissão/resource no middleware): POST /api/admin/users/bootstrap-super-admin

### MUTATION_WITHOUT_PERMISSION_GUARD (1)
- **error** _(known)_: Endpoint sensível sem guard: GET /api/test-db

### TAB_WITHOUT_CONTRACT (4)
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: overview
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: balances
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: reservations
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: audit

### USED_NOT_IN_CATALOG (1)
- **error** _(known)_: Permissão usada e não cadastrada no PERMISSION_CATALOG: finance.executiveReport.view

## Catálogo sem uso literal (amostra)
- `reports.material_demand.view`
- `finance.suppliers.service_termination.update`
- `finance.suppliers.service_termination.cancel`
- `suppliers.serviceTermination.update`
- `suppliers.serviceTermination.cancel`
- `crm.seller.view`
- `crm.customers.assign_seller`
- `proposals.material_report.view`
- `sales_orders.invoice.view`
- `products.tab.routing`
- `purchases.indicators.view`
- `operations.component-performance.view`
- `operations.component-performance.edit`
- `materials.market_quote.manual_exchange`
- `materials.market_quote.approve`
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
- `fleet.drivers.manage`
- `fleet.reservations.view`
- `fleet.reservations.create`
- `fleet.reservations.approve`
- `fleet.reservations.manage`
- `fleet.usage.checkout`
- `fleet.usage.checkin`
- `fleet.maintenance.view`
- `fleet.maintenance.manage`
- `fleet.costs.view`
- `fleet.costs.manage`
- `fleet.financial.view`
- `fleet.settings.manage`
- … +21

_Sem dados sensíveis (sem emails, tokens ou conteúdo de produção)._
