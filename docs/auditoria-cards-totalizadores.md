# Auditoria — Cards Totalizadores Executivos

**Data:** 2026-07-08  
**Escopo:** inventário visual de cards totalizadores / resumo / KPI em todo o sistema.  
**Fora deste prompt:** correção de telas (apenas documentação e plano).

---

## Resumo executivo

O projeto **ainda não possui** um componente único `SystemTotalizerCard` consolidado. O padrão visual aprovado do **Fluxo de Caixa** está implementado como:

| Camada | Artefato |
|--------|----------|
| Componente | `FinanceCashFlowExecutiveMetricCard` |
| Base | `MetricCard` |
| Grid / seção | `ExecutiveSummarySection` + `SummaryKpiGrid` |
| CSS executivo | `finance-cash-flow-executive-summary.css` |
| Formatação | `formatCashFlowKpiDisplay` (`financeCashFlowDisplay.ts`) |

Há **quatro famílias visuais** coexistindo:

1. **Executivo aprovado (referência)** — Fluxo de Caixa, Comercial Pedidos (lista), Logs Nomus Sync (CSS dedicado).
2. **MetricCard sem override** — usa `metric-card.css` padrão (`font-weight: 800`, valores grandes).
3. **Legado BI** — `FinanceKpiCard` → `FinanceBiKpiCard` → `MetricCard` (sem CSS executivo; tema `financeBiDashboardTheme.ts`).
4. **Ad hoc Tailwind** — `font-black` / `text-3xl`–`text-5xl` em divs soltas (Simulação, Produtos, Pricing, Dashboard).

**Contagem aproximada (código `src/`):**

| Indicador | Quantidade |
|-----------|------------|
| Arquivos com `FinanceKpiCard` | 24 |
| Arquivos com `FinanceBiKpiCard` (direto) | 11 |
| Arquivos com `MetricCard` | ~45 |
| Arquivos com CSS executivo dedicado | 4 |
| Arquivos com `font-black` em valores/cards | ~22 (~79 ocorrências) |
| Telas **já no padrão executivo** (com override CSS) | 4 blocos principais |
| Telas **fora do escopo** (Centro de Custo aprovado) | 3 áreas |

**Telas mais críticas (P0):** Simulador, Simulador de custo de transformação, Formação de Preço (hero cards), Produtos (totais de custo), painéis do Dashboard executivo com `font-black`, heróis do Fluxo (`FinanceCashFlowNetPositionHero`, `FinanceCashFlowCfoPanel`) fora do grid executivo.

---

## Padrão oficial desejado (referência)

Extrair de:

```
FinanceCashFlowExecutiveMetricCard
  → MetricCard + className finance-cash-flow-metric-card
  → grid finance-cash-flow-metric-grid
  → finance-cash-flow-executive-summary.css
```

Regras visuais observadas:

- Label ~11px, `font-weight: 600`, uppercase.
- Valor `clamp(1.375rem … 1.875rem)`, `font-weight: 600` (não 800).
- `white-space: nowrap` + ellipsis em valores monetários.
- Ícone 0.875rem em box 1.75rem.
- Altura estável ~104–108px.
- Faixa lateral 4px, sombra suave.

**Próximo passo de design system (prompt anterior):** consolidar em `SystemTotalizerCard` reutilizando esta base, sem duplicar CSS por tela.

---

## Componentes encontrados

| Componente | Papel | Alinhado? | Observação |
|------------|-------|-----------|------------|
| `MetricCard` | Base universal | Parcial | `metric-card.css` ainda usa `font-weight: 800` e clamp alto |
| `FinanceCashFlowExecutiveMetricCard` | Referência Fluxo de Caixa | **Sim** | Padrão alvo |
| `SummaryKpiCard` | Alias de `MetricCard` | Parcial | Sem CSS executivo |
| `FinanceBiKpiCard` | Legado BI | **Não** | Delega a MetricCard sem override |
| `FinanceKpiCard` | Wrapper BI | **Não** | Usado em ~24 telas financeiras/comissões |
| `ExecutiveKpiCard` | Relatório presidencial | Variante | CSS print próprio |
| `FinanceCashFlowKpiCard` | Legado fluxo | **Não** | Substituído pelo executivo no resumo principal |
| `SummaryCard` (sales drawer) | Drawer comercial | **Não** | Valor simples sem padrão |
| `ContextualDashboardKpiCard` | Contextual | **Não** | CSS próprio |
| `ExpenseMapCard` | CC Mapa individual | **Preservar** | Fora do escopo |
| Div + `font-black` | Ad hoc | **Não** | Muitas telas de engenharia/comercial |

