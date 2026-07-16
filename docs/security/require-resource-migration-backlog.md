# Backlog — migração `requireResource` (P14+)

Guard oficial: `requireResource(resourceKey, action)` → `resolveEffectiveAccess`.

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
- **P18+** finance AP/AR export+sync, commissions close/reprocess, sales-orders export, nomus-sync, portfolio (seed `requireResourcePermission`), dashboard bag keys

Não converter tudo de uma vez — cada módulo troca listas `requirePermission("*.view")` / OR legado pelo contrato.
