# Auditoria visual — blocos de cards KPI / resumo

**Data:** 2026-07-07  
**Fase:** estética/visual apenas — sem alteração de cálculo, API ou regra de negócio.  
**Referência aprovada:** `FinanceCostCenterExpenseMapExecutiveSummary` (“Resumo geral dos centros filtrados”).

## Padrão de referência (não alterar)

| Elemento | Implementação |
|----------|----------------|
| Componente card | `MetricCard` (`src/components/ui/MetricCard.tsx`) |
| Grid | `MetricCardGrid` + `finance-cc-expense-map-metric-grid` |
| Wrapper | Seção com título, subtítulo de escopo, borda/sombra suave |
| Visual | Borda lateral colorida, label uppercase, ícone canto superior direito, valor grande, subtitle |
| Arquivo | `FinanceCostCenterExpenseMapExecutiveSummary.tsx` |
| Menu | Financeiro → Centros de Custo → **Mapa de Gastos** |

**Exclusão explícita:** cards individuais do Mapa de Gastos (`ExpenseMapCard` em `FinanceCostCenterExpenseMapSection.tsx`) — aprovados, não mexer.

## Dois sistemas visuais coexistem

| Sistema | Componentes | Uso atual |
|---------|-------------|-----------|
| **A — Executivo (referência)** | `MetricCard` + `MetricCardGrid` | CC Mapa resumo, AR analítico, pedidos resultado, estoque, simulação |
| **B — BI Financeiro (legado)** | `FinanceKpiCard` → `FinanceBiKpiCard` + `indus-kpi-grid` | Financeiro, Comissões, parte de CC |
| **C — Relatório Presidencial** | `ExecutiveKpiCard` | PDF/tela executiva (overrides próprios) |
| **D — Ad hoc** | div + Tailwind inline | Dashboard RH, alguns painéis comerciais |

**Recomendação estratégica (próximas fases):** migrar sistema B para A reutilizando `MetricCard`, com wrapper tipo `ExecutiveSummaryKpiSection` (título + grid), sem tocar motores/APIs.

---

## Matriz por tela

Legenda: **OK** = aceitável ou já alinhado · **AJUSTAR** = recomendado na próxima fase visual · **BAIXA** = prioridade menor

### Referência / já alinhado

| Arquivo | Menu / tela | Status | Observação |
|---------|-------------|--------|------------|
| `FinanceCostCenterExpenseMapExecutiveSummary.tsx` | CC → Mapa de Gastos (totalizador) | **REFERÊNCIA** | Padrão aprovado |
| `FinanceArAnalyticalTitlesTab.tsx` | Financeiro → AR → Analítico | **OK** | `MetricCardGrid` |
| `InventoryDashboardTab.tsx` | Estoque → Dashboard | **OK** | `MetricCardGrid` |
| `SalesOrderResultPage.tsx` | Pedidos → Resultado | **OK** | `MetricCardGrid` 6 colunas |
| `SalesOrderMarginMetricGrid.tsx` | Pedidos → Margem | **OK** | `MetricCard` |
| `FinanceCashFlowAnnualComparisonChart.tsx` | Fluxo → Comparativo anual | **OK** | resumo com `MetricCardGrid` |
| `ExecutiveCostCenterTopCardsGrid.tsx` | Relatório Presidencial → CC | **OK** | cards compactos (outro layout, aprovado para PDF) |

### Financeiro — ajuste recomendado (média/alta)