### CSS executivo duplicado (candidatos a unificar)

| Arquivo | Tela |
|---------|------|
| `finance-cash-flow-executive-summary.css` | Fluxo de Caixa |
| `sales-order-list-summary-cards.css` | Comercial → Pedidos (lista) |
| `nomus-sync-metric-cards.css` | Config → Logs Nomus |
| `finance-cc-expense-map-executive-summary.css` | CC Mapa (**preservar**) |

---

## Telas preservadas (fora do escopo)

> **Não migrar automaticamente** sem validação visual explícita.

| Tela | Arquivo(s) | Motivo |
|------|------------|--------|
| Financeiro → Centros de Custo → Mapa de Gastos (resumo) | `FinanceCostCenterExpenseMapExecutiveSummary.tsx` | Identidade aprovada |
| Mapa de Gastos (cards por centro) | `FinanceCostCenterExpenseMapSection.tsx` → `ExpenseMapCard` | Identidade aprovada |
| CSS do mapa CC | `finance-cc-expense-map-executive-summary.css` | Densidade compacta aprovada |
| Relatório Presidencial → top cards CC (PDF) | `ExecutiveCostCenterTopCardsGrid` / print CSS | Layout PDF específico |

---

## Matriz por módulo

Legenda de prioridade:

- **P0** — valor quebra / fonte agressiva / aparência muito abaixo do padrão.
- **P1** — legado BI ou MetricCard sem override; funcional mas inconsistente.
- **P2** — refinamento ou domínio secundário.
- **Fora** — preservar (Centro de Custo aprovado).

### Dashboard principal

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Dashboard RH / custos | `DashboardModule.tsx` | StatCard custom | Visual próprio `rounded-3xl` | Não | P2 |
| Painel gerencial | `ExecutiveDashboardPanel.tsx` | Títulos `font-black` | Tipografia agressiva | Não | P1 |
| Funil comercial | `SalesFunnelPanel.tsx` | Cards `text-xl font-black` | Valores grandes, truncamento parcial | Não | P0 |
| Faturamento executivo | `ExecutiveBillingTab.tsx` | 5× `font-black` | Fora do padrão executivo | Não | P0 |
| Pedidos executivo | `ExecutiveSalesOrdersTab.tsx` | `font-black` | Idem | Não | P1 |
| Gráficos executivos | `ExecutiveDashboardCharts.tsx` | KPI inline `font-black` | Idem | Não | P1 |

### Financeiro — Fluxo de Caixa

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Resumo executivo | `FinanceCashFlowExecutiveSummaryPanel.tsx` | `FinanceCashFlowExecutiveMetricCard` | — | **Sim** | — |
| YTD | `FinanceCashFlowYtdSummary.tsx` | MetricCard + CSS fluxo | Alinhado ao fluxo | **Sim** | — |
| Herói posição líquida | `FinanceCashFlowNetPositionHero.tsx` | `text-3xl/4xl font-extrabold break-words` | Quebra de valor | Não | P0 |
| Painel CFO / saúde | `FinanceCashFlowCfoPanel.tsx` | `text-4xl font-bold` | Fora do grid executivo | Não | P1 |
| Comparativo anual | `FinanceCashFlowAnnualComparisonChart.tsx` | MetricCard grid | Sem CSS executivo dedicado | Parcial | P2 |
| Legado KPI | `FinanceCashFlowKpiCard.tsx` | Wrapper BI | Legado | Não | P2 |

