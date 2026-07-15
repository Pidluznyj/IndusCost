# Dual-write — relatório de compatibilidade (Prompt 06)

| | |
|---|---|
| **Gerado** | 2026-07-15T12:25:09.595Z |
| **Fixtures** | 9 |
| **All compatible** | yes |
| **Alias collisions** | 16 |
| **Catalog keys sem alias estrutural** | 136 |

Modo compatível: legado→estrutura→legado não perde chaves mapeadas nem unmapped de catálogo. Backfill não executado.

## Fixtures

| id | role | legado RT | estruturado RT | lost mapped | gained | preserved unmapped |
|----|------|-----------|----------------|-------------|---------|--------------------|
| role-preset-VIEWER | VIEWER | true | true | 0 | 0 | 0 |
| role-preset-SELLER | SELLER | true | true | 0 | 0 | 0 |
| role-preset-COMMERCIAL_MANAGER | COMMERCIAL_MANAGER | true | true | 0 | 0 | 0 |
| role-preset-ADMIN | ADMIN | true | true | 0 | 0 | 0 |
| fic-viewer-minimal | VIEWER | true | — | 0 | 0 | 0 |
| fic-seller-crm | SELLER | true | — | 0 | 0 | 0 |
| fic-with-unmapped-catalog | VIEWER | true | — | 0 | 0 | 2 |
| fic-admin-users-manage | ADMIN | true | — | 0 | 0 | 0 |
| fic-empty | VIEWER | true | — | 0 | 0 | 0 |

## Colisões de alias (1 legado → N resources)

- `commissions.audit.view` → `comissoes.tab.auditoria`, `comissoes.tab.fechamentos`, `comissoes.tab.relatorios`, `comissoes.tab.reprocessar`
- `commissions.dashboard.view` → `comissoes.tab.dashboard`, `comissoes.tab.fechamento_mes`, `comissoes.tab.fechamentos`, `comissoes.tab.relatorios`
- `commissions.payments.view` → `comissoes.tab.fechamento_mes`, `comissoes.tab.fechamentos`, `comissoes.tab.pagamentos`
- `commissions.release.view` → `comissoes.tab.fechamento_mes`, `comissoes.tab.liberacao`
- `commissions.rules.view` → `comissoes.tab.excecoes_cliente`, `comissoes.tab.regras`
- `commissions.view` → `comissoes`, `comissoes.tab.auditoria`, `comissoes.tab.configuracoes`, `comissoes.tab.confirmadas`, `comissoes.tab.dashboard`, `comissoes.tab.excecoes_cliente`, `comissoes.tab.fechamento_mes`, `comissoes.tab.fechamentos`, `comissoes.tab.liberacao`, `comissoes.tab.pagamentos`, `comissoes.tab.pessoas`, `comissoes.tab.previstas`, `comissoes.tab.regras`, `comissoes.tab.relatorios`, `comissoes.tab.reprocessar`
- `costs.view` → `suprimentos`, `suprimentos.tab.catalogo`
- `crm.general.view` → `comercial.crm`, `comercial.crm.tab.carteira_clientes`, `comercial.crm.tab.gestao_geral`
- `crm.seller.all` → `comercial.crm.tab.carteira_clientes`, `comercial.crm.tab.gestao_vendedor`
- `crm.seller.own` → `comercial.crm.tab.carteira_clientes`, `comercial.crm.tab.gestao_vendedor`
- `crm.seller.view` → `comercial.crm`, `comercial.crm.tab.gestao_vendedor`
- `crm.view` → `comercial`, `comercial.crm`, `comercial.crm.tab.carteira_clientes`
- `materials.market_quote.approve` → `suprimentos.inteligencia_mercado`, `suprimentos.inteligencia_mercado.tab.configuracoes`
- `materials.market_quote.manual_exchange` → `suprimentos.inteligencia_mercado`, `suprimentos.inteligencia_mercado.tab.configuracoes`
- `materials.view` → `suprimentos`, `suprimentos.inteligencia_mercado`, `suprimentos.inteligencia_mercado.tab.alertas`, `suprimentos.inteligencia_mercado.tab.configuracoes`, `suprimentos.inteligencia_mercado.tab.fornecedores`, `suprimentos.inteligencia_mercado.tab.home`, `suprimentos.inteligencia_mercado.tab.materia_prima_360`, `suprimentos.tab.catalogo`
- `sales_orders.view` → `comercial`, `comercial.pedidos_venda`

