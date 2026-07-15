# Estado atual do modelo de permissões (auditoria de código)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data da auditoria** | 2026-07-15 |
| **Escopo** | Somente documentação — **sem** alteração de comportamento |
| **Fonte** | Código em `main` (não apenas docs anteriores) |
| **Relacionados** | `permissions-resource-inventory.md`, `permissions-endpoint-audit.md`, `permissions-model-plan.md`, `permissions-current-inventory.md`, **Prompt 02:** `permissions-key-naming.md`, `permissions-target-matrix.md`, `src/lib/security/permissionContract`, **Prompt 03:** `permissions-validator.md`, `src/lib/security/permissionAudit`, **Prompt 05:** `permissions-catalog-seed.md`, `src/lib/security/permissionCatalogSeed`, **Prompt 06:** `permissions-dual-write.md`, `src/lib/security/permissionDualWrite`, **Prompt 08:** `permissions-matrix-ui.md`, `src/components/admin/PermissionMatrix.tsx`, **Prompt 09:** `permissions-access-profiles-matrix.md`, `AccessProfilesModule`, **Prompt 10:** `permissions-user-matrix.md`, `AdminUsersModule` |

---

## 1. Arquitetura encontrada

O sistema opera em **dois stacks paralelos**:

```text
┌─────────────────────────────────────────────────────────────────┐
│ STACK A — LEGADO (fonte operacional dominante)                  │
│ PERMISSION_CATALOG (175 chaves)                                 │
│ AppUser.role + AppUser.permissions: String[]                    │
│ getEffectivePermissions → hasPermission                         │
│ createAuthGuards.requirePermission(legacyKey)                   │
│ canAccessModule / auth.hasPermission (UI)                       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ dual-write / legacyAliasKeys
                              │
┌─────────────────────────────────────────────────────────────────┐
│ STACK B — RELACIONAL (overlay parcial)                          │
│ PermissionResource seed (45 keys PT)                            │
│ canView / canExecute / canManage                                │
│ RolePermission (seed DB) + UserPermissionOverride (DB)          │
│ permissionService.canAccessResource                             │
│ createResourcePermissionGuards (subconjunto de rotas)           │
│ permissionsClient / usePermissions / PermissionGate             │
└─────────────────────────────────────────────────────────────────┘
```

**Verdade operacional para a maioria das rotas e botões:** `AppUser.permissions[]` filtrado por `PERMISSION_CATALOG`, com bypass total se `role === SUPER_ADMIN`.

**Árvore relacional:** usada em painel admin (árvore Ver/Executar/Gerenciar), CRM tabs, Comissões (híbrido), Conciliação de Carteira, MI (parcial) e admin ACL. Em request time, guards de resource **não** leem `RolePermission`/`UserPermissionOverride` do Postgres ao vivo — usam **seed em memória** + projeção de aliases a partir das permissões legadas da sessão (`buildPermissionSnapshotForAuth`).

Schema Prisma (`PermissionResource`, `RolePermission`, `UserPermissionOverride`, `PermissionAuditLog`) existe e é alimentar por seed/admin; o comentário no schema deixa explícito que **ainda não substitui** `AppUser.permissions[]`.

---

## 2. Precedência atual

### 2.1 Path legado (`hasPermission` / `requirePermission("*.view")`)

1. Se `AppUser.role === SUPER_ADMIN` → `ALL_PERMISSION_KEYS` (catálogo inteiro).
2. Senão → `filterKnownPermissions(AppUser.permissions)` (whitelist do catálogo).
3. **Não consulta:** `AccessProfile`, `RolePermission`, `UserPermissionOverride`.

Arquivo: `src/lib/appAuth.ts`.

### 2.2 Path relacional (`canAccessResource` / `requireResourcePermission`)

