# Inventário técnico — autenticação, roles, menus e abas (estado atual)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Atualização** | 2026-07-15 — auditoria consolidada em `permissions-current-state.md`, inventário nav em `permissions-resource-inventory.md`, endpoints em `permissions-endpoint-audit.md` (preferir esses três para o estado atual revalidado no código) |
| **Escopo** | Somente inventário — **sem** implementação de permissionamento novo |
| **Script read-only** | `scripts/inspectPermissionsCurrentState.ts` (espelho sugerido: `tmp-audits/inspect-permissions-current-state.ts`) |
| **Docs relacionados** | `docs/induscost-permissions-current-state.md`, `docs/induscost-permissions-action-plan.md`, `docs/induscost-permissions-portfolio-reconciliation-step1.md` |

---

## 1. Fluxo atual de autenticação

```text
Browser → POST /api/auth/login { email, password }
       → verifyPassword (scrypt:v1)
       → cria AppSession (token opaco 32 bytes; DB guarda SHA-256)
       → Set-Cookie induscost_session (httpOnly, sameSite=lax, TTL 12h)
       → { user: SafeAppUser com effectivePermissions }

Browser → GET /api/auth/me (cookie)
       → resolve sessão não revogada / não expirada / usuário isActive
       → { authenticated, user }

Browser → POST /api/auth/logout
       → revokedAt na sessão + clear cookie
```

| Item | Valor | Arquivo |
|------|-------|---------|
| Cookie | `induscost_session` | `src/lib/appAuth.ts` |
| TTL | 12 horas | `APP_SESSION_TTL_MS` |
| Senha | scrypt `scrypt:v1:<salt>:<hash>` | `hashPassword` / `verifyPassword` |
| Token sessão | hex opaco; persistido como `tokenHash` SHA-256 | `AppSession` |
| Client | `AuthContext` (`loadMe` / `login` / `logout`) | `src/contexts/AuthContext.tsx` |
| Gate SPA | `RequireAuth` — **só sessão**, sem permissão de módulo | `src/components/RequireAuth.tsx` |
| Bootstrap ops | cookie separado `induscost_bootstrap_admin` (8h) | `server.ts` — **não** é AppUser |

**Identificação no backend:** `readAppSession` em `server.ts` → cookie → `prisma.appSession.findFirst` → `toAppAuthContext` → guards via `createAuthGuards(readAppSession)`.

---

## 2. Fluxo atual de autorização

```text
AppUser.role + AppUser.permissions[]
        │
        ▼
getEffectivePermissions(user)
  - SUPER_ADMIN → ALL_PERMISSION_KEYS (catálogo inteiro)
  - demais → filterKnownPermissions(permissions)  // whitelist do catálogo
        │
        ▼
hasPermission / hasAnyPermission
        │
        ├─ API: requirePermission / requireAnyPermission / requireAllPermissions
        ├─ Menu: canAccessModule → sidebar filtrada
        └─ UI: auth.hasPermission(...) esconde/desabilita (UX, não segurança)
```

| Camada | Mecanismo |
|--------|-----------|
| Catálogo | `PERMISSION_CATALOG` em código (`src/lib/permissionCatalog.ts`) — **162** chaves |
| Grants | `AppUser.permissions: String[]` (fonte em runtime) |
| Perfis | `AccessProfile.permissions` — **copiados** para o usuário na aplicação; não são join live |
| Roles enum | Apenas rótulo/comportamento especial; não substituem o array de permissões (exceto SUPER_ADMIN) |

---

## 3. Tabelas existentes (Prisma)

### Auth / acesso (app)

| Modelo | Papel |
|--------|-------|
| `AppUserRole` (enum) | `SUPER_ADMIN`, `ADMIN`, `COMMERCIAL_MANAGER`, `SELLER`, `VIEWER` |
| `AppUser` | Usuário: `role`, `permissions String[]`, `accessProfileId?`, `isActive`, vendedor Nomus opcional |
| `AppSession` | Sessão: `tokenHash`, `expiresAt`, `revokedAt?` |
| `AccessProfile` | Template nomeado: `permissions String[]`, `roleBase?`, `systemKey?`, `isSystem` |

