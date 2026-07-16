# Relatório — consistência de permissões (P02)

| | |
|---|---|
| Gerado | 2026-07-16T16:03:02.878Z |
| Modo | strict |
| OK | sim |
| Novos gaps | 0 |
| Baselined | 72 |
| Stale baseline | 0 |

## Fontes
- Contrato: 83
- Seed: 127
- Frontend: 83
- Catálogo legado: 190

## Novos gaps
_Nenhum._

## Baseline (amostra)
- `FE_BE_KEY_MISMATCH` / `configuracoes|admin.settings`
- `ALIAS_WIDE` / `accessProfiles.view`
- `ALIAS_WIDE` / `commissions.audit.view`
- `ALIAS_WIDE` / `commissions.dashboard.view`
- `ALIAS_WIDE` / `commissions.payments.view`
- `ALIAS_WIDE` / `commissions.release.view`
- `ALIAS_WIDE` / `commissions.rules.view`
- `ALIAS_WIDE` / `commissions.view`
- `ALIAS_WIDE` / `crm.general.view`
- `ALIAS_WIDE` / `crm.seller.all`
- `ALIAS_WIDE` / `crm.seller.own`
- `ALIAS_WIDE` / `crm.seller.view`
- `ALIAS_WIDE` / `crm.view`
- `ALIAS_WIDE` / `customers.view`
- `ALIAS_WIDE` / `employees.edit`
- `ALIAS_WIDE` / `employees.view`
- `ALIAS_WIDE` / `finance.portfolioReconciliation.conciliation.view`
- `ALIAS_WIDE` / `finance.portfolioReconciliation.intelligence.view`
- `ALIAS_WIDE` / `finance.portfolioReconciliation.orderStatusPedidos.view`
- `ALIAS_WIDE` / `finance.portfolioReconciliation.orderToCashAudit.view`
- `ALIAS_WIDE` / `finance.view`
- `ALIAS_WIDE` / `fleet.view`
- `ALIAS_WIDE` / `inventory.view`
- `ALIAS_WIDE` / `machines.view`
- `ALIAS_WIDE` / `maintenance.view`
- `ALIAS_WIDE` / `materials.market_quote.approve`
- `ALIAS_WIDE` / `materials.market_quote.manual_exchange`
- `ALIAS_WIDE` / `materials.view`
- `ALIAS_WIDE` / `products.view`
- `ALIAS_WIDE` / `projects.view`
- `ALIAS_WIDE` / `purchases.view`
- `ALIAS_WIDE` / `reports.view`
- `ALIAS_WIDE` / `sales_orders.view`
- `ALIAS_WIDE` / `settings.view`
- `ALIAS_WIDE` / `simulations.view`
- `ALIAS_WIDE` / `users.manage`
- `ALIAS_DUPLICATE` / `contract:products.view`
- `ALIAS_DUPLICATE` / `contract:simulations.view`
- `ALIAS_DUPLICATE` / `contract:materials.view`
- `ALIAS_DUPLICATE` / `contract:materials.edit`
- `ALIAS_DUPLICATE` / `contract:projects.view`
- `ALIAS_DUPLICATE` / `contract:projects.manage`
- `ALIAS_DUPLICATE` / `contract:crm.view`
- `ALIAS_DUPLICATE` / `contract:sales_orders.view`
- `ALIAS_DUPLICATE` / `contract:proposals.view`
- `ALIAS_DUPLICATE` / `contract:customers.view`
- `ALIAS_DUPLICATE` / `contract:commissions.view`
- `ALIAS_DUPLICATE` / `contract:pricing.view`
- `ALIAS_DUPLICATE` / `contract:crm.general.view`
- `ALIAS_DUPLICATE` / `contract:crm.seller.view`
- `ALIAS_DUPLICATE` / `contract:crm.seller.own`
- `ALIAS_DUPLICATE` / `contract:crm.seller.all`
- `ALIAS_DUPLICATE` / `contract:pricing.publish_tables`
- `ALIAS_DUPLICATE` / `contract:commissions.payments.manage`
- `ALIAS_DUPLICATE` / `contract:commissions.rules.manage`
- `ALIAS_DUPLICATE` / `contract:finance.view`
- `ALIAS_DUPLICATE` / `contract:reports.view`
- `ALIAS_DUPLICATE` / `contract:settings.nomus.sync`
- `ALIAS_DUPLICATE` / `contract:taxes.view`
- `ALIAS_DUPLICATE` / `contract:finance.tax_apuration.view`
- … +12

## Limitações
- Baseline temporário documenta gaps históricos; strict só falha em findings novos (code+subject).
- Scan de mutações reutiliza permissionAudit (AST); wrappers dinâmicos podem escapar.
- Abas financeiras usam heurística de mapeamento id → resourceKey.
- RESOURCE_REGISTERED_NEVER_USED ignora uso só via strings dinâmicas.
- Não acessa banco nem produção; AppUser.permissions[] não é lido.