## Permissões de catálogo sem mapeamento estrutural (amostra)

- `commissions.people.manage`
- `commissions.release.manage`
- `commissions.seller.all`
- `commissions.seller.own`
- `crm.activities.create`
- `crm.activities.edit`
- `crm.customers.assign_seller`
- `crm.profile.edit`
- `customers.create`
- `customers.edit`
- `employees.edit`
- `employees.view`
- `finance.accountsPayable.export`
- `finance.accountsReceivable.export`
- `finance.ap_allocations.apply_batch`
- `finance.ap_allocations.manage`
- `finance.ap_allocations.view`
- `finance.cost_center_audit.view`
- `finance.cost_center_rules.manage`
- `finance.cost_center_rules.view`
- `finance.cost_centers.manage`
- `finance.cost_centers.view`
- `finance.suppliers.manage`
- `finance.suppliers.service_termination.cancel`
- `finance.suppliers.service_termination.create`
- `finance.suppliers.service_termination.export`
- `finance.suppliers.service_termination.finalize`
- `finance.suppliers.service_termination.update`
- `finance.suppliers.service_termination.view`
- `finance.suppliers.view`
- `fleet.contracts.manage`
- `fleet.contracts.view`
- `fleet.costs.manage`
- `fleet.costs.view`
- `fleet.dashboard.view`
- `fleet.documents.manage`
- `fleet.documents.view`
- `fleet.drivers.manage`
- `fleet.drivers.view`
- `fleet.financial.view`
- `fleet.maintenance.manage`
- `fleet.maintenance.view`
- `fleet.manage`
- `fleet.reports.view`
- `fleet.reservations.approve`
- `fleet.reservations.create`
- `fleet.reservations.manage`
- `fleet.reservations.view`
- `fleet.settings.manage`
- `fleet.usage.checkin`
- `fleet.usage.checkout`
- `fleet.vehicles.create`
- `fleet.vehicles.edit`
- `fleet.vehicles.status.manage`
- `fleet.vehicles.view`
- `fleet.view`
- `guide.view`
- `inventory.adjustment.create`
- `inventory.audit.view`
- `inventory.block.manage`
- `inventory.count.approve`
- `inventory.count.manage`
- `inventory.export`
- `inventory.item.manage`
- `inventory.manage`
- `inventory.movement.create`
- `inventory.movements.create`
- `inventory.movements.override`
- `inventory.reservation.manage`
- `inventory.reservations.manage`
- `inventory.transfer.create`
- `inventory.view`
- `inventory.warehouse.manage`
- `machines.edit`
- `machines.view`
- `maintenance.manage`
- `maintenance.view`
- `operations.component-performance.edit`
- `operations.component-performance.view`
- `opex.edit`
- `opex.view`
- `pricing.generate_tables`
- `pricing.publish_tables`
- `pricing.simulate`
- `pricing.view`
- `products.create`
- `products.delete`
- `products.edit`
- `products.export.engineering`
- `products.tab.bom`
- `products.tab.composition`
- `products.tab.cost`
- `products.tab.info`
- `products.tab.routing`
- `products.tab.tree`
- `products.view`
- `projects.approve`
- `projects.convert`
- `projects.manage`
- `projects.view`
- … +36 restantes

## Produção

**Não** executar backfill apply em produção neste prompt.
