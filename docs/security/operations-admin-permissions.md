# Operações + Administração — árvore oficial (PERM-42)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Navegação + abas + ações + APIs alinhadas ao contrato |
| **Inventário** | `docs/security/navigation-permission-inventory.md` §3.5–3.6 |
| **Contrato** | `src/lib/security/permissionContract/resources.ts` |

## Identificação “ammonia”

No planejamento apareceu o rótulo **ammonia**. No código/inventário o recurso correspondente é:

| Nome real (UI) | resourceKey | Rota / aba |
|----------------|-------------|------------|
| **Almoxarifados** | `operations.inventory.warehouses` | `/inventory/warehouses` (aba Estoque) |

Não existe módulo, rota ou chave `ammonia` no repositório.

## Operações — matriz

| Superfície | resourceKey | Actions |
|------------|-------------|---------|
| Estoque | `operations.inventory` | view, manage |
| → Itens | `operations.inventory.items` | view, manage |
| → Almoxarifados | `operations.inventory.warehouses` | view, manage |
| → Movimentações | `operations.inventory.movements` | view, create |
| → Conferências | `operations.inventory.counts` | view, manage, approve |
| Compras | `operations.purchases` | view, create, update, delete |
| Máquinas | `operations.machines` | view, update |
| Performance | `operations.performance` | view, update |
| Ordens de Produção | `operations.production_orders` | view |
| Manutenção Predial | `operations.maintenance` | view, manage |
| Gestão de Frota | `operations.fleet` | view, manage (+ facetas `fleet.*` financeiras) |

Cada submenu libera **individualmente**. Páginas sem grant ficam ocultas no menu; path/API → deny/403.

## Administração — matriz

| Superfície | resourceKey | Notes |
|------------|-------------|-------|
| Pessoas / RH | `admin.employees` (+ facetas) | PII/sensível separados |
| Configurações | `admin.settings` (+ seções) | hub sections |
| Guia | `admin.guide` | sem bleed de `dashboard.view` |

## Bleeds removidos (PERM-42)

| Antes | Depois |
|-------|--------|
| `products.view` → Performance | só `operations.performance` |
| `dashboard.view` → Guia | só `admin.guide` / `guide.view` |
| `finance.cost_centers` / `finance.view` → Fornecedores (bag) | só `finance.suppliers.view` |

## Regras de negócio

Preservadas: movimentações/ajustes/transferências de estoque; CRUD de compras; manutenção predial; frota (incl. `canFinancial` / `fleet.financial.*` separado do page view).

## Testes

```bash
npx tsx --test src/lib/operationsAdmin.perm42.test.ts
npm run test:operations-admin-permissions
npm run test:resource-navigation
npm test
npm run build
```
