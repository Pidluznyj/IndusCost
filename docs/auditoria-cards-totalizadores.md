# Auditoria — Cards Totalizadores Executivos (revisão final)

**Data:** 2026-07-08  
**Status:** migração concluída + revisão global  
**Design system:** `docs/design-system-totalizer-cards.md`

---

## Resumo executivo

O projeto possui componente oficial **`SystemTotalizerCard`** (`src/components/ui/SystemTotalizerCard.tsx`) com CSS unificado em `system-totalizer-card.css`.

**Famílias visuais após migração:**

| Família | Status |
|---------|--------|
| `SystemTotalizerCard` / `FinanceExecutiveTotalizerCard` | **Padrão oficial** |
| `SummaryKpiCard` + grid executivo | **OK** (delega ao CSS) |
| `ContextualDashboardKpiCard` + `ContextualDashboardKpiGrid` | **OK** |
| `FinanceKpiCard` / `FinanceBiKpiCard` legado | Restrito a CC preservado + comissões secundárias |
| Div + `font-black` / `text-4xl+` | **Exceções documentadas** ou fora de escopo totalizador |

---

## Classificação da revisão final (2026-07-08)

### OK — padrão oficial

Financeiro (AR, AP, faturamento, fluxo resumo, relatório presidencial tela), comercial (CRM, clientes, propostas, formação de preço), engenharia (simulador grids, indicadores contextuais), suprimentos (inteligência de mercado), operações (estoque, frota, performance, dashboard), relatórios gerenciais, logs Nomus, pedidos venda, comissões fechamento/liberação, **painel gerencial** (faturamento, pedidos, funil), **inteligência de cliente** (abas), **custos indiretos**, **faturamento ranking clientes**.

### Corrigido nesta revisão

| Tela | Arquivo | Ajuste |
|------|---------|--------|
| Inteligência cliente — abas | `CustomerIntelligence*Tab.tsx` | `CustomerIntelligenceTabKpiGrid` |
| Painel gerencial — faturamento | `ExecutiveBillingTab.tsx` | `ExecutiveDashboardSummaryKpiGrid` |
| Painel gerencial — pedidos | `ExecutiveSalesOrdersTab.tsx` | idem |
| Funil comercial | `SalesFunnelPanel.tsx` | idem |
| Meta mensal (gráficos) | `ExecutiveDashboardCharts.tsx` → `ExecutiveTargetPanel` | idem |
| Faturamento — clientes | `FinanceBillingCustomersTab.tsx` | `FinanceExecutiveTotalizerCard` |
| Faturamento — views YTD | `FinanceBillingExecutiveViews.tsx` | idem |
| Custos indiretos | `IndirectCostModule.tsx` | grid executivo |

### Exceção aprovada (manter)

| Tela | Arquivo | Motivo |
|------|---------|--------|
| CC Mapa resumo | `FinanceCostCenterExpenseMapExecutiveSummary.tsx` | Identidade aprovada |
| CC cards por centro | `ExpenseMapCard` | Identidade aprovada |
| CC CSS | `finance-cc-expense-map-executive-summary.css` | Densidade aprovada |
| CC top cards PDF | `ExecutiveCostCenterTopCardsGrid` | Layout impressão |
| Simulador — comparação what-if | `SimulationModule.tsx` (`text-4xl`) | Herói de cenário |
| Simulador custo transformação | `TransformationCostSimulatorModule.tsx` | Herói de resultado |
| Formação de preço — preço publicado | `PricingModule.tsx` (`text-5xl`) | Destaque comercial |
| Produtos — custo modal | `ProductModule.tsx` + `CalculatedValue` | Explainability |
| Fluxo — posição líquida | `FinanceCashFlowNetPositionHero.tsx` | Herói único |
| Fluxo — painel CFO | `FinanceCashFlowCfoPanel.tsx` | Painel narrativo |
| Open book / composição | `PricingOpenBookTab.tsx`, `OpenBookCompositionTab.tsx` | Workspace analítico |
| Importação de dados | `DataImportDialog.tsx` | Resultado de wizard |
| Capas / landing | `ExecutiveReportCover`, `LandingPage` | Tipografia editorial |

### Centro de Custo preservado — confirmação

Verificado em `e531071` e revisão final: **nenhum arquivo em `src/components/finance/cost-centers/`** importa `SystemTotalizerCard` ou `FinanceExecutiveTotalizerCard`. Mapa de gastos e `ExpenseMapCard` permanecem intactos.

### Ainda fora do padrão (pendências menores — P2)

| Área | Arquivo | Observação |
|------|---------|------------|
| Comissões — páginas secundárias | `CommissionsForecastPage`, `CommissionsConfirmedPage`, etc. | `FinanceKpiCard` legado; funcional |
| Gestão pedidos — dashboards densos | `SalesOrderManagementKpiDashboard` | `MetricCard` sem override |
| Drawer / projeto | `SalesOrderIntelligenceDrawer`, `ProjectCommercialPricingSummaryCards` | `SummaryCard` local |
| CC visão geral / detalhe | `FinanceCostCenterOverviewTab`, `FinanceCostCenterDetailPage` | Preservado por regra de negócio |
| Settings RH | `SettingsModule.tsx` | Salários em tabela, não totalizador |
| Comissões — títulos de seção | `font-extrabold` em `h3` | Título, não card |

---

## Buscas da auditoria global

| Padrão | Resultado |
|--------|-----------|
| `text-4xl` / `text-5xl` / `text-6xl` em KPIs | Restrito a exceções listadas |
| `font-black` / `font-extrabold` em valores de card | Removido dos grids migrados; restante = exceção ou título |
| `MetricCard` / `KpiCard` local | Removido das abas inteligência cliente e painel gerencial |
| Valores monetários quebrando linha | Grid executivo usa `nowrap` + ellipsis |
| CSS próprio agressivo | Unificado em `system-totalizer-card.css` |

---

## Como criar novos cards

Ver **`docs/design-system-totalizer-cards.md`**.

Regra: **novos totalizadores → `FinanceExecutiveTotalizerCard` + `SummaryKpiGrid` + `SYSTEM_TOTALIZER_GRID_CLASS`**.

---

## Validação

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm test
npm run build
npm run check:browser-bundle
```

Testes: `src/lib/systemTotalizerCard.test.ts`, `src/lib/kpiSummaryCardsVisualAudit.test.ts`.

---

## Histórico de commits

| Commit | Descrição |
|--------|-----------|
| `6d8361e` | Auditoria inicial |
| `a64fd9d` | Fase 1 — cards críticos + `SystemTotalizerCard` |
| `7ff980d` | Fase 2 — financeiro |
| `e531071` | Fase 3 — comercial, engenharia, suprimentos, operações |