| Arquivo | Menu / tela | Status | Problema visual | Recomendação |
|---------|-------------|--------|-----------------|--------------|
| `FinanceCostCenterOverviewTab.tsx` | CC → Visão geral | **AJUSTAR** | Dois grids `FinanceKpiCard` sem wrapper executivo; inconsistente com aba Mapa | Replicar wrapper do Mapa; migrar KPIs para `MetricCard` |
| `FinanceCostCenterDetailPage.tsx` | CC → Detalhe | **AJUSTAR** | Grid `FinanceKpiCard` sem título de seção | Wrapper + `MetricCardGrid` |
| `FinanceAccountsPayablePage.tsx` | Financeiro → AP | **AJUSTAR** | `indus-kpi-grid` sem faixa lateral; labels não uppercase | Migrar cards para `MetricCard`; manter filtros |
| `FinanceAccountsReceivablePage.tsx` | Financeiro → AR | **AJUSTAR** | `FinanceBiKpiCard` direto em `indus-kpi-grid`; sem faixa lateral | Migrar para `MetricCard`; manter filtros |
| `FinanceAccountsReceivableOverdueTab.tsx` | AR → Inadimplência | **AJUSTAR** | Grid denso com `FinanceKpiCard` | Agrupar em seção com título |
| `FinanceBillingPage.tsx` | Faturamento | **BAIXA→AJUSTAR** | `FinanceBillingKpiGroup` já tem título — bom — mas cards ainda são BI | Trocar filhos para `MetricCard` mantendo groups |
| `FinanceSalesOrdersPage.tsx` | Financeiro → Pedidos | **AJUSTAR** | 9+ KPIs em grid BI | Seção “Resumo do período” + MetricCard |
| `FinanceHorizonSection.tsx` | AR/AP horizonte | **AJUSTAR** | KPIs inline em drilldown | Padronizar wrapper |
| `FinanceAgingBucketDrilldownSection.tsx` | AR aging | **AJUSTAR** | Mix drilldown + KPI | MetricCard no topo |
| `FinanceBillingHorizonDrilldownSection.tsx` | Faturamento horizonte | **AJUSTAR** | Idem | Idem |
| `FinanceCashFlowYtdSummary.tsx` | Fluxo YTD | **AJUSTAR** | Cards soltos | MetricCard + wrapper |
| `FinanceSupplierPaymentDrilldownSection.tsx` | CC fornecedor | **AJUSTAR** | Poucos KPIs sem padrão executivo | MetricCard |

### Comissões — ajuste recomendado (alta)

| Arquivo | Menu / tela | Status | Problema visual | Recomendação |
|---------|-------------|--------|-----------------|--------------|
| `CommissionsReceiptClosingPage.tsx` | Comissões → Fechamento recebimento | **AJUSTAR (alta)** | 16+ cards em `lg:grid-cols-5`; sem seção; labels longas quebram | 2–3 blocos com título (Materialização / Recebido / Comissão); max 4 cols; MetricCard |
| `CommissionsVisualAuditPage.tsx` | Comissões → Auditoria visual | **AJUSTAR (alta)** | 8 cards/modo, grid custom, sem wrapper | Seção por modo + MetricCardGrid |
| `CommissionsDashboardPage.tsx` | Comissões → Dashboard | **AJUSTAR** | Grid BI denso | Wrapper executivo |
| `CommissionsForecastPage.tsx` | Comissões → Previstas | **AJUSTAR** | 6 KPIs sem wrapper | “Resumo previsto” + MetricCard |
| `CommissionsConfirmedPage.tsx` | Confirmadas | **AJUSTAR** | Idem | Idem |
| `CommissionsReleasesPage.tsx` | Liberação | **AJUSTAR** | Idem | Idem |
| `CommissionsPaymentsPage.tsx` | Pagamentos | **AJUSTAR** | Idem | Idem |
| `CommissionsApuracaoPage.tsx` | Apuração | **AJUSTAR** | Totais em grid BI | MetricCard para totais |
| `CommissionsMonthlyClosingPage.tsx` | Fechamento mensal | **AJUSTAR** | 6+ KPIs compactos | Agrupar + MetricCard |
| `CommissionsReceivableForecastPage.tsx` | Previsão recebíveis | **AJUSTAR** | Idem | Idem |
| `CommissionsAuditPage.tsx` | Auditoria | **AJUSTAR** | Cards resumo | Wrapper |
| `CommissionsPersonsPage.tsx` | Pessoas | **BAIXA** | Poucos KPIs | MetricCard opcional |
| `CommissionsRulesPage.tsx` | Regras | **BAIXA** | Contadores simples | Baixa prioridade |
| `CommissionsArViewPage.tsx` | Visões AR | **AJUSTAR** | 4 KPIs soltos | Wrapper + MetricCard |

### Comercial / Pedidos / CRM

