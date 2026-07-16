# Backlog — migração `requireResource` (P14+)

Guard oficial: `requireResource(resourceKey, action)` → `resolveEffectiveAccess`.

## Migrado em P16 — Máquinas + Operações prioritárias

Ver `operationsAccess.ts` / `OPERATIONS_PILOT_ENDPOINTS`:

| resourceKey | actions | superfície |
|-------------|---------|------------|
| `operations.machines` | view, update | `/api/machines*` (POST/DELETE → update) |
| `operations.inventory*` | view, create, manage, approve | `/api/inventory*` |
| `operations.purchases` | view, create, update | purchase-requests + cost-centers |
| `operations.performance` | view, update | `/api/operations/performance*` |
| `operations.maintenance` | view, manage | `/api/maintenance-requests*` |
| `operations.fleet` | view, manage | gate canônico + `fleetRouteGuards` granulares |

`costs.view` e chaves financeiras **não** abrem Operações/Máquinas.

## Migrado em P15 — Pessoas / RH

`admin.employees*` via `requireResource` (ver `employeesAccess.ts` / `EMPLOYEES_PILOT_ENDPOINTS`):

| resourceKey | actions | superfície |
|-------------|---------|------------|
| `admin.employees` | view, create, update | listagem, ficha CRUD, status, lookups, people search/resolve |
| `admin.employees.personal_data` | view | redaction / aba dados pessoais |
| `admin.employees.administrative_data` | view | redaction / aba administrativo |
| `admin.employees.sensitive_data` | view | emergência / compensação |
| `admin.employees.links` | view, manage | system-links, person-link, preview |
| `admin.employees.user_link` | manage | link/unlink AppUser |
| `admin.employees.epi` | manage | EPI |

`costs.view` e chaves financeiras **não** abrem RH.

## Migrado em P17 — Financeiro (exceto AP P18)

`financeModulesAccess.ts` / `FINANCE_MODULE_PILOT_ENDPOINTS`:

| resourceKey | actions | superfície |
|-------------|---------|------------|
| `finance` | view | Home `/finance` |
| `finance.cash_flow` | view | cash-flow dashboard/export |
| `finance.accounts_receivable` | view, export, execute | AR + due-radar |
| `finance.billing` | view, export, execute | faturamento / sync |
| `finance.sales_orders` | view | pedidos financeiro |
| `finance.cost_centers` | view, manage | CC + regras/reclass |
| `finance.executive_report` | view | Relatório Presidencial |
| `finance.suppliers` | view, manage | fornecedores |
| `finance.portfolio_reconciliation` (+ order_status, order_to_cash_audit) | view | conciliação / inteligência / status / Pedido→Caixa |
| `finance.opex` | view, update | `/api/indirect-costs` |
| `finance.taxes` / `finance.tax_apuration` | view, update, manage | tax-rules + fiscal settlements |
| `finance.reports` | view | `/api/reports/data` |

`finance.view` **não** abre filhos via `requireResource` (secundário nos filhos; canônico só em `finance`). Conciliação **não** aceita `finance.accountsPayable.view`. Aliases 1:1: `finance.cashFlow.view`, `finance.billing.view`, `finance.salesOrders.view`, `finance.executiveReport.view`, `finance.reports.view`.

## Migrado em P18 — Contas a Pagar (piloto módulo)

`finance.accounts_payable` via `requireResource`:

| action | endpoints |
|--------|-----------|
| view | dashboard, titles, classification GET, due-radar, classification-summary, unclassified, nomus summary, sync status |
| export | `/export`, due-radar export-data/xlsx |
| manage | classify-batch-*, cost-center-allocation/reclassification |
| execute | sync accounts-payable-run |

Ver `financeAccountsPayableAccess.ts` / `FINANCE_AP_PILOT_ENDPOINTS`.

## Migrado em P14 (piloto)

| Endpoint / superfície | resourceKey | action |
|----------------------|-------------|--------|
| `GET/POST/PATCH/DELETE /api/admin/users*` | `admin.settings.security` | view/manage |
| `GET /api/admin/eligible-employees` | `admin.settings.security` | manage |
| `GET /api/admin/seller-options` | `admin.settings.security` | view |
| `GET /api/admin/permissions/catalog` | `admin.settings.security` | manage |
| `GET/PUT/DELETE …/permission-overrides*` | `admin.settings.security` | manage |
| `GET …/permission-audit` | `admin.settings.security` | manage |
| `GET/POST …/access-profiles*` | `admin.settings.security` | view/manage |

Wrappers: `requireUsersOrPermissionsAdmin`, `requireUsersViewOrBootstrap`, `requireUsersManageOrBootstrap`, `requirePermissionsAdminOrBootstrap`, `requireUserAdminOrBootstrap`.

## Migrado em P19 — Comercial / Engenharia / Administração

| área | resourceKeys | superfície |
|------|--------------|------------|
| Comercial | `commercial.*` (CRM, customers, proposals, sales_orders, pricing, commissions+tabs) | APIs + commissionsRoutes |
| Engenharia | `engineering.*` (products, materials/MI, simulations, projects, transformation_simulator) | APIs + projectsRoutes |
| Admin settings | `admin.settings.*` + `admin.guide` | globals/branding/Nomus/ops/price-tables |

Ações especiais: commissions `close`/`reprocess`, pricing `execute`/`manage`, MI `approve`, Nomus `execute`.

## Ainda legado (prompts de módulo)

Ver `REQUIRE_RESOURCE_LEGACY_BACKLOG` em `src/lib/security/requireResource.ts`:

- **P19+** materials, products
- **P18+** commissions, sales-orders (módulo comercial), other nomus sync, dashboard