1. Usuário inativo (não SUPER_ADMIN) → deny.
2. `SUPER_ADMIN` → allow em todos os flags.
3. Defaults de role a partir da **matriz seed em código** (`permissionResourceSeedData` / `ROLE_MATRIX` no client).
4. Overlay:
   - **Admin save / materialização:** `UserPermissionOverride` (null = herda).
   - **Runtime guard/UI:** overrides **sintéticos** derivados de `legacyAliasKeys` ∩ `effectivePermissions` da sessão.
5. Hierarquia: todo ancestral precisa `canView`.
6. Ação normalizada: `view|read` → `canView`; `execute|create|export` → `canExecute`; `manage|admin|update|delete` → `canManage`.

Arquivos: `src/lib/security/permissionService.ts`, `permissionSnapshot.ts`, `permissionGuards.ts`.

### 2.3 Dual-write (usuário)

`saveUserPermissionOverrides` (`userPermissionAdminService.ts`):

1. Recusa edição se target é `SUPER_ADMIN`.
2. Calcula flags efetivos (role seed ± overrides).
3. `materializeLegacyPermissionsFromFlags` → aliases legados.
4. Persistência atômica: overrides DB + **`AppUser.permissions = legacy materializado`**.
5. Impede auto-remoção de `users.manage` (lockout self).
6. Audit em `PermissionAuditLog`.

---

## 3. Perfis, roles e usuários

| Conceito | Modelo | Comportamento real |
|----------|--------|-------------------|
| **AppUserRole** | enum Prisma | `SUPER_ADMIN` bypass; demais só rotulam + seeds/presets |
| **AccessProfile** | template nomeado | **Snapshot / cópia** ao criar/atualizar usuário (`applyAccessProfileToUserFields`). Alterar o perfil **não** propaga para usuários já vinculados |
| **accessProfileId** | FK opcional | Metadado de vínculo; **não** entra em `getEffectivePermissions` |
| **UserPermissionOverride** | flags nullable | Persistidos; efeito runtime via dual-write no array legado (guards resource re-projetam aliases) |
| **RolePermission** | flags por role×resource | Seed DB + UI de matriz; **guards Express não leem a tabela ao vivo** |

Conclusão de produto: **perfil = snapshot**, não herança viva.

---

## 4. Proteção frontend

| Camada | Mecanismo | Observação |
|--------|-----------|------------|
| Sessão SPA | `RequireAuth` | Só autenticação — **sem** `RequirePermission` de rota |
| Layout | `canAccessModule` | OR-sets legados por `AppModuleId` |
| Sidebar | `buildAccessibleSidebarNavigation` | Se há `resourceKey` + `canViewResource`, catalog primeiro; senão legado |
| Abas | mistura | CRM/portfolio/`ProtectedTab`; comissões híbrido; inventário sem per-tab; finance helpers OR largos |
| Botões | `auth.hasPermission` | UX only; cobertura irregular (ex.: export de pedidos sem chave dedicada no client) |
| Gates tipados | `PermissionGate` / `ProtectedTab` | Uso **esparso** (portfolio + CRM principalmente) |

Módulos com `resourceKey` no sidebar (`sidebarMenuResources.ts`):  
`dashboard`, `finance`, `portfolio-reconciliation`, `crm-commercial`, `sales-orders`, `commissions`, `materials`, `settings`.

Os demais (~20 módulos da sidebar) usam apenas `canAccessModule` legado.

**Inconsistência documentada:** client usa `ResourceKeys.CONFIGURACOES = "configuracoes"` no sidebar de Settings, enquanto o seed oficial backend usa `admin` (`PermissionResourceKeys.ADMIN`). São árvores paralelas parcialmente desalinhadas.

Rotas autenticadas **fora** do mapa de módulo do Layout (ex.: intake de projetos sem primeiro segmento mapeado) podem **não** passar por `AccessDenied` de módulo.

---

## 5. Proteção backend

| Guard | Arquivo | Usa |
|-------|---------|-----|
| `requireAppAuth` | `appAuthMiddleware.ts` | Sessão |
| `requirePermission(legacy)` | idem | Stack A |
| `requireAnyPermission([...])` | idem | Stack A (OR) |
| `requireResourcePermission(key, action)` | `permissionGuards.ts` | Stack B |
| `createFleetRouteGuards` | `fleetRouteGuards.ts` | Catálogo `fleet.*` |
| Inline SUPER_ADMIN / service checks | vários `*Routes.ts` | Deletes críticos, CRM owner, etc. |