| Arquivo | Menu / tela | Status | Problema | Recomendação |
|---------|-------------|--------|----------|--------------|
| `SalesOrderManagementKpiDashboard.tsx` | Gestão pedidos | **AJUSTAR** | Mix grids e painéis | Unificar MetricCard |
| `SalesOrderManagementKpiSecondaryPanel.tsx` | Gestão pedidos | **AJUSTAR** | Muitos KPIs secundários | Agrupar seções |
| `SalesOrderListSummaryCards.tsx` | Lista pedidos | **AJUSTAR** | Cards resumo custom | MetricCard |
| `SoldProductsReportPage.tsx` | Comercial → Vendidos | **AJUSTAR** | KPIs BI | MetricCard |
| `SoldProductCustomersPage.tsx` | Comercial → Clientes produto | **AJUSTAR** | Idem | Idem |
| `SalesOrdersIndicatorsDashboard.tsx` | Indicadores pedidos | **AJUSTAR** | Grid contextual | Wrapper |
| `CustomerCommercial360.tsx` | CRM 360 | **BAIXA** | Poucos cards | Próxima fase |

### Relatório Presidencial / Executivo

| Arquivo | Menu / tela | Status | Problema | Recomendação |
|---------|-------------|--------|----------|--------------|
| `ExecutiveReportDocument.tsx` + `ExecutiveKpiCard.tsx` | Relatório Presidencial | **BAIXA** | Variante PDF (`FinanceBiKpiCard`); CSS próprio | Manter overrides print; alinhar tela se necessário |
| `ExecutiveDashboardPanel.tsx` | Dashboard executivo | **BAIXA** | Painel separado | Revisar depois |

### Engenharia / Simulação / Auditoria

| Arquivo | Menu / tela | Status | Problema | Recomendação |
|---------|-------------|--------|----------|--------------|
| `SimulationModule.tsx` | Simulação | **BAIXA** | MetricCard inline sem wrapper | Adicionar título de bloco |
| `CostToCashTraceSections.tsx` | Auditoria cost-to-cash | **OK→BAIXA** | Já usa MetricCard; falta wrapper | Opcional |
| `DashboardModule.tsx` | Dashboard RH/custos | **BAIXA** | StatCard custom (`rounded-3xl`); domínio diferente | Não priorizar vs financeiro |
| `ReportsModule.tsx` | Relatórios | **BAIXA** | Poucos indicadores | Revisar depois |

---

## Problemas visuais recorrentes (sistema B)

1. **Sem wrapper de seção** — KPIs soltos no topo da página (Comissões, CC Visão geral).
2. **Grid muito denso** — `lg:grid-cols-5` com 16 cards (Fechamento recebimento).
3. **Label não uppercase** — `FinanceKpiCard` força `normal-case` vs referência.
4. **Sem faixa lateral colorida** — `FinanceBiKpiCard` usa borda uniforme cinza.
5. **Altura fixa** — `min-h-[9.5rem]` pode deixar cards vazios ou apertados.
6. **Inconsistência intra-módulo** — CC Mapa (MetricCard) vs CC Visão geral (FinanceKpiCard).

---

## Próximos passos sugeridos (ordem)

1. **Comissões → Fechamento por recebimento** — maior densidade de cards.
2. **Comissões → Auditoria visual** — 3 modos × 8 KPIs.
3. **Centros de Custo → Visão geral + Detalhe** — alinhar com Mapa (mesmo menu).
4. **Financeiro AR/AP** — blocos principais de resumo.
5. **Demais telas Comissões** — wrapper + MetricCard.
6. **Faturamento / Pedidos financeiros** — migrar mantendo `FinanceBillingKpiGroup`.

## Componentes reutilizáveis existentes

- `MetricCard` / `MetricCardGrid` — **alvo visual**
- `FinanceKpiCard` / `FinanceBiKpiCard` — legado amplo
- `FinanceBillingKpiGroup` — wrapper com título (reutilizável como modelo)
- `finance-cc-expense-map-executive-summary.css` — densidade compacta aprovada

## O que não fazer nesta fase

- Não alterar cards do Mapa de Gastos (`ExpenseMapCard`).
- Não alterar cálculos, filtros, APIs ou motores oficiais.
- Não criar migration.
