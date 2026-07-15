# Auditoria de endpoints × guards de permissão

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Escopo** | Documentação — **sem** correção de código neste prompt |
| **Método** | Inspeção de `server.ts` + `src/lib/*Routes.ts` + middlewares; gaps só com guard localizado |
| **Relacionados** | `permissions-current-state.md`, `permissions-resource-inventory.md` |

### Tipos de guard

| Código | Significado |
|--------|-------------|
| **L** | `requirePermission` / `requireAnyPermission` (chave legada `PERMISSION_CATALOG`) |
| **R** | `requireResourcePermission(resourceKey, action)` |
| **F** | `createFleetRouteGuards` / `canFleet` |
| **B** | Bootstrap cookie OR permission(s) |
| **I** | `requireAppAuth` + verificação **inline** (role/permission no handler/serviço) |
| **P** | Público / token próprio (sem AppUser) |
| **N** | Nenhum auth/permission |

### Severidade de gap

| Nível | Critério |
|-------|----------|
| **crítico** | Mutação sensível ou dados internos sem auth adequada / privilégio inflado comprovado |
| **alto** | Mutação destrutiva com permissão fraca (view) ou ACL incompleta |
| **médio** | Auth-only + inline (frágil) / OR excessivo em leitura / inconsistência UI↔API |
| **baixo** | Higiene, duplicatas, docs stale, cobertura parcial sem impacto imediato |

---

## 1. Wiring central

Arquivo: `server.ts` (~1656+).

```text
createAuthGuards(readAppSession)
  → requireAppAuth, requirePermission, requireAnyPermission

createResourcePermissionGuards(getCurrentAppUser)
  → requireResourcePermission, requireBootstrapOrPermission
```

Resource guards usam `buildPermissionSnapshotForAuth` (seed + aliases da sessão), **não** query live de `RolePermission`/`UserPermissionOverride`.

---

## 2. Endpoints sem autenticação (ou públicos esperados)

| Método | Rota | Arquivo | Guard | Avaliação | Severidade |
|--------|------|---------|-------|-----------|------------|
| GET | `/api/test-db` | `server.ts` ~2264 | **N** | Conta tabelas Prisma sem auth | **crítico** |
| GET | `/api/health` (se existir) | server | N/P | esperado | — |
| * | `/api/auth/login`, logout, me, bootstrap | server | P/session | esperado | — |
| * | `/api/public/fleet/*` | public fleet routes | P | esperado (token/QR) | — |

**Gap crítico confirmado:** `GET /api/test-db` — handler sem `requireAppAuth`.

---

## 3. Sync Nomus / Billing (privilégio inflado)

Evidência: `src/lib/settingsNomusSyncRoutes.ts`, `src/lib/financeBillingRoutes.ts`.

| Método | Rota (padrão) | Guard localizado | Permissões OR | Severidade |
|--------|---------------|------------------|---------------|------------|
| POST | `/api/settings/nomus-sync/daily-run` | B `requireBootstrapOrAnyPermission` | `settings.nomus.sync` **\|\| `settings.view`** | **crítico** |
| POST | `…/accounts-receivable-run` | B | sync \|\| `settings.view` | **crítico** |
| POST | `…/accounts-payable-run` | B | sync \|\| `settings.view` | **crítico** |
| POST | `…/nfes-run` | B | sync \|\| `settings.view` | **crítico** |
| GET | status/logs Nomus sync | B | `settings.nomus.view` \|\| `settings.view` | médio (leitura) |
| POST | `/api/finance/billing/sync` | L `requireAnyPermission` | `settings.nomus.sync` **\|\| `settings.view`** | **crítico** |

**Inconsistência UI:** helper de sync NFe no client exige tipicamente só `settings.nomus.sync`, enquanto a API aceita qualquer usuário com `settings.view`.

**Nota:** esta auditoria **não** altera esses ORs (escopo docs-only / fora de produção).

---

## 4. Pricing — mutações com `pricing.view`

Evidência: `server.ts` ~9242–9357.

| Método | Rota | Guard | Gap |
|--------|------|-------|-----|
| GET | `/api/pricing` | L `pricing.view` | OK leitura |
| POST | `/api/pricing` | L **`pricing.view`** | **alto** — create com view |
| POST | `/api/pricing/bulk-delete` | L **`pricing.view`** | **alto** |
| DELETE | `/api/pricing/:id` | L **`pricing.view`** | **alto** |

Não há `pricing.create|edit|delete` no catálogo; mutate keys existentes são `pricing.simulate`, `pricing.generate_tables`, `pricing.publish_tables`.

---

## 5. Domínios por prefixo (inventário representativo)

> Não lista cada handler linha-a-linha; cobre o padrão dominante + anomalias. Onde o guard **não** foi localizado, o gap não é declarado “protegido”.

### 5.1 Core `server.ts` (legado dominante)