**Não existem** tabelas `Permission`, `RolePermission`, `UserPermission` nem `AppUserChangeLog` para ACL.

> `Role` no schema (~linha 32) é **RH/folha** (colaboradores), **não** autenticação de app.

### Auditoria

| Tipo | Exemplos | Liga a AppUser ACL? |
|------|----------|---------------------|
| Domínio | `FleetAuditLog`, `InventoryAuditLog`, `FinancialCostCenterAuditLog`, `CommercialAuditLog`, `OrderToCashAudit*` | Não |
| AppUser | — | **Não há** log de alteração de permissões |

---

## 4. Componentes de menu

| Camada | Arquivo | Função |
|--------|---------|--------|
| IDs + ordem | `src/lib/modulePermissions.ts` | `SIDEBAR_MODULE_ORDER` (27 módulos), `canAccessModule` |
| Grupos accordion | `src/lib/navigationGroups.ts` | `NAVIGATION_GROUP_DEFINITIONS`, `MODULE_MENU_PERMISSION_KEYS`, `getModulePath` |
| Filtro acessível | `src/lib/sidebarNavigation.ts` | `buildAccessibleSidebarNavigation` |
| UI | `src/components/layout/Sidebar.tsx` | Render + `useAuth` |

### Grupos oficiais

| Grupo | Itens (resumo) |
|-------|----------------|
| dashboard | Dashboard (item direto) |
| engenharia | products, transformation-simulator, materials, simulations, projects |
| comercial | crm, customers, proposals, sales-orders, pricing, commissions |
| financeiro | finance, suppliers, **portfolio-reconciliation**, opex, taxes, reports |
| operacoes | inventory, purchases, machines, operations-performance, maintenance, fleet |
| administracao | employees, settings, guide |

### Paths especiais

- `suppliers` → `/finance/suppliers`
- `portfolio-reconciliation` → `/finance/portfolio-reconciliation`

### Telas importantes × gate de menu (OR típico)

| Tela / módulo | Gate principal |
|---------------|----------------|
| Dashboard | `dashboard.view` |
| Financeiro (módulo interno) | `finance.view` \| AR \| AP \| reports \| Nomus/settings |
| Conciliação de Carteira | chaves `finance.portfolioReconciliation.*` **ou** OR legado finance/AR/AP/reports/Nomus |
| Contas a Receber / Pagar | seções dentro de Financeiro + `finance.accountsReceivable.view` / `finance.accountsPayable.view` |
| Fluxo de Caixa | OR amplo finance/AR/AP/reports (`financeCashFlowPermissions.ts`) — **sem chave dedicada no catálogo** |
| Relatório Presidencial | `executive-report` — código referencia `finance.executiveReport.view` **ausente do catálogo** + OR reports/billing |
| Comercial / CRM | `crm.view` + abas general/seller |
| Pedido de Venda | `sales_orders.view` |
| Comissões | união `COMMISSIONS_VIEW_PERMISSIONS` |
| Suprimentos | `materials.view` (legado `costs.view`) |
| Inteligência de Mercado | permissões `materials.market*` / rotas market intelligence |
| Admin / Usuários | `users.manage` / `settings.view` / `accessProfiles.*` |

---

## 5. Componentes de tabs

### Padrão compartilhado financeiro

| Componente | Uso |
|------------|-----|
| `FinanceArTabNav` (`FinanceAccountsReceivableUiShared.tsx`) | Contas a Receber — **sem ACL por aba** |
| `FinanceApTabNav` (`FinanceAccountsPayableUiShared.tsx`) | Contas a Pagar — **sem ACL por aba** |

Abas AR (UI): overdue, customers, aging, audit, schedule, payment-methods, companies.  
Abas AP (UI): titles, suppliers, aging, audit, schedule, payment-methods, companies.

### Conciliação de Carteira (único padrão tab-ACL maduro)

Arquivos: `FinancePortfolioReconciliationPage.tsx`, `financePortfolioReconciliationPermissions.ts`, `financePortfolioReconciliationRoutes.ts`.

