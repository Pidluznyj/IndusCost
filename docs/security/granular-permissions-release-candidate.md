# Release Candidate — Permissionamento granular (PERM-44)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | PERM-44 |
| **Data** | 2026-07-16 |
| **Escopo** | Revisão integral PERM-25 → PERM-43 |
| **HEAD deste RC** | `c8b0c64d235a8c572181652981ff9d73045767d0` (doc RC: `3abcbe4`) |
| **Produção** | Código liberado para homologação; migrate/seed/smoke autenticado no servidor **fora** deste run |

---

## 1. Veredicto

| Critério | Resultado |
|----------|-----------|
| Catálogo FE/BE único (`PERMISSION_CONTRACT_RESOURCES`) | **OK** |
| Resolvedor canônico único (`resolveEffectiveAccess`) | **OK** |
| Perfis (criar/editar/aplicar/snapshot) | **OK** (PERM-27/28/34) |
| Exceções individuais ALLOW / DENY / INHERIT | **OK** (PERM-29/30/35) |
| `permissionsVersion` + cache `/me` | **OK** (PERM-31 + P21) |
| `requireResource` em APIs críticas | **OK** com backlog residual (PERM-32) |
| Menus / submenus / abas / CRUD | **OK** (PERM-36…42) |
| Modal + redirect (sem Navigate silencioso) | **OK** (PERM-39) |
| Cenário Analista de Compras | **OK** (PERM-43 fixture) |
| SUPER_ADMIN / recurso desconhecido | **OK** |
| Compat temporária `permissions[]` | **Documentada** (ponte `legacyCompatMode`) |
| `npm test` / `npm run build` / `git diff --check` | **OK** neste workstation |
| Revisão de segurança (diff disponível) | **Sem findings medium+** |
| Revisão visual 1366×768 e 1920×1080 | **OK** (previews estáticos da árvore/editores) |

**Veredicto código:** **RC homologação — APROVADO.**  
**Veredicto produção:** **não liberado** até migrate + seed + smoke autenticado no host (ver §8).

---

## 2. Sequência PERM-25 → PERM-43

| Ticket | Hash | Resumo |
|--------|------|--------|
| PERM-25 | `649569c` (+ `1efff1f`) | Inventário navegação × permissionamento |
| PERM-26 | `b32b65d` (+ `ae4ad72`) | Hierarquia MODULE / PAGE / TAB / ACTION |
| PERM-27 | `9467d7a` (+ `de03c33`) | Diagnóstico falha salvar AccessProfile |
| PERM-28 | suite `accessProfilesSaveDiagnosis.test.ts` (tag PERM-28) | Save AccessProfile validado; entregue junto ao fluxo PERM-27→29 |
| PERM-29 | `2a0ab48` | Atribuição de perfil e permissões ao usuário |
| PERM-30 | `1b236f2` | Resolvedor canônico (ALLOW/DENY/INHERIT) |
| PERM-31 | `92f4971` | DTO compacto em `/api/auth/me` + cache |
| PERM-32 | `6fd9353` | `requireResource` em APIs críticas |
| PERM-33 | `f127dbb` / `368b72c` | `PermissionsTree` reutilizável |
| PERM-34 | `212b8fb` | Editor Perfis de Acesso |
| PERM-35 | `eb3e459` | Editor permissões por usuário |
| PERM-36 | `c40cc0f` | Sidebar só com recursos autorizados |
| PERM-37 | `ddd6c2c` | Abas autorizadas (`useAuthorizedTabs`) |
| PERM-38 | `8c15c64` | Ações CRUD via DTO |
| PERM-39 | `358fdb8` | Modal “Você não tem acesso…” + redirect |
| PERM-40 | `dbca232` | Dashboard + Engenharia (Suprimentos/MI) |
| PERM-41 | `bc7a661` | Comercial + Financeiro |
| PERM-42 | `a51c505` | Operações + Admin |
| PERM-43 | `70d7189` | Fixture + aceite Analista de Compras |
| PERM-44 | `3abcbe4` | RC consolidado |

---

## 3. Arquitetura confirmada (FE = BE)

```
PERMISSION_CONTRACT_RESOURCES  (única fonte de catálogo)
            │
            ▼
   resolveEffectiveAccess  ←── AccessProfile snapshot
            │                 ←── UserPermissionOverride (ALLOW/DENY)
            │                 ←── role baseline (se sem snapshot)
            │                 ←── bag permissions[] só se legacyCompatMode
            ▼
   ┌────────────────┬────────────────────┐
   │  /api/auth/me  │  requireResource    │
   │  effectiveAccess DTO               │
   └────────┬───────┴─────────┬──────────┘
            │                 │
            ▼                 ▼
   canViewModule /        401 / 403 API
   canPerformAction /
   sidebar / abas / CRUD / modal
```

- FE **não** reimplementa o resolvedor; consome o DTO de `/me`.
- BE APIs usam o **mesmo** `resolveCanonicalEffectiveAccess`.

---

## 4. Matriz de validação RC