### Financeiro — Contas a Receber / Pagar / Faturamento / Pedidos

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Contas a Receber | `FinanceAccountsReceivablePage.tsx` | `FinanceBiKpiCard` × ~10 | Sem faixa/typo executiva | Não | P1 |
| AR Inadimplência | `FinanceAccountsReceivableOverdueTab.tsx` | `FinanceKpiCard` denso | Grid sem seção | Não | P1 |
| AR Analítico | `FinanceArAnalyticalTitlesTab.tsx` | `MetricCard` | Base 800 sem override | Parcial | P2 |
| Contas a Pagar | `FinanceAccountsPayablePage.tsx` | `FinanceKpiCard` × ~12 | Legado BI | Não | P1 |
| Faturamento | `FinanceBillingPage.tsx` | `FinanceBillingKpiGroup` + BI | Groups OK, cards legado | Não | P1 |
| Faturamento views | `FinanceBillingExecutiveViews.tsx` | `text-lg font-black` | Ad hoc | Não | P0 |
| Faturamento clientes | `FinanceBillingCustomersTab.tsx` | `font-black` × 3 | Ad hoc | Não | P1 |
| Pedidos financeiro | `FinanceSalesOrdersPage.tsx` | `FinanceKpiCard` × ~9 | Sem resumo executivo | Não | P0 |
| Horizonte AR/AP | `FinanceHorizonSection.tsx` | `FinanceKpiCard` | Inline em drilldown | Não | P1 |
| Aging drilldown | `FinanceAgingBucketDrilldownSection.tsx` | `FinanceKpiCard` | Idem | Não | P1 |

### Financeiro — Relatório Presidencial

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Documento | `ExecutiveReportDocument.tsx` + `ExecutiveKpiCard.tsx` | Variante PDF | CSS print próprio | Variante | P2 |
| Capa | `ExecutiveReportCover.tsx` | `text-4xl/5xl` | Título, não KPI | N/A | — |

### Financeiro — Centros de Custo

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Mapa — resumo | `FinanceCostCenterExpenseMapExecutiveSummary.tsx` | MetricCard + CSS CC | Aprovado | **Fora** | Fora |
| Mapa — cards centro | `ExpenseMapCard` | Próprio | Aprovado | **Fora** | Fora |
| Visão geral CC | `FinanceCostCenterOverviewTab.tsx` | `FinanceKpiCard` | Inconsistente com Mapa | Não | P1 |
| Detalhe CC | `FinanceCostCenterDetailPage.tsx` | `FinanceKpiCard` | Idem | Não | P1 |
| Fornecedor drilldown | `FinanceSupplierPaymentDrilldownSection.tsx` | `FinanceKpiCard` | Poucos KPIs soltos | Não | P2 |

### Comercial — Pedidos de Venda

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Lista — resumo | `SalesOrderListSummaryCards.tsx` | MetricCard + CSS dedicado | Alinhado recentemente | **Sim** | — |
| Gestão — principal | `SalesOrderManagementKpiDashboard.tsx` | MetricCard mix | Sem CSS executivo unificado | Parcial | P1 |
| Gestão — secundário | `SalesOrderManagementKpiSecondaryPanel.tsx` | MetricCard × muitos | Densidade alta | Parcial | P1 |
| Resultado pedido | `SalesOrderResultPage.tsx` | MetricCard grid | Sem override executivo | Parcial | P2 |
| Indicadores | `SalesOrdersIndicatorsDashboard.tsx` | `FinanceBiKpiCard` | Legado | Não | P1 |
| Drawer inteligência | `SalesOrderIntelligenceDrawer.tsx` | `SummaryCard` | Fora do padrão | Não | P2 |

### Comercial — CRM / Clientes / Formação de Preço

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| CRM gestão | `CrmManagementDashboardSection.tsx` | MetricCard | Sem override | Parcial | P2 |
| CRM vendedor | `CrmSellerDashboardSection.tsx` | MetricCard | Idem | Parcial | P2 |
| Cliente 360 | `CustomerCommercial360.tsx` | `FinanceBiKpiCard` + `font-black` | Mix legado/ad hoc | Não | P1 |
| Inteligência cliente | `CustomerIntelligenceKpiGrid.tsx` | MetricCard | Sem override | Parcial | P2 |
| Produtos vendidos | `SoldProductsReportPage.tsx` | `FinanceBiKpiCard` | Legado | Não | P1 |
| Clientes produto | `SoldProductCustomersPage.tsx` | `FinanceBiKpiCard` | Legado | Não | P1 |
| Formação preço — auditoria | `CostPriceMarginAuditPanel.tsx` | MetricCard | Sem override | Parcial | P2 |
| Formação preço — módulo | `PricingModule.tsx` | `text-5xl font-black` hero | Muito agressivo | Não | P0 |
| Open book | `PricingOpenBookTab.tsx` | `font-black` | Ad hoc | Não | P1 |
| Simulação formação | `PricingFormationIndicatorsDashboard.tsx` | Contextual KPI | CSS próprio | Não | P2 |

