# Relatório — seed catálogo hierárquico (contrato)

| dryRun | true |
| create | 126 |
| update | 0 |
| unchanged | 0 |
| retain legacy | 0 |

Somente PermissionResource. Não altera RolePermission, UserPermissionOverride, AppUser.permissions nem AccessProfile.

## Issues do plano (não bloqueantes, se passou assert)
- `ALIAS_HIGH_FANOUT`: costs.view → 8 resources
- `ALIAS_HIGH_FANOUT`: materials.view → 13 resources
- `ALIAS_HIGH_FANOUT`: commissions.view → 22 resources
- `ALIAS_HIGH_FANOUT`: crm.view → 6 resources
- `ALIAS_HIGH_FANOUT`: sales_orders.view → 7 resources
- `ALIAS_HIGH_FANOUT`: crm.general.view → 6 resources
- `ALIAS_HIGH_FANOUT`: crm.seller.all → 5 resources
- `ALIAS_HIGH_FANOUT`: crm.seller.own → 5 resources
- `ALIAS_HIGH_FANOUT`: commissions.audit.view → 5 resources
- `ALIAS_HIGH_FANOUT`: commissions.dashboard.view → 5 resources
- `ALIAS_HIGH_FANOUT`: finance.view → 11 resources
- `ALIAS_HIGH_FANOUT`: finance.accountsPayable.view → 5 resources
- `ALIAS_HIGH_FANOUT`: finance.accountsReceivable.view → 5 resources
- `ALIAS_HIGH_FANOUT`: reports.view → 5 resources
- `ALIAS_HIGH_FANOUT`: inventory.view → 6 resources
- `ALIAS_HIGH_FANOUT`: inventory.manage → 5 resources
- `ALIAS_HIGH_FANOUT`: settings.view → 9 resources
- `ALIAS_HIGH_FANOUT`: users.manage → 8 resources
- `ALIAS_HIGH_FANOUT`: employees.edit → 7 resources

## CREATE (126)
- `dashboard` (canonical_contract)
- `engineering` (canonical_contract)
- `commercial` (canonical_contract)
- `finance` (canonical_contract)
- `operations` (canonical_contract)
- `admin` (canonical_contract)
- `financeiro` (legacy_pt_seed)
- `comercial` (legacy_pt_seed)
- `suprimentos` (legacy_pt_seed)
- `configuracoes` (legacy_pt_seed)
- `engineering.products` (canonical_contract)
- `engineering.transformation_simulator` (canonical_contract)
- `engineering.materials` (canonical_contract)
- `engineering.simulations` (canonical_contract)
- `engineering.projects` (canonical_contract)
- `commercial.crm` (canonical_contract)
- `commercial.customers` (canonical_contract)
- `commercial.proposals` (canonical_contract)
- `commercial.sales_orders` (canonical_contract)
- `commercial.pricing` (canonical_contract)
- `commercial.commissions` (canonical_contract)
- `finance.cash_flow` (canonical_contract)
- `finance.accounts_receivable` (canonical_contract)
- `finance.accounts_payable` (canonical_contract)
- `finance.billing` (canonical_contract)
- `finance.sales_orders` (canonical_contract)
- `finance.cost_centers` (canonical_contract)
- `finance.executive_report` (canonical_contract)
- `finance.suppliers` (canonical_contract)
- `finance.portfolio_reconciliation` (canonical_contract)
- `finance.opex` (canonical_contract)
- `finance.taxes` (canonical_contract)
- `finance.reports` (canonical_contract)
- `operations.inventory` (canonical_contract)
- `operations.purchases` (canonical_contract)
- `operations.machines` (canonical_contract)
- `operations.performance` (canonical_contract)
- `operations.maintenance` (canonical_contract)
- `operations.fleet` (canonical_contract)
- `admin.employees` (canonical_contract)
- `admin.settings` (canonical_contract)
- `admin.guide` (canonical_contract)
- `financeiro.conciliacao_carteira` (legacy_pt_seed)
- `financeiro.contas_receber` (legacy_pt_seed)
- `financeiro.contas_pagar` (legacy_pt_seed)
- `financeiro.fluxo_caixa` (legacy_pt_seed)
- `financeiro.relatorio_presidencial` (legacy_pt_seed)
- `comercial.pedidos_venda` (legacy_pt_seed)
- `comercial.crm` (legacy_pt_seed)
- `comissoes` (legacy_pt_seed)
- `suprimentos.tab.catalogo` (legacy_pt_seed)
- `suprimentos.inteligencia_mercado` (legacy_pt_seed)
- `admin.usuarios` (legacy_pt_seed)
- `admin.permissoes` (legacy_pt_seed)
- `engineering.products.tab.info` (canonical_contract)
- `engineering.products.tab.bom` (canonical_contract)
- `engineering.products.tab.routing` (canonical_contract)
- `engineering.products.tab.tree` (canonical_contract)
- `engineering.products.tab.cost` (canonical_contract)
- `engineering.products.tab.composition` (canonical_contract)
- `engineering.materials.market_intelligence` (canonical_contract)
- `engineering.projects.detail` (canonical_contract)
- `commercial.crm.general` (canonical_contract)
- `commercial.crm.seller` (canonical_contract)
- `commercial.crm.portfolio` (canonical_contract)
- `commercial.crm.activities` (canonical_contract)
- `commercial.crm.assign_seller` (canonical_contract)
- `commercial.proposals.indicators` (canonical_contract)
- `commercial.sales_orders.detail` (canonical_contract)
- `commercial.sales_orders.invoice` (canonical_contract)
- `commercial.commissions.monthly_closing` (canonical_contract)
- `commercial.commissions.closings` (canonical_contract)
- `commercial.commissions.customer_exclusions` (canonical_contract)
- `commercial.commissions.reports` (canonical_contract)
- `commercial.commissions.reprocess` (canonical_contract)
- `finance.suppliers.service_termination` (canonical_contract)
- `finance.portfolio_reconciliation.order_status` (canonical_contract)
- `finance.portfolio_reconciliation.order_to_cash_audit` (canonical_contract)
- `operations.inventory.items` (canonical_contract)
- `operations.inventory.warehouses` (canonical_contract)
- … +46

## UPDATE (0)