| Dimensão | Evidência |
|----------|-----------|
| Criar/editar perfil | `AccessProfilesModule` + `test:access-profiles-matrix` |
| Aplicar perfil + snapshot | `accessProfilesApply` / `projectAccessProfilePermissionsToSnapshot` |
| Exceções individuais | `AdminUsersModule` + `permissionOverrideState` (INHERIT/ALLOW/DENY) |
| Precedência | `canonicalPrecedence.matrix.test.ts` (PERM-30) |
| permissionsVersion | poll `/api/auth/permissions-version` → sync-session; bump invalida cache |
| Cache `/me` | `authMeCompact` — hit por `userId+permissionsVersion` |
| requireResource | `test:require-resource` + PERM-32 |
| Menus/submenus | PERM-36 / `filterOfficialSidebarByEffectiveAccess` |
| Abas | PERM-37 / `useAuthorizedTabs` |
| CRUD | PERM-38 / `ACTION_PERMISSION_SURFACES` |
| Modal/redirect | PERM-39 / `UnauthorizedAccessGate` |
| Analista de Compras | PERM-43 / `analistaComprasPersona.ts` |
| SUPER_ADMIN | bypass em ações suportadas; último SA protegido |
| Recurso desconhecido | 403 / DENY (inclusive SA) |
| Bag `permissions[]` | eco no user; **não** autoridade quando DTO on; ponte BE `REQUIRE_RESOURCE_LEGACY_COMPAT` default on |

---

## 5. Testes executados (PERM-44)

```bash
npm run test:permission-contract
npm run test:effective-access
npm run test:effective-access-dto
npm run test:require-resource
npm run test:permission-hardening
npm run test:resource-navigation
npm run test:action-permissions
npm run test:analista-compras
npm run test:access-profiles-matrix
npm run test:user-permissions-matrix
npm run test:permissions-tree
npm run test:permissions-version
npm run test:permission-override
npm run test:operations-admin-permissions
npm run check:permission-consistency          # ok=true; 77 baselined; 0 new
npm run audit:permission-contract             # actionableErrors=0
npx tsx --test src/lib/granularPermissions.perm44.rc.test.ts
npm test
npm run build
git diff --check
```

Todos verdes neste workstation (2026-07-16).

---

## 6. Revisão de segurança

Subagente Security Review sobre o diff disponível: **nenhum finding medium/high/critical** no código de navegação/authz do escopo.

Observações não bloqueantes (já mitigadas por Layout / FinanceModule / requireResource):

- CTA Guia na Home (se presente) sem gate de link — rota falha fechada.
- Deep-link financeiro usa módulo `finance` no path; abas negam seções irmãs.

---

## 7. Revisão visual

Previews HTTP locais (`permissions-tree-ui`, `access-profiles-editor`, `user-permissions-editor`) inspecionados em:

| Viewport | Resultado |
|----------|-----------|
| 1366×768 | Árvore + colunas Herdar/Permitir/Negar legíveis; chips de resultado claros; rodapé fixo dos editores ok |
| 1920×1080 | Mesma hierarquia com mais respiro; lote por ramo e banners de snapshot/`permissionsVersion` visíveis |

Confirmado visualmente: ALLOW / DENY / INHERIT, origem perfil vs override, resultado efetivo, snapshot avisando que usuários vinculados não mudam ao salvar perfil, e `permissionsVersion` no editor de usuário.

Smoke autenticado live (login + sidebar real) **não** executado neste run (depende de app + DB).

---

## 8. Limitações restantes (não bloqueantes do RC de código)

1. **Bag `permissions[]` + dual-write** ainda presentes; autoridade canônica é o DTO/resolvedor.
2. **`REQUIRE_RESOURCE_LEGACY_COMPAT` default on** — ponte bag→contrato em APIs até cutover completo.
3. **Backlog `requireResource` residual:** funil pedido→caixa / ranking (OR multi-domínio); cost-to-cash audit bags; alguns satélites Nomus/MI.
4. **Consistency baseline:** 77 findings históricos baselined (`ALIAS_DUPLICATE` / `ALIAS_WIDE`); zero findings **novos**.
5. **Frota:** facetas financeiras `fleet.*` granulares além de `operations.fleet` view/manage.
6. **Produção operacional:** migrate + seed + restart + smoke autenticado no servidor — obrigatório antes de go-live.

---

## 9. Como homologar

1. Deploy código deste HEAD.
2. `npx prisma migrate deploy` + seed de catálogo (`permissions:seed:contract:apply` conforme runbook).
3. Smoke: criar perfil → aplicar a usuário → exceção DENY → poll version → modal em URL negada.
4. Rodar persona Analista de Compras (fixture ou perfil espelhando `analistaComprasPersona.ts`).
5. Validar SUPER_ADMIN e usuário sem grants (página neutra PERM-39).

---

## 10. Referências

- Inventário: `navigation-permission-inventory.md`
- Hierarquia: `resource-hierarchy.md`
- DTO: `permissions-effective-access-dto.md`
- Sidebar/abas/ações/modal: `sidebar-authorized-menus.md`, `authorized-tabs.md`, `action-permissions.md`, `unauthorized-access.md`
- Módulos: `engineering-dashboard-permissions.md`, `commercial-finance-permissions.md`, `operations-admin-permissions.md`
- Persona: `analista-compras-persona.md`