| Prefixo | Métodos típicos | Permissão / guard | Gap |
|---------|-----------------|-------------------|-----|
| `/api/dashboard` | GET | L `dashboard.view` | — |
| `/api/machines` | CRUD | L `machines.view` / `.edit` | — |
| `/api/employees` | CRUD | L `employees.view` / `.edit` | — |
| `/api/materials` | CRUD + import | L `materials.view` / `.edit` | — |
| `/api/materials` MI tabs | GET selected | R `suprimentos.inteligencia_mercado.tab.*` | parcial vs materials.* |
| `/api/cost-centers` (compras) | * | L `purchases.view` / `.edit` | — |
| `/api/purchase-requests` | * | L `purchases.view` / `.create` / `.edit` | `purchases.delete` pouco/não em API |
| `/api/products*` | grande | L `products.*` | delete OK `products.delete` |
| `/api/indirect-costs` | CRUD | L `opex.*` + B mutate | — |
| `/api/price-tables*`, production/material cost | * | L pricing/settings.price_tables / costs | OR inclui view |
| `/api/tax-rules` | CRUD | L `taxes.view` / `.edit` | — |
| `/api/pricing` | ver §4 | L `pricing.view` | **alto** |
| `/api/simulations*`, new-product-simulations | * | L `simulations.view` / `.create` | — |
| `/api/customers` | CRUD/import | L `customers.*` | — |
| `/api/crm/*` | dashboards | L + R tabs CRM | — |
| `/api/proposals` | CRUD | L `proposals.*` | — |
| `/api/sales-orders` | GET | L `sales_orders.view` / `.detail.view` | — |
| `/api/maintenance-requests` | * | L `maintenance.view` / `.manage` | — |
| `/api/roles`, payroll-components | * | B `settings.operational.*` / `users.manage` | — |
| `/api/admin/users*` | * | R admin + B wrappers | — |
| `/api/reports/data` | GET | L `reports.view` | — |

### 5.2 Finance modular

| Prefixo | Arquivo | Guard | Observação / gap |
|---------|---------|-------|------------------|
| `/api/finance/accounts-receivable*` | finance AR routes | L any | OR: AR + finance + reports + **`settings.view`** → **médio/alto** leitura |
| `/api/finance/accounts-payable*` | AP routes | L any | idem + classify manage |
| `/api/finance/cash-flow*` | cash-flow | L any | OR largo incl. settings → **médio** |
| `/api/finance/billing*` | financeBillingRoutes | L any | sync → §3 **crítico** |
| `/api/finance/suppliers*` | financeSuppliersRoutes | L + R execute rebuild | DELETE: auth + SUPER_ADMIN **I** → **médio** (frágil) |
| `/api/finance/cost-centers*` | CC routes | L | manage/view |
| `/api/finance/portfolio-reconciliation*` | financePortfolioReconciliationRoutes | **R** tabs/módulo | referência boa |
| `/api/finance/executive-report*` | executive | L any | finance/reports OR |

### 5.3 Commissions

Arquivo: `commissionsRoutes.ts` (híbrido).

| Área | Guard | Gap |
|------|-------|-----|
| GETs de tabs | R `comissoes.tab.*` (view) + fallbacks OR legado (`resourceOrAny`) | — |
| payments / people / rules / settings manage | L `commissions.*.manage` | — |
| receipt-closing apply, payment-batches, mark-paid | L `commissions.payments.manage` | OK (alto risco, guardado) |
| recalculate / reprocess | L rules+payments manage | OK |

### 5.4 Fleet

| Prefixo | Guard | Gap |
|---------|-------|-----|
| `/api/fleet/*` (maioria) | **F** `FLEET_ROUTE_GUARDS` → `fleet.*` | — |
| `/api/fleet/admin/reservations-cleanup*` | **I** SUPER_ADMIN | médio (auth MW only) |
| `/api/public/fleet/*` | P | esperado |

### 5.5 Inventory / Projects

| Prefixo | Guard | Gap |
|---------|-------|-----|
| `/api/inventory/*` | L any `inventory.*` | — |
| `/api/projects/*` | L view/manage; DELETE **I** SUPER_ADMIN | médio |

### 5.6 Access profiles / user ACL

| Prefixo | Guard | Gap |
|---------|-------|-----|
| `/api/access-profiles*` | R `admin.permissoes` view / action.manage | — |
| user permission-overrides | R admin manage | dual-write legado |

### 5.7 Market intelligence extras

| Prefixo | Guard | Gap |
|---------|-------|-----|
| quotes approve/reject/set-official | L materials.view/edit/approve | — |
| reliability PATCH | **I** materials.edit / ADMIN | médio |
| attachment DELETE | **I** materials.edit/view | médio |

### 5.8 CRM commercial owner

| Método | Rota | Guard | Gap |
|--------|------|-------|-----|
| PATCH | `/api/crm/customers/:id/commercial-owner` | auth + check **I** em service (`crm.customers.assign_seller`) | **médio** — sem `requirePermission` no middleware |

---