| Aba | Chave catálogo | API |
|-----|----------------|-----|
| Conciliação | `finance.portfolioReconciliation.conciliation.view` | `/api/finance/portfolio-reconciliation*` |
| Inteligência da Carteira | `finance.portfolioReconciliation.intelligence.view` | `.../intelligence*` |
| Auditoria Pedido → Caixa | `finance.portfolioReconciliation.orderToCashAudit.view` | `.../order-to-cash-audit*` |
| Módulo | `finance.portfolioReconciliation.view` | runs / módulo |

Compatibilidade: OR legado ainda libera módulo + todas as abas.

### CRM

| UI | Permissão |
|----|-----------|
| Aba Gestão Geral | `crm.general.view` |
| Aba Gestão por Vendedor | `crm.seller.own` \| `crm.seller.all` |
| Carteira | general OR seller |
| Sub-tabs vendedor | dashboard \| portfolio — **sem chave própria** |

### Comissões

Catálogo com várias `commissions.*.view` (dashboard, forecast, confirmed, release, payments, people, rules, audit, settings). UI muitas vezes usa OR amplo de visão.

### Catálogo — tipos (contagem live 2026-07-13)

| type | Qtd |
|------|-----|
| menu | 25 |
| section | 25 |
| tab | 20 |
| action | 92 |
| **Total** | **162** |

---

## 6. APIs sensíveis

### Middleware

| Helper | Arquivo |
|--------|---------|
| `createAuthGuards` | `src/lib/appAuthMiddleware.ts` |
| `requireAppAuth` | 401 sem sessão |
| `requirePermission(p)` | 403 + `requiredPermissions` |
| `requireAnyPermission([...])` | 403 se nenhuma |
| `requireAllPermissions([...])` | 403 se faltar alguma |
| Admin users | `requireUserAdminOrBootstrap` (`users.manage` ou bootstrap) |

### Padrão dominante

Maioria das rotas de domínio: `[requireAppAuth, requirePermission | requireAnyPermission]`.

### Somente login (ou role assert após auth) — gaps

| Endpoint / área | Observação |
|-----------------|------------|
| `GET /api/test-db` | Frequentemente **sem auth** (gap P0 em action plan) |
| `DELETE` projects / suppliers / limpeza frota | `requireAppAuth` + assert `SUPER_ADMIN` (não catálogo) |
| Algumas rotas materials/reliability | auth + role ADMIN/SUPER_ADMIN inline |
| SPA `RequireAuth` | Qualquer usuário autenticado abre a rota; API deve bloquear |

### Admin

| API | Guard |
|-----|-------|
| `/api/admin/users*` | `users.manage` ou bootstrap |
| `/api/admin/permissions/catalog` | idem |
| `/api/access-profiles*` | `accessProfiles.view` / `manage` (+ app auth) |
| `/api/auth/login\|logout\|me` | públicos / sessão |

### UI admin

| Tela | Arquivo | Gate |
|------|---------|------|
| Usuários | `AdminUsersModule.tsx` | `users.manage` |
| Perfis de acesso | `AccessProfilesModule.tsx` | `accessProfiles.*` |
| Editor de árvore | `admin/PermissionEditor.tsx` | usado pelos dois |

---

## 7. Gaps de segurança encontrados

1. **`/api/test-db` sem autenticação** (se ainda exposto).
2. **Sem auditoria de mudança de permissões** (`AppUserChangeLog` inexistente).
3. **OR legado amplo** em Financeiro / Fluxo / (ainda) Conciliação — difícil negar uma subárea.
4. **`finance.executiveReport.view` referenciado no código e ausente do catálogo** — não concedível via PermissionEditor; whitelist remove a chave se gravada.
5. **Abas AR/AP/Fluxo/Presidencial sem ACL por aba** — só seção/módulo.
6. **Checagens `role === ADMIN|SUPER_ADMIN` paralelas** ao catálogo (projetos, suppliers, frota, commissions scope, etc.).
7. **AccessProfile não é join live** — editar perfil não atualiza usuários já vinculados até reaplicar.
8. **SPA não filtra por permissão de rota** — só `RequireAuth`; segurança real depende da API.
9. Docs antigos citam ~73 chaves; catálogo atual tem **162**.

---

## 8. Pontos de duplicidade

