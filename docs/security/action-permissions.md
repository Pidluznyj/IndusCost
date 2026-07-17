# Permissões de ação e CRUD (PERM-38)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Catálogo inventário §7 + gates DTO |
| **Catálogo** | `src/lib/actionPermissionCatalog.ts` |
| **Gate FE** | `canPerformAction` / `PermissionGate` |
| **Gate BE** | `requireResource(resourceKey, action)` → 403 |

## Regras

- **View** de página ≠ **ação** (create / edit / delete / export / print / audit / approve / configure)
- Botão sem grant → oculto (padrão `PermissionGate` mode `hide`)
- Não mostrar botão que a API nunca autorizará
- Mutação no backend exige action canônica — nunca só `view`
- Aliases UX → DTO: `edit`→`update`, `print`→`export`, `configure`→`manage`, `audit`→`view`
- Fornecedores: CRUD UI mapeia para `manage` (contrato sem create/update finos); delete continua SUPER_ADMIN
- Sessão: se `permissionsVersion` mudar (poll / 403 stale) → banner `PERMISSIONS_CHANGED_SESSION_MESSAGE`

## Superfícies migradas (UI → DTO)

| Módulo | Componente | Ações |
|--------|------------|-------|
| Produtos | `ProductModule` | create / update / delete / export |
| Clientes | `CustomerModule` | create / update |
| Propostas | `ProposalModule` | create / update / delete / print(export) |
| Fornecedores | `FinanceSuppliersPage` | view / manage |

Operações, AP/AR, comissões, RH e settings já usavam `canPerformAction` / `requireResource` (P13–P19).

## Testes

```bash
npx tsx --test src/lib/actionPermissionCatalog.perm38.test.ts
npm run test:action-permissions
```
