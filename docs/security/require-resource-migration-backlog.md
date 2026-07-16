# Backlog — migração `requireResource` (P14+)

Guard oficial: `requireResource(resourceKey, action)` → `resolveEffectiveAccess`.

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

## Ainda legado (prompts de módulo)

Ver `REQUIRE_RESOURCE_LEGACY_BACKLOG` em `src/lib/security/requireResource.ts`:

- **P16** machines
- **P17+** materials, products
- **P18+** AR, commissions, sales-orders, other nomus sync, portfolio, dashboard