**Segurança real = API.** UI apenas esconde.

Detalhe por endpoint: `permissions-endpoint-audit.md`.

---

## 6. Catálogos e aliases

| Catálogo | Contagem (2026-07-15) | Arquivo |
|----------|----------------------|---------|
| `PERMISSION_CATALOG` | **175** chaves | `src/lib/permissionCatalog.ts` |
| `PERMISSION_RESOURCE_SEEDS` | **45** resources | `src/lib/permissionResourceSeedData.ts` |
| `FRONTEND_PERMISSION_RESOURCES` | subset (~paralelo + `configuracoes`) | `src/lib/permissionsClient.ts` |

Cada seed carrega `legacyAliasKeys[]` apontando para chaves do catálogo inglês. Na materialização, só aliases conhecidos entram em `AppUser.permissions[]`.

Normalização de ação (não C/R/U/D verdadeiro no modelo relacional):

| Input | Flag |
|-------|------|
| view, read | `canView` |
| execute, create, export | `canExecute` |
| manage, admin, update, delete | `canManage` |

---

## 7. SUPER_ADMIN

- Bypass em `getEffectivePermissions` → todas as chaves do catálogo legado.
- Bypass em `canAccessResource` → todos os flags.
- Target SUPER_ADMIN é **somente leitura** no editor de overrides (não dual-write).
- Proteções operacionais: não remover próprio `users.manage`; proteções de último SUPER_ADMIN / bootstrap cookie (fora de AppUser).

---

## 8. Principais inconsistências

1. **Dual stack:** sidebar/resource vs Layout/`canAccessModule` podem divergir no mesmo URL.
2. **`configuracoes` (FE) vs `admin` (seed BE)** para Configurações.
3. **AccessProfile** e editor legado (`PermissionEditor` / checkbox) vs árvore Ver/Executar/Gerenciar no usuário — UIs paralelas.
4. **RolePermission DB** seeded mas **não** lido pelos guards de produção.
5. **OR largos** de finance/settings (`settings.view` abre leitura financeira e sync Nomus em várias rotas).
6. **Abas catalogadas e UI-ocultas** (comissões legadas; portfolio conciliacao/inteligencia; MI fornecedores/alertas/config sem gate de nav).
7. **CRUD incompleto no catálogo** vs superfície real (muitos módulos só `view`/`edit`/`manage`).
8. **`PermissionGate` subutilizado**; maioria dos módulos com checks ad-hoc.
9. **Inventário de tabs** (estoque, frota) sem resourceKeys por aba.
10. Docs gerados antigos (`docs/generated/permissions-audit-report.md`) potencialmente desatualizados vs código.

---

## 9. Riscos de lockout

| Risco | Mitigação atual | Residual |
|-------|-----------------|----------|
| Admin remove próprio `users.manage` | Bloqueio no dual-write | OK no path de overrides |
| Remover último SUPER_ADMIN | Checagens em admin users | Depende de todos os paths de PATCH |
| AccessProfile “esvazia” permissões no apply | Cópia direta; SUPER_ADMIN limpa array (role basta) | Operador pode aplicar perfil ruim em ADMIN |
| Materialização dropa chaves sem alias no seed | Só aliases do resource seed entram | Usuário perde grants “órfãos” do catálogo ao salvar árvore |
| Bootstrap cookie | Recuperação ops fora AppUser | Canal privilegiado separado |

---

## 10. Permissões cadastradas × utilizadas (síntese)

### 10.1 Cadastradas no catálogo e pouco/não usadas na UI de nav