| Padrão | Onde |
|--------|------|
| OR finance/AR/AP/reports | `modulePermissions`, `financeCashFlowPermissions`, `financePortfolioReconciliationPermissions` (legado), billing, etc. |
| `role === SUPER_ADMIN` | `appAuth.getEffectivePermissions` + vários deletes/helpers |
| Listas de permissão de menu | `MODULE_MENU_PERMISSION_KEYS` × `canAccessModule` × helpers de domínio (devem permanecer alinhados) |
| Profiles vs user array | Template vs snapshot — duas “fontes” conceituais, uma efetiva |

---

## 9. Recomendação de arquitetura (próximos prompts)

**Reutilizar o motor existente** — não criar tabelas Role/Permission agora.

1. Catálogo central (`menu|section|tab|action`) + `parentKey`/`requires`.
2. Helpers de domínio únicos (espelhar `financePortfolioReconciliationPermissions.ts`).
3. API: `requireAnyPermission` / `requirePermission` sempre; UI só esconde.
4. Manter OR legado só com janela de compatibilidade + backfill admin.
5. SUPER_ADMIN continua bypass via `getEffectivePermissions`.
6. Depois: `AppUserChangeLog`, fechar `/api/test-db`, corrigir `finance.executiveReport.view`, reduzir asserts de role.

**Não** migration neste inventário; migration só se/quando houver `AppUserChangeLog` ou modelo relacional (P3 no action plan).

---

## 10. Arquivos prováveis nos próximos prompts

| Área | Arquivos |
|------|----------|
| Catálogo / templates | `permissionCatalog.ts`, `permissionCatalogUtils.ts`, `permissionGroups.ts` |
| Auth | `appAuth.ts`, `appAuthMiddleware.ts`, `server.ts` |
| Menu | `modulePermissions.ts`, `navigationGroups.ts`, `sidebarNavigation.ts`, `Sidebar.tsx` |
| Domínio finance | `finance*Permissions.ts`, `*Routes.ts`, `FinanceModule.tsx`, `financeNavigation.ts` |
| Conciliação (referência) | `financePortfolioReconciliationPermissions.ts`, `FinancePortfolioReconciliationPage.tsx`, `financePortfolioReconciliationRoutes.ts` |
| Admin | `AdminUsersModule.tsx`, `AccessProfilesModule.tsx`, `PermissionEditor.tsx`, `accessProfilesRoutes.ts` |
| Docs | este inventário + action plan / matrix |

---

## Apêndice A — Checklist do prompt (respostas diretas)

| # | Pergunta | Resposta curta |
|---|----------|----------------|
| 1 | Como o usuário loga? | `POST /api/auth/login` + cookie `induscost_session` |
| 2 | User / Role / sessão? | `AppUser`, enum `AppUserRole`, `AppSession` |
| 3 | Backend identifica usuário? | `readAppSession` → `getCurrentAppUser` |
| 4 | Middlewares? | `createAuthGuards` em `appAuthMiddleware.ts` |
| 5 | Roles verificadas? | Catálogo + SUPER_ADMIN bypass + asserts pontuais de role |
| 6 | Menu lateral? | `Sidebar` ← `sidebarNavigation` ← `modulePermissions` / `navigationGroups` |
| 7 | Submenus? | Grupos accordion em `navigationGroups` + seções internas Finance/CRM |
| 8 | Abas internas? | Tablists locais / `FinanceArTabNav` / CRM tabs / PR tabs |
| 9 | Tabs sensíveis? | PR (já ACL); AR/AP/CRM/Comissões (parcial ou só UI) |
| 10 | APIs login vs role? | Maioria exige permissão; gaps auth-only / test-db |
| 11 | Tela usuários/perfis? | AdminUsers + AccessProfiles + PermissionEditor |
| 12 | Tabelas Prisma? | AppUser/Session/AccessProfile; sem Permission table; audits de domínio |
| 13 | Permissionamento parcial? | Sim — catálogo maduro; tabs PR; OR legado; gaps |
| 14 | Código duplicado de role? | Sim — OR finance + asserts SUPER_ADMIN/ADMIN |

---

## Apêndice B — Como regenerar inventário rápido

```bash
npx tsx scripts/inspectPermissionsCurrentState.ts
```

Somente leitura: lista roles, contagem do catálogo, módulos do menu, chaves PR, ausência de `finance.executiveReport.view`.
