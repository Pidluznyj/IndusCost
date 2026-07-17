# Abas autorizadas nas páginas (PERM-37)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Hook central + páginas do inventário §5 |
| **Resolução** | `src/lib/authorizedTabs.ts` |
| **Hook** | `src/hooks/useAuthorizedTabs.ts` |
| **Conteúdo** | `ProtectedTab` (não monta painel negado) |

## Regras

- Aba sem `view` no DTO → não aparece (sem gaps)
- Aba ativa = pedida se permitida; senão primeira permitida
- URL/estado apontando para aba negada → modal PERM-39 (sem Navigate silencioso); OK → primeira rota do catálogo
- Nenhuma aba permitida → modal / página neutra PERM-39 (`UnauthorizedAccessGate`)
- Painel de aba negada não monta → sem chamada de API daquela aba
- `SUPER_ADMIN` vê todas as abas do catálogo
- Ocultação de aba **não** substitui `requireResource` no backend

## API

```ts
resolveAuthorizedTabs(tabs, ctx, { requestedId, parentResourceKey?, requireParentView? })
useAuthorizedTabs({ tabs, requestedId, parentResourceKey?, requireParentView? })
```

## Páginas migradas

| Superfície | Catálogo | Componente |
|------------|----------|------------|
| Financeiro (seções) | `FINANCE_UI_SECTIONS` | `FinanceModule` |
| Conciliação de Carteira | `PORTFOLIO_RECONCILIATION_UI_TABS` (whitelist) | `FinancePortfolioReconciliationPage` |
| CRM gestão | `CRM_UI_TABS` | `CrmCommercialManagementTabs` / `CrmModule` |
| Comissões | `COMMISSIONS_LIVE_UI_TABS` | `CommissionsModule` |
| Suprimentos | `MATERIALS_UI_SECTIONS` | `MaterialsModule` (PERM-40: DTO + folhas MI) |
| Estoque | `INVENTORY_UI_TABS` | `InventoryModule` |
| Produtos (modal) | `PRODUCT_UI_TABS` | `ProductModule` |
| Configurações (hub) | `SETTINGS_HUB_UI_SECTIONS` | `SettingsModule` |

**Fora do escopo fino (herança documentada):** sub-abas Centros de Custo, Fleet, Projects detail, Dashboard — sem resourceKey por aba.

## Testes

```bash
npx tsx --test src/lib/authorizedTabs.perm37.test.ts
npm run test:resource-navigation
```