- Abas legadas de comissões: `commissions.dashboard|forecast|confirmed|release|payments|people|rules|audit|settings.view` (+ resources `comissoes.tab.*` correspondentes) — UI live usa outro conjunto de tabs.
- Tabs portfolio `conciliation` / `intelligence` — seeded + API resource, **whitelist UI** mostra sobretudo `status_pedidos` + `auditoria`.
- Aliases duplicados de rescisão de fornecedor (`finance.suppliers.service_termination.*` e `suppliers.serviceTermination.*`).
- Near-duplicates inventory (`inventory.movement.*` vs `inventory.movements.*`).

### 10.2 Utilizadas na UI/API e não no resource seed (dependem só do legado)

- Quase toda Engenharia / Operações: products, purchases, machines, employees, inventory, fleet, projects, maintenance, opex, taxes, pricing, simulations, proposals, customers, reports, guide, suppliers (sidebar module).
- Ações finas: `products.create|edit|delete`, `inventory.*.manage`, `fleet.*`, etc.
- Settings hub sections (`settings.branding|global_params|operational|nomus|price_tables.*`).

### 10.3 Resource keys usadas no BE e intencionalmente fora do `PERMISSION_CATALOG`

Chaves PT (`financeiro.*`, `comissoes.tab.*`, `comercial.crm.tab.*`, `admin.*`, …) — esperadas; bridged via aliases.

---

## 11. Gaps por severidade (visão geral)

Classificação detalhada com evidência de guard: `permissions-endpoint-audit.md`.

| Severidade | Temas |
|------------|--------|
| **Crítico** | `GET /api/test-db` sem auth; sync Nomus / billing sync com OR `settings.view` |
| **Alto** | DELETE pricing com só `pricing.view`; OR-lists finance com `settings.view`; dual catalog FE/BE Settings |
| **Médio** | Middleware auth-only + check inline; CRM assign seller sem middleware de permissão; Layout null-module; exports UI sem chave |
| **Baixo** | Tabs catalogadas ocultas; `PermissionGate` esparso; docs gerados stale; `mainNavigation` segments desatualizados |

---

## 12. Arquivos-chave

| Área | Path |
|------|------|
| Schema | `prisma/schema.prisma` |
| Catálogo legado | `src/lib/permissionCatalog.ts` |
| Seed relacional | `src/lib/permissionResourceSeedData.ts` |
| Auth legado | `src/lib/appAuth.ts`, `appAuthMiddleware.ts` |
| Engine relacional | `src/lib/security/permissionService.ts` |
| Snapshot/alias | `src/lib/security/permissionSnapshot.ts` |
| Presets/materialize | `src/lib/security/permissionRolePresets.ts` |
| Admin dual-write | `src/lib/security/userPermissionAdminService.ts` |
| Access profiles | `src/lib/accessProfilesService.ts`, `accessProfilesUtils.ts` |
| Frontend API | `src/lib/permissionsClient.ts`, `hooks/usePermissions.ts` |
| Sidebar / modules | `navigationGroups.ts`, `sidebarNavigation.ts`, `sidebarMenuResources.ts`, `modulePermissions.ts` |
| UI admin | `AdminUsersModule.tsx`, `UserPermissionTree.tsx`, `AccessProfilesModule.tsx`, `PermissionEditor.tsx` |

---

## 13. Validações executadas nesta auditoria (docs-only)

| Check | Resultado |
|-------|-----------|
| `npx prisma validate` (com `DATABASE_URL` dummy — schema exige a env) | OK |
| `npm run check:server-imports` | OK |
| `npm run check:frontend-server-imports` | OK |
| `npm run check:browser-bundle` | OK |

Sem `DATABASE_URL` no ambiente, o Prisma CLI falha em `get-config` (P1012) antes de validar o schema; isso não indica schema inválido.

## 14. O que esta auditoria **não** faz

- Não implementa matriz C/R/U/D nova.
- Não altera regras de AR/AP/Fluxo/Comissões/Nomus/Formação de Preço/Pedidos/NF.
- Não executa migration nem toca banco de produção.

Próximo passo de produto (fora deste prompt): ver `permissions-model-plan.md` + inventário/endpoint docs gerados nesta auditoria.
