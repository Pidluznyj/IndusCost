# Backlog — migração `requireResource` (P14+)

Guard oficial: `requireResource(resourceKey, action)` → `resolveEffectiveAccess`.

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

- **P15** employees / RH
- **P16** machines
- **P17+** materials, products
- **P18+** AR, commissions, sales-orders, other nomus sync, portfolio, dashboard
