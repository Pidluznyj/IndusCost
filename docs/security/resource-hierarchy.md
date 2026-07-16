# PERM-26 — Hierarquia oficial dos recursos

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | PERM-26 |
| **Data** | 2026-07-16 |
| **Inventário** | [`navigation-permission-inventory.md`](./navigation-permission-inventory.md) (PERM-25) |
| **Catálogo único** | `src/lib/security/permissionContract/resources.ts` (`PERMISSION_CONTRACT_RESOURCES`) |
| **Código** | `hierarchyTypes.ts`, `resourceHierarchy.ts` |
| **Migração de módulos** | **Não** nesta etapa |

---

## 1. Objetivo

Definir uma estrutura **única** para representar permissões de:

| Nível | Tipo oficial | Representa |
|-------|--------------|------------|
| Módulo / grupo | `MODULE` | Domínio accordion ou raiz (`engineering`, `finance`, …) |
| Página / submenu | `PAGE` | Item de menu, seção ou tela de detalhe |
| Aba | `TAB` | Aba interna de uma página |
| Ação | `ACTION` | Capacidade mutável modelada como nó (quando existir) **ou** grant `{ resourceKey, action }` na PAGE/TAB |

Não há segundo catálogo: a hierarquia é uma **projeção tipada** do contrato canônico já existente.

---

## 2. Campos de cada recurso

Cada nó da hierarquia expõe (padrão alinhado a `PermissionResource` / seed):

| Campo | Origem no contrato | Notas |
|-------|-------------------|--------|
| `key` | `resourceKey` | Canônico EN (`engineering.products`) |
| `label` | `label` | Texto de UI |
| `type` | inferido → `MODULE` \| `PAGE` \| `TAB` \| `ACTION` | Ver §3 |
| `parentKey` | `parentKey` | `null` = raiz |
| `route` | `route` | SPA quando aplicável; `null` em grupo/aba/ação |
| `order` | `sortOrder` | Ordem entre irmãos |
| `description` | `notes` + flags UI | Texto documental |
| `isActive` | `!deprecated` | Recurso ativo |
| `associatedAction` | ações do nó ACTION | `null` se não for ACTION |
| `supportedActions` | `actions[].action` | view/create/update/… |

API: `toPermissionHierarchyNode` / `listPermissionHierarchyNodes` / `buildPermissionContractCatalog()` (`hierarchyType`, `isActive`).

---

## 3. Classificação oficial

Ordem de decisão (`inferPermissionHierarchyType`):

1. `isInternalAction` → **ACTION**
2. `isTab` → **TAB**
3. `parentKey == null` → **MODULE**
4. demais → **PAGE** (sidebar, seção financeira, detail screen, nested page)

### 3.1 Alias de persistência (seed / Prisma)

O enum Prisma atual permanece `MENU | SUBMENU | TAB | ACTION` até cutover futuro:

| Oficial | Storage legado |
|---------|----------------|
| `MODULE` | `MENU` |
| `PAGE` | `SUBMENU` |
| `TAB` | `TAB` |
| `ACTION` | `ACTION` |

Helpers: `toOfficialHierarchyType`, `toLegacyResourceStorageType`.
Derivação seed (`permissionSeedFromContract`) usa a hierarquia oficial e grava o alias legado.

---

## 4. Exemplo conceitual × chaves reais

O enunciado conceitual:

```text
engineering
engineering.supplies
engineering.supplies.raw_materials
engineering.supplies.market_intelligence
engineering.supplies.raw_materials.create
engineering.supplies.raw_materials.edit
```

No **catálogo atual** (não inventar chaves novas nesta etapa):

```text
engineering                                          → MODULE
engineering.materials                                → PAGE   (/materials)
engineering.materials.market_intelligence            → PAGE
engineering.materials.market_intelligence.home       → TAB    (quando tab)
engineering.products                                 → PAGE
engineering.products.tab.bom                         → TAB
```

**Ações CRUD** seguem a convenção de [`permissions-key-naming.md`](./permissions-key-naming.md): **não** sufixar a chave do recurso com `.create` / `.edit`. O grant é:

```text
{ resourceKey: "engineering.materials", action: "create" }
{ resourceKey: "engineering.materials", action: "update" }
```

Nós `ACTION` separados só quando o contrato já modela `isInternalAction` (ex.: assign seller, facetas internas). Seed PT pode ter ACTION rows (`admin.permissoes.action.manage`) — convivem via merge, sem segundo catálogo canônico.

---

## 5. Políticas oficiais

