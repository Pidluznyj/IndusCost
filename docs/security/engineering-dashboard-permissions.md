# Dashboard + Engenharia — árvore oficial (PERM-40)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Navegação + abas + ações + APIs satélite alinhadas ao contrato |
| **Inventário** | `docs/security/navigation-permission-inventory.md` §3.1–3.2 |
| **Contrato** | `src/lib/security/permissionContract/resources.ts` |

## Objetivo validado

É possível liberar **apenas**:

```
Engenharia
└── Suprimentos                    engineering.materials
    ├── Matérias-primas            (tab catalogo ↔ engineering.materials)
    └── Inteligência de Mercado    engineering.materials.market_intelligence*
```

e **negar** Produtos, Simulações, Projetos, Simulador de Injeção, Dashboard e demais módulos.

## Matriz (persona Suprimentos + MI)

| Superfície | resourceKey | View | Resultado |
|------------|-------------|------|-----------|
| Dashboard | `dashboard` | negado | fora do menu / path deny |
| Produtos | `engineering.products` | negado | oculto |
| Simulador | `engineering.transformation_simulator` | negado | oculto |
| Suprimentos | `engineering.materials` (+ folhas MI) | allow | menu Engenharia → Suprimentos |
| Matérias-primas (aba) | `engineering.materials` | allow | tab visível |
| IM Home | `…market_intelligence.home` | allow | tab Inteligência |
| IM 360 | `…material_360` | allow | detalhe |
| IM Cotações | `…quotes` | allow | list/CRUD conforme actions |
| Simulações | `engineering.simulations` | negado | oculto |
| Projetos | `engineering.projects` | negado | oculto |

## Ações CRUD (catálogo)

| Superfície | resourceKey | Actions |
|------------|-------------|---------|
| Matérias-primas | `engineering.materials` | view, update (edit) |
| Cotações MI | `engineering.materials.market_intelligence.quotes` | view, update, approve, execute |
| Simulações | `engineering.simulations` | view, create |
| Produtos | `engineering.products` | create, update, delete, export |

FE: `canEditMaterials` / `canEditMarketQuotes` / `canApproveMarketQuote` / `canCreateSimulations` via `canPerformAction`.  
BE: `requireResource` nas rotas de catálogo, MI leaf e satélites (Brent/PTAX/export/audit/anexos/governança).

## Regras de negócio

Não alteradas — apenas gates de autorização e wiring de resourceKey.

## Testes

```bash
npx tsx --test src/lib/engineeringDashboard.perm40.test.ts
npm run test:resource-navigation
npm test
npm run build
```
