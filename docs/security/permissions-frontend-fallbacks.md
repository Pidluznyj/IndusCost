# Fallbacks de frontend — bag vazia / VIEWER (P07)

**Status:** implementado (2026-07-16).  
**Escopo:** apenas fallbacks FE que liberavam módulos sem chave na bag.

---

## Removido

| Fallback | Onde | Antes | Depois |
|----------|------|-------|--------|
| Overlay `ROLE_MATRIX` quando bag efetiva vazia | `permissionsClient.resolveRawFlags` | VIEWER vazio recebia defaults (ex.: Engenharia, pedidos) | `NONE` — sem acesso |
| Matriz FE `ROLE_MATRIX` (ADMIN/SELLER/VIEWER…) | `permissionsClient.ts` | Usada só no overlay acima | **Removida** do cliente |

## Regras atuais (UI)

- **SUPER_ADMIN** → acesso total na UI.
- **Bag com chaves** → só aliases explícitos do recurso (compatibilidade legada mantida).
- **Bag vazia** → nenhum recurso (exceto superfícies públicas autenticadas fora deste resolver).
- **Recurso desconhecido** → `canAccessResourceClient` = `false`.
- **Auth loading / erro de sessão** → `RequireAuth` mostra loading ou redireciona ao login; `hasPermission` sem user = `false`.

## Não alterado neste P07

- Mega-keys / aliases amplos no runtime (P09).
- Migração completa de sidebar/rotas (P10+).
- Path `unmapped` em `resourceNavigationAccess` (ainda passa; baselined).
- `canAccessModule` legado (ainda honra chaves explícitas como `costs.view`).

## Critério de aceite

VIEWER com `permissions: []` **não** visualiza Engenharia (`ResourceKeys.ENGENHARIA`).