| Regra | Comportamento | Implementação |
|-------|---------------|---------------|
| Pai visível com filho permitido | Ancestral “virtual” na navegação se algum descendente tem `view` allow; **não** libera `canPerform` no pai | `isHierarchyParentVisible` / `canRevealPermissionNavigation` |
| Recurso desconhecido | **DENY** | `resolveUnknownResourceDeny` / `UNKNOWN_RESOURCE` |
| SUPER_ADMIN | Bypass nas ações **suportadas** do recurso conhecido | `isHierarchySuperAdminBypass` / `SUPER_ADMIN_BYPASS` |
| Aba não sangra para irmãs | Grant de uma TAB não implica view nas demais | `tabGrantDoesNotBleedToSibling` |
| Página ≠ CRUD completo | `view` na PAGE não libera create/update/delete/manage sem grant explícito | `pageViewDoesNotGrantFullCrud` |

Negar o pai com override `view: deny` continua bloqueando a subárvore (`ANCESTOR_VIEW_DENY`).

---

## 6. Mapa resumido por domínio (contrato atual)

Fonte: inventário PERM-25 + `PERMISSION_CONTRACT_RESOURCES`. Tipos inferidos.

### Dashboard

| key | type | route |
|-----|------|-------|
| `dashboard` | MODULE | `/dashboard` |

### Engineering

| key | type | parent | route |
|-----|------|--------|-------|
| `engineering` | MODULE | — | — |
| `engineering.products` | PAGE | engineering | `/products` |
| `engineering.products.tab.*` | TAB | products | — |
| `engineering.transformation_simulator` | PAGE | engineering | `/transformation-simulator` |
| `engineering.materials` | PAGE | engineering | `/materials` |
| `engineering.materials.market_intelligence` (+ tabs) | PAGE/TAB | materials | MI paths |
| `engineering.simulations` | PAGE | engineering | `/simulations` |
| `engineering.projects` (+ detail) | PAGE | engineering | `/projects` |

### Commercial

| key | type | notas |
|-----|------|-------|
| `commercial` | MODULE | grupo |
| `commercial.crm` + tabs | PAGE / TAB | CRM |
| `commercial.customers` | PAGE | `/customers` |
| `commercial.proposals` (+ indicators) | PAGE / TAB | |
| `commercial.sales_orders` (+ detail/invoice) | PAGE | |
| `commercial.pricing` | PAGE | |
| `commercial.commissions` + filhos | PAGE / TAB | |

### Finance

| key | type | notas |
|-----|------|-------|
| `finance` | MODULE | grupo / shell |
| `finance.cash_flow`, `accounts_*`, `billing`, … | PAGE | seções `/finance/*` |
| `finance.portfolio_reconciliation` + order_* | PAGE / TAB | |
| `finance.suppliers`, `opex`, `taxes`, `reports` | PAGE | |

### Operations / Admin

| key | type | notas |
|-----|------|-------|
| `operations` | MODULE | |
| `operations.inventory` (+ items/warehouses/…) | PAGE | abas finas como PAGE filhas no contrato atual |
| `operations.purchases`, `machines`, `performance`, `production_orders`, `maintenance`, `fleet` | PAGE | |
| `admin` | MODULE | |
| `admin.employees` (+ facetas) | PAGE | facetas sensíveis |
| `admin.settings` (+ security, branding, …) | PAGE | |
| `admin.guide` | PAGE | |

> Observação: no contrato, algumas “abas” de estoque são recursos filhos sem `isTab=true` (tratados como PAGE). Ajuste fino de flags fica para migração futura de módulos — fora do PERM-26.

---

## 7. O que não muda nesta etapa

- Sem migração de módulos da sidebar/runtime para novas chaves.
- Sem rename em massa `MENU`→`MODULE` no Prisma/seed PT (apenas alias + projeção).
- Sem alterar guards de produção além do contrato tipado / testes.
- Sem inventar dados de banco.

---

## 8. Testes

```bash
npm run test:permission-contract
npm run test:permission-catalog-seed
# inclui: src/lib/security/permissionContract/resourceHierarchy.test.ts
```

---

## 9. Próximos passos (fora do PERM-26)

1. Cutover do enum Prisma `MENU/SUBMENU` → `MODULE/PAGE` (migration + seed).
2. Alinhar flags `isTab` onde PAGE hoje representa aba de UI (inventory).
3. Migrar módulos um a um consumindo `hierarchyType` na matriz/UI.
4. Atualizar docs que ainda dizem só MENU→SUBMENU→TAB→ACTION.