## 6. Matriz de mutações de alto risco

| Operação | Rota(s) | Guard encontrado? | Severidade residual |
|----------|---------|-------------------|---------------------|
| Product delete / bulk | DELETE/POST products | Sim — `products.delete` | — |
| Proposal delete | DELETE proposals | Sim — `proposals.delete` | — |
| Pricing delete / bulk | DELETE/POST pricing | Sim mas **`pricing.view`** | **alto** |
| Commission payout / closing apply | payment-batches / receipt-closing | Sim — `commissions.payments.manage` | — |
| Commission reprocess | recalculate/reprocess | Sim — manage | — |
| Nomus sync runs | settings nomus-sync POST | Sim — OR **`settings.view`** | **crítico** |
| Billing sync | POST finance/billing/sync | Sim — OR **`settings.view`** | **crítico** |
| Supplier rebuild apply | rebuild-from-ap-apply | Sim — manage + R execute | — |
| Supplier delete | DELETE suppliers | Sim — SUPER_ADMIN **I** | médio |
| Fleet cleanup | admin cleanup | Sim — SUPER_ADMIN **I** | médio |
| Publish price tables | publish endpoints | Sim — publish/manage keys | — |
| Inventory count approve / movements | inventory APIs | Sim — manage/create keys | — |
| Projects delete | DELETE projects | Sim — SUPER_ADMIN **I** | médio |
| Test DB | GET test-db | **Não** | **crítico** |

---

## 7. Chaves usadas em guards vs catálogo

### 7.1 Legado

Literais `requirePermission` / `requireAnyPermission` observados nos domínios acima resolvem para entradas em `PERMISSION_CATALOG` (175 keys). **Não** se declara FANTASMA legado sem match nesta auditoria.

### 7.2 Resource (fora do PERMISSION_CATALOG — esperado)

Exemplos usados em **R**:

- `admin.usuarios`, `admin.permissoes`, `admin.permissoes.action.manage`
- `comissoes.tab.*`
- `financeiro.conciliacao_carteira*`
- `financeiro.contas_pagar` (execute em rebuild)
- `comercial.crm.tab.*`
- `suprimentos.inteligencia_mercado.tab.*`

Bridged via `legacyAliasKeys` no seed / snapshot.

### 7.3 FE vs BE resource id de Settings

| Camada | Chave |
|--------|-------|
| `permissionsClient.ResourceKeys.CONFIGURACOES` | `configuracoes` |
| `PermissionResourceKeys.ADMIN` / seed | `admin` |

Gap de alinhamento de catálogo: **alto** (nav Settings).

---

## 8. Gaps consolidados por severidade

### Crítico

1. `GET /api/test-db` sem autenticação (`server.ts`).
2. POSTs de sync Nomus (`settingsNomusSyncRoutes.ts`) aceitam `settings.view`.
3. `POST /api/finance/billing/sync` aceita `settings.view`.

### Alto

1. `POST/DELETE /api/pricing*` mutações com apenas `pricing.view`.
2. Leituras financeiras amplas via OR `settings.view` / `reports.view` (vários `FINANCE_*_VIEW_PERMISSIONS`).
3. Dual key Settings `configuracoes` (FE) vs `admin` (seed/BE).
4. Migração híbrida incompleta (parte R, parte L com ORs).

### Médio

1. Deletes/sensíveis com middleware só `requireAppAuth` + check inline (suppliers, projects, fleet cleanup, MI reliability).
2. CRM commercial-owner sem middleware de permissão.
3. UI sync mais estrita que API (ou vice-versa) — inconsistência operador.
4. Exports sales-orders no client sem chave dedicada (depende do backend).

### Baixo

1. Duplicatas de catálogo (termination aliases; inventory movement(s)).
2. Abas resource seeded mas UI-ocultas.
3. Script/relatório `docs/generated/permissions-audit-report.md` potencialmente stale; `audit:permissions` foca `server.ts`.
4. `RequirePermission` de rota SPA inexistente (mitigado por Layout + API).

---

## 9. O que **não** foi alterado nesta etapa

- Nenhum guard modificado.
- Nenhum comportamento de AR/AP/Fluxo/Comissões pagas/ledgers/Nomus sync/Formação de Preço/Pedidos/NF alterado.
- Sem migration / sem acesso a produção.

Correções de código dos gaps críticos/altos devem ser prompts separados, com plano de regressão.

---

## 10. Como revalidar

```bash
npx prisma validate
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
# opcional: npm run audit:permissions  (cobertura parcial — principalmente server.ts)
```

Grep útil:

```bash
rg "requirePermission\\(|requireAnyPermission\\(|requireResourcePermission\\(|requireAppAuth" server.ts src/lib/*Routes.ts src/lib/**/*Routes.ts
rg "app\\.get\\(\"/api/test-db\"" server.ts
rg "settings\\.nomus\\.sync\".*settings\\.view|settings\\.view.*settings\\.nomus\\.sync" src/lib
```