### Comercial — Comissões

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Dashboard | `CommissionsDashboardPage.tsx` | `FinanceKpiCard` × ~8 | Grid denso, sem seção | Não | P0 |
| Fechamento recebimento | `CommissionsReceiptClosingPage.tsx` | `FinanceKpiCard` × ~16 | Maior densidade do sistema | Não | P0 |
| Auditoria visual | `CommissionsVisualAuditPage.tsx` | 8 cards/modo | Grid custom | Não | P0 |
| Previstas | `CommissionsForecastPage.tsx` | 6 KPIs | Sem wrapper | Não | P1 |
| Confirmadas | `CommissionsConfirmedPage.tsx` | Idem | Idem | Não | P1 |
| Liberação | `CommissionsReleasesPage.tsx` | Idem | Idem | Não | P1 |
| Pagamentos | `CommissionsPaymentsPage.tsx` | Idem | Idem | Não | P1 |
| Apuração | `CommissionsApuracaoPage.tsx` | Totais BI | Idem | Não | P1 |
| Fechamento mensal | `CommissionsMonthlyClosingPage.tsx` | 6+ KPIs | Idem | Não | P1 |
| Previsão CR | `CommissionsReceivableForecastPage.tsx` | Idem | Idem | Não | P1 |
| Auditoria | `CommissionsAuditPage.tsx` | Resumo BI | Idem | Não | P2 |
| Visões AR | `CommissionsArViewPage.tsx` | 4 KPIs soltos | Idem | Não | P2 |
| UI compartilhada | `commissionsUi.tsx` | `FinanceKpiCard` | Legado centralizado | Não | P1 |

### Engenharia — Produtos / Simulador

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Produtos — custo | `ProductModule.tsx` | `text-3xl font-black` × 3 | Totais gigantes | Não | P0 |
| Open book produto | `OpenBookCompositionTab.tsx` | `font-black` | Ad hoc | Não | P1 |
| Injeção breakdown | `ComponentInjectionCalculationBreakdown.tsx` | `text-lg font-black` | Ad hoc | Não | P2 |
| Status Nomus | `NomusEngineeringStatusBoard.tsx` | MetricCard | Sem override | Parcial | P2 |
| Simulador | `SimulationModule.tsx` | `font-black` × 31, `text-4xl` | Pior caso do sistema | Não | P0 |
| Simulador custo transformação | `TransformationCostSimulatorModule.tsx` | `text-4xl/5xl font-black` | Heróis gigantes | Não | P0 |

### Suprimentos / Inteligência de Mercado

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Materiais — preço | `MaterialIntelligencePriceAnalyticsSection.tsx` | `SummaryKpiCard` × 12 | Sem CSS executivo | Parcial | P1 |
| Materiais — global | `MaterialsMarketGlobalIndicatorsSection.tsx` | MetricCard | Sem override | Parcial | P2 |
| Materiais — relatórios | `MaterialsMarketIntelligenceReportsPage.tsx` | MetricCard | Idem | Parcial | P2 |
| Demanda planejada | `MaterialDemandPlannedRealizedPanel.tsx` | MetricCard | Alinhado estrutura, sem override | Parcial | P2 |
| Compras indicadores | `PurchaseIndicatorsDashboard.tsx` | Contextual KPI | CSS próprio | Não | P2 |
| Estoque dashboard | `InventoryDashboardTab.tsx` | MetricCard | Sem override | Parcial | P2 |

### Configurações / Logs Nomus

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Logs sync Nomus | `NomusDailySyncCard.tsx` etc. | MetricCard + `nomus-sync-metric-grid` | Alinhado recentemente | **Sim** | — |
| Settings RH/custos | `SettingsModule.tsx` | `font-black` em salários | Não é KPI executivo | N/A | P2 |

### Relatórios / Auditoria / Operações

| Tela | Arquivo | Card(s) | Problema | Padrão? | Prioridade |
|------|---------|---------|----------|---------|------------|
| Relatórios | `ReportsModule.tsx` | MetricCard | Sem override | Parcial | P2 |
| Cost-to-cash | `CostToCashTraceSections.tsx` | MetricCard | Estrutura OK | Parcial | P2 |
| Frota | `FleetOverviewTab.tsx` | KPI contextual | CSS próprio | Não | P2 |
| Projetos | `ProjectCommercialPricingSummaryCards.tsx` | MetricCard | Sem override | Parcial | P2 |

---

## Problemas visuais recorrentes

