# Relatório — validador automático de permissões

| | |
|---|---|
| Gerado em | 2026-07-15T21:06:46.874Z |
| Modo | report |
| OK (modo) | sim |
| Catálogo | 187 |
| Contrato | 82 |
| Seed relacional | 45 |
| Uso FE (chaves) | 40 |
| Uso BE (chaves) | 128 |
| Rotas escaneadas | 742 |
| Findings | error 0 · warn 9 · info 72 |
| Known gaps | 80 |
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
### CATALOG_NEVER_USED (56)
- **info** _(known)_: Chave no catálogo sem uso literal detectado: reports.material_demand.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: finance.suppliers.service_termination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.update
- **info** _(known)_: Chave no catálogo sem uso literal detectado: suppliers.serviceTermination.cancel
- **info** _(known)_: Chave no catálogo sem uso literal detectado: crm.customers.assign_seller
- **info** _(known)_: Chave no catálogo sem uso literal detectado: proposals.material_report.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: products.tab.routing
- **info** _(known)_: Chave no catálogo sem uso literal detectado: purchases.indicators.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: materials.market_quote.manual_exchange
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
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.documents.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.drivers.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.drivers.manage
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.reservations.view
- **info** _(known)_: Chave no catálogo sem uso literal detectado: fleet.reservations.create
- … +31 omitidos

### CONTRACT_ACTION_UNUSED (16)
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.products.tab.routing.view
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: engineering.materials.market_intelligence.quotes.execute
- **info** _(known)_: Ação do contrato sem uso literal das legacy keys: commercial.crm.assign_seller.manage
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

### FE_BE_GUARD_STYLE_MISMATCH (1)
- **warn**: Backend referencia settings.nomus.sync e settings.view (possível OR largo em sync).

### MUTATION_AUTH_ONLY (4)
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/finance/suppliers/:id
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): POST /api/fleet/admin/reservations-cleanup
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): DELETE /api/projects/:id
- **warn** _(known)_: Mutação só com auth (sem permissão/resource no middleware): POST /api/admin/users/bootstrap-super-admin

### TAB_WITHOUT_CONTRACT (4)
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: overview
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: balances
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: reservations
- **warn** _(known)_: Aba de estoque sem recurso canônico dedicado: audit

## Catálogo sem uso literal (amostra)
- `reports.material_demand.view`
- `finance.suppliers.service_termination.update`
- `finance.suppliers.service_termination.cancel`
- `suppliers.serviceTermination.update`
- `suppliers.serviceTermination.cancel`
- `crm.customers.assign_seller`
- `proposals.material_report.view`
- `products.tab.routing`
- `purchases.indicators.view`
- `materials.market_quote.manual_exchange`
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
- `inventory.manage`
- `inventory.item.manage`
- `inventory.warehouse.manage`
- `inventory.movements.create`
- `inventory.movement.create`
- … +16

_Sem dados sensíveis (sem emails, tokens ou conteúdo de produção)._
