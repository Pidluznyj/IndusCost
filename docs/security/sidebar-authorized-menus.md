# Menu lateral só com recursos autorizados (PERM-36)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Catálogo oficial + DTO `/me.effectiveAccess` |
| **Filtro** | `src/lib/sidebarEffectiveAccess.ts` |
| **UI** | `src/components/layout/Sidebar.tsx` (sem regras locais) |

## Regras

- Módulo/grupo **sem** filhos permitidos → não aparece
- Módulo/grupo **com** ≥1 filho permitido → aparece
- Submenu negado → não aparece
- Comercial oculto se nenhum recurso `commercial.*` estiver permitido
- `SUPER_ADMIN` vê toda a navegação
- Recurso desconhecido → não revela item
- Ordem = catálogo oficial (`NAVIGATION_GROUP_DEFINITIONS` / `SIDEBAR_MODULE_ORDER`)
- Ocultação de menu **não** substitui `requireResource` no backend

## API

```ts
filterOfficialSidebarByEffectiveAccess(dto) // PERM-36
buildSidebarNavigationFromEffectiveAccess(dto)
effectiveAccessDtoFromAllowedResources(allowedResources)
```

O `Sidebar` chama apenas `buildResourceAwareSidebarNavigation({ effectiveAccess })`.

## Testes

```bash
npm run test:resource-navigation
```

Casos em `src/lib/sidebarAuthorizedMenus.perm36.test.ts` com vários conjuntos de `allowedResources`.