1. **`metric-card.css` base agressivo** — `font-weight: 800`, clamp até ~2.125rem; afeta todo `MetricCard` sem override.
2. **CSS executivo fragmentado** — 4 arquivos quase idênticos (fluxo, vendas, nomus, CC mapa).
3. **Legado `FinanceKpiCard`** — ~24 telas; labels `normal-case` em alguns contextos; sem grid executivo.
4. **Ad hoc `font-black`** — Simulação, Pricing, Produtos, Dashboard (~79 ocorrências em ~22 arquivos).
5. **Quebra de valores** — `break-words` / `overflow-wrap: anywhere` em heróis de fluxo e billing.
6. **Grids densos** — Comissões com 16+ cards sem agrupamento em seções.
7. **Inconsistência intra-módulo** — CC Mapa (aprovado) vs CC Visão geral (legado BI).

---

## Plano de correção por fases

### Fase 0 — Design system (pré-requisito)

- Criar `SystemTotalizerCard` extraindo `FinanceCashFlowExecutiveMetricCard` + CSS unificado (`system-totalizer-card.css`).
- Ajustar `metric-card.css` default para não forçar 800 em novos usos (ou documentar que totalizadores **devem** usar `SystemTotalizerCard`).
- Documentar em `docs/design-system-totalizer-cards.md`.
- **Não alterar** CC Mapa / `ExpenseMapCard`.

### Fase 1 — Alto impacto financeiro/comercial (P0)

- Financeiro → Pedidos de Venda (`FinanceSalesOrdersPage`).
- Comercial → Comissões (Dashboard, Fechamento recebimento, Auditoria visual).
- Configurações → Logs Nomus (já OK; apenas migrar para `SystemTotalizerCard` quando existir).
- Comercial → Pedidos lista (já OK; consolidar CSS).
- Heróis Fluxo de Caixa fora do grid (`NetPositionHero`, `CfoPanel`).

### Fase 2 — Financeiro core (P1)

- Contas a Receber + Inadimplência.
- Contas a Pagar.
- Faturamento (+ `FinanceBillingExecutiveViews`).
- Relatório Presidencial (tela, não print).
- Horizonte / aging drilldowns.

### Fase 3 — Comercial / CRM (P1–P2)

- Gestão de pedidos (dashboards secundários).
- CRM 360, produtos vendidos, clientes.
- Formação de preço (exceto hero do simulador → Fase 1).

### Fase 4 — Engenharia / Suprimentos (P0–P2)

- **P0:** `SimulationModule`, `TransformationCostSimulatorModule`, `ProductModule`, `PricingModule` hero.
- **P1–P2:** Materiais, estoque, projetos, relatórios.

### Fase 5 — Dashboard executivo e refinamentos (P1–P2)

- `SalesFunnelPanel`, `ExecutiveBillingTab`, `ExecutiveDashboardCharts`.
- Telas com `MetricCard` sem override (migrar para `SystemTotalizerCard`).

---

## Riscos e garantias

| Risco | Mitigação |
|-------|-----------|
| Alterar cálculo/API | Apenas CSS/componente; valores via props existentes |
| Quebrar CC aprovado | Lista explícita “fora do escopo”; code review por arquivo |
| Regressão Fluxo de Caixa | Manter `FinanceCashFlowExecutiveMetricCard` como thin wrapper do novo padrão |
| Comissões com muitos cards | Agrupar em `ExecutiveSummarySection` antes de trocar componente |

---

## Referências

- Auditoria anterior: `docs/audits/kpi-summary-cards-visual-audit.md`
- Teste estático: `src/lib/kpiSummaryCardsVisualAudit.test.ts`
- Padrão fluxo: `src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard.tsx`

---

## Checklist YAGNI (respostas)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Quais telas usam cards totalizadores? | ~70+ arquivos; ver matriz acima |
| 2 | Quais já usam o padrão novo? | Fluxo resumo, Pedidos lista, Logs Nomus, CC Mapa resumo (preservar) |
| 3 | CSS próprio duplicado? | 4 CSS executivos + tema BI + ad hoc Tailwind |
| 4 | `text-4xl` / `font-black`? | ~22 arquivos; Simulação e Pricing são os piores |
| 5 | Valores quebrando? | `FinanceCashFlowNetPositionHero`, billing views, funnel |
| 6 | CC preservar? | Mapa resumo + ExpenseMapCard + CSS CC |
| 7 | Agrupar por módulo? | Sim — plano em 5 fases |
| 8 | Sem alterar cálculo? | Sim — apenas apresentação |
