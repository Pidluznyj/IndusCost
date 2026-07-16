# Relatório — consistência de permissões (P02)

| | |
|---|---|
| Gerado | 2026-07-16T13:05:54.265Z |
| Modo | report |
| OK | sim |
| Novos gaps | 0 |
| Baselined | 150 |
| Stale baseline | 0 |

## Fontes
- Contrato: 82
- Seed: 56
- Frontend: 77
- Catálogo legado: 187

## Novos gaps
_Nenhum._

## Baseline (amostra)
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.administrative_data`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.epi`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.links`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.personal_data`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.sensitive_data`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.employees.user_link`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.guide`
- `FE_RESOURCE_MISSING_FROM_SEED` / `admin.settings`
- `FE_RESOURCE_MISSING_FROM_SEED` / `commercial.customers`
- `FE_RESOURCE_MISSING_FROM_SEED` / `commercial.pricing`
- `FE_RESOURCE_MISSING_FROM_SEED` / `commercial.proposals`
- `FE_RESOURCE_MISSING_FROM_SEED` / `commercial.proposals.indicators`
- `FE_RESOURCE_MISSING_FROM_SEED` / `configuracoes`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.bom`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.composition`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.cost`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.info`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.routing`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.products.tab.tree`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.projects`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.simulations`
- `FE_RESOURCE_MISSING_FROM_SEED` / `engineering.transformation_simulator`
- `FE_RESOURCE_MISSING_FROM_CONTRACT` / `configuracoes`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.auditoria`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.configuracoes`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.confirmadas`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.dashboard`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.liberacao`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.pagamentos`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.pessoas`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.previstas`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `comissoes.tab.regras`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `financeiro.conciliacao_carteira.tab.conciliacao`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `financeiro.conciliacao_carteira.tab.inteligencia`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `suprimentos.inteligencia_mercado.tab.alertas`
- `SEED_RESOURCE_MISSING_FROM_CONTRACT` / `suprimentos.inteligencia_mercado.tab.configuracoes`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `settings:configuracoes`
- `SIDEBAR_RESOURCE_MISSING_FROM_CONTRACT` / `settings:configuracoes`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `customers:commercial.customers`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `proposals:commercial.proposals`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `pricing:commercial.pricing`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `products:engineering.products`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `transformation-simulator:engineering.transformation_simulator`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `simulations:engineering.simulations`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `projects:engineering.projects`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `employees:admin.employees`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `guide:admin.guide`
- `SIDEBAR_RESOURCE_MISSING_FROM_SEED` / `group:engenharia:engineering`
- `SIDEBAR_MODULE_WITHOUT_RESOURCE` / `opex`
- `PRIVATE_ROUTE_WITHOUT_RESOURCE` / `/opex`
- `SIDEBAR_MODULE_WITHOUT_RESOURCE` / `taxes`
- `PRIVATE_ROUTE_WITHOUT_RESOURCE` / `/taxes`
- `SIDEBAR_MODULE_WITHOUT_RESOURCE` / `reports`
- `PRIVATE_ROUTE_WITHOUT_RESOURCE` / `/reports`
- `SIDEBAR_MODULE_WITHOUT_RESOURCE` / `suppliers`
- `PRIVATE_ROUTE_WITHOUT_RESOURCE` / `/finance/suppliers`
- `RESOURCE_REGISTERED_NEVER_USED` / `engineering.projects.detail`
- … +90

## Limitações
- Baseline temporário documenta gaps históricos; strict só falha em findings novos (code+subject).
- Scan de mutações reutiliza permissionAudit (AST); wrappers dinâmicos podem escapar.
- Abas financeiras usam heurística de mapeamento id → resourceKey.
- RESOURCE_REGISTERED_NEVER_USED ignora uso só via strings dinâmicas.
- Não acessa banco nem produção; AppUser.permissions[] não é lido.
