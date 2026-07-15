# Navegação por `view` de recurso (Prompt 11)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Fonte FE** | `src/lib/resourceNavigationAccess.ts` |
| **Resolver** | `canAccessResourceClient` / contrato de aliases em `permissionsClient` |

---

## Objetivo

Aplicar `view` de forma consistente em sidebar, rotas (URL direta) e abas, **sem** reescrever ainda todas as ações internas (`execute` / `manage`).

## Helpers oficiais

| Helper | Uso |
|--------|-----|
| `canViewResource(user, key)` | View do resourceKey canônico |
| `canViewModule(moduleId, ctx)` | Menu/rota: resourceKey se mapeado, senão `canAccessModule` |
| `evaluatePathViewAccess(path, ctx)` / `canAccessPath` | Gate de Layout / URL |
| `buildResourceAwareSidebarNavigation(ctx)` | Sidebar filtrada |
| `getSafeFirstAllowedPath(ctx)` | Redirect sem loop |
| `resolveSafeNavigateTarget` | Destino seguro |
| `filterTabsByView` / `pickAllowedTabId` | Abas por view + pai |

Hook: `usePermissions()` expõe os aliases de navegação.

## Regras

1. Sem `view` do recurso mapeado → não aparece na sidebar.
2. Sem `view` → Layout mostra `AccessDenied` (URL direta).
3. Sem `view` da aba → aba oculta / `ProtectedTab` com mensagem clara.
4. Filho depende do `view` efetivo do pai (hierarquia no resolvedor).
5. Negar pai na UI **não** apaga overrides/config dos filhos no backend.
6. Paths **unmapped** não disparam AccessDenied no Layout (sem falso negativo / loop).
7. `SUPER_ADMIN` → acesso total.
8. Fallback legado: módulos **sem** `resourceKey` em `sidebarMenuResources.ts` usam `canAccessModule`.

## Recursos migrados (resourceKey na nav)

`dashboard`, `finance`, `portfolio-reconciliation`, `crm-commercial`, `sales-orders`, `commissions`, `materials`, `settings` (+ grupos financeiro/comercial/admin).

Demais módulos (~20): **fallback legado**.

## Superfície UI migrada

- `Layout.tsx` — `evaluatePathViewAccess` (antes só `canAccessModule`)
- `Sidebar.tsx` — `buildResourceAwareSidebarNavigation`
- `AccessDenied` / `DefaultModuleRedirect` — `getSafeFirstAllowedPath`
- `ProtectedTab` — `canViewResource`
- `usePermissions` — API de navegação

## Testes

```bash
npm run test:resource-navigation
```

Cenários: SUPER_ADMIN, ADMIN, gestor, vendedor, viewer, deny específico, legado por alias, parent bloqueia abas, path unmapped, anti-loop inactive.
