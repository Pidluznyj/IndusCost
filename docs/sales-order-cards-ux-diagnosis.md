# Diagnóstico UX — Cards de Pedidos de Venda

Documento de Fase 1 (diagnóstico). Nenhuma regra de cálculo foi alterada nesta análise.

## 1. Cards em Pedidos de Venda (`/sales-orders`)

| # | Label atual | Fonte de dados | Categoria | Peso sugerido |
|---|-------------|----------------|-----------|---------------|
| 1 | Pedidos filtrados | `GET /api/sales-orders` → `summary.totalOrders` via `buildSalesOrderListSummary()` | Comercial | **Principal** — sempre visível |
| 2 | Valor líquido | `summary.totalNetAmount` | Financeiro/comercial | **Principal** — renomear para “Valor vendido” |
| 3 | Itens | `summary.totalItems` | Comercial | Secundário — compacto |
| 4 | Ticket médio | `computeTicketAverage()` sobre o summary | Comercial | Secundário — compacto |

**Componente:** `FinanceBiKpiCard` + `indus-kpi-grid` em `SalesOrdersModule.tsx`.

**Margem:** não há cards de margem na listagem; margem %/R$ e status aparecem apenas na tabela (`marginSummary` via `attachMarginsToSalesOrders`).

**Clique em card:** não implementado (display-only).

---

## 2. Cards em Gestão de Pedidos (`/sales-orders/management`)

### 2.1 Seção “Status Logístico” (7 cards — clicáveis)

| Label | Fonte | Categoria | Filtro ao clicar |
|-------|-------|-----------|------------------|
| Total no filtro | `dashboardCards` / `buildBiLogisticDashboardCards()` | Logística | Limpa `logisticStatus` |
| Entregue no Prazo | `cards.deliveredOnTime` | Logística | `logisticStatus=deliveredOnTime` |
| Entregue com Atraso | `cards.deliveredLate` | Logística/alerta | `logisticStatus=deliveredLate` |
| Atrasado (Pendente) | `cards.overduePending` | Alerta/logística | `logisticStatus=overduePending` |
| No Prazo (Pendente) | `cards.onTimePending` | Logística | `logisticStatus=onTimePending` |
| Finalizado/Cancelado | `cards.finishedOrCancelled` | Logística | `logisticStatus=finishedOrCancelled` |
| Revisar dados | `cards.reviewData` | Alerta | `logisticStatus=reviewData` |

**API:** `GET /api/sales-orders/management` → `loadSalesOrderManagementPage()`.

### 2.2 Seção “Análise econômica” (7 cards)

| Label | Fonte | Categoria |
|-------|-------|-----------|
| Valor vendido | `marginEconomics.consolidated.netRevenue` | Financeiro |
| Custo estimado | `marginEconomics.consolidated.totalCost` | Margem/custo |
| Margem R$ | `marginEconomics.consolidated.marginValue` | Margem |
| Margem % | `marginEconomics.consolidated.marginPercent` | Margem |
| Margem negativa | `marginEconomics.ordersWithNegativeMargin` | Alerta |
| Sem custo | `marginEconomics.ordersWithoutCost` | Alerta |
| Sem produto | `marginEconomics.ordersWithoutProduct` | Alerta |

**Motor:** `buildSalesOrderManagementMarginEconomics()` — sem recálculo no React.

### 2.3 Seção “Indicadores de fulfillment (NF-e)” (17 cards)

| Label | Campo `fulfillmentKpis` | Categoria |
|-------|-------------------------|-----------|
| Total pedidos | `totalOrders` | Logística |
| Valor vendido | `totalSoldValue` | Financeiro |
| Valor faturado (NF) | `totalInvoicedValue` | Financeiro |
| Gap vendido × faturado | `soldInvoicedGap` | Financeiro |
| Com NF | `ordersWithNfe` | Fulfillment |
| Sem NF | `ordersWithoutNfe` | Alerta |
| Entregues/faturados no prazo | `deliveredOnTime` | Logística |
| Entregues/faturados com atraso | `deliveredLate` | Alerta |
| Pendentes no prazo | `pendingOnTime` | Logística |
| Pendentes atrasados | `pendingLate` | Alerta |
| Parciais | `partialCount` | Alerta |
| Com corte | `withCutCount` | Alerta |
| Revisar dados | `needsReviewCount` | Alerta |
| SLA médio (dias) | `averageSlaDays` | Logística (secundário) |
| % no prazo | `onTimePercent` | Logística |
| % atendimento médio | `averageFulfilledPercent` | Logística |
| % faturamento médio | `averageInvoicedPercent` | Fulfillment |

**Motor:** `buildFulfillmentKpis()` em `salesOrderManagementFulfillment.ts`.

### 2.4 Alertas operacionais (checkboxes — não são cards)

Com risco, Atrasados, Sem OP, NF após prazo, Parcial/com corte, OP atrasada — query params existentes, preservados.

---

## 3. Duplicidades identificadas

| Indicador | Onde repete | Problema |
|-----------|-------------|----------|
| Total pedidos | Listagem, Logístico “Total no filtro”, Fulfillment | Mesmo escopo no filtro, peso visual triplicado na gestão |
| Valor vendido | Análise econômica + Fulfillment (+ listagem “Valor líquido”) | Redundância na mesma tela |
| Revisar dados | Card logístico + Fulfillment | Dois cards com mesma intenção |
| Entregue/atraso/pendente | Cards logísticos BI + Fulfillment | Mesma leitura em dois blocos |
| Margem negativa / sem custo / sem produto | Análise econômica | Misturados com KPIs de rentabilidade |

---

## 4. Classificação: principal vs secundário vs alerta

### Sempre visíveis — principais (Bloco Visão Geral)
- Total de pedidos
- Valor vendido
- Valor faturado
- Gap vendido × faturado
- % no prazo

### Sempre visíveis — alertas (Bloco Alertas)
- Pendentes atrasados
- Sem NF
- Com corte
- Pedidos para revisar
- Margem negativa
- Pedidos com item sem custo
- Itens sem produto vinculado
- Atrasados (checkbox `overdueOnly` espelhado visualmente)

### Secundários — Logística (Bloco Logística)
- 7 cards BI clicáveis (status logístico)
- SLA médio, Parciais, % atendimento médio (compactos)

### Secundários — Análise econômica (Bloco Margem)
- Custo estimado, Margem R$, Margem % (sem repetir alertas)

### Colapsável — Fulfillment/NF-e
- Com NF, Sem NF, % faturamento médio (demais valores já na visão geral)

---

## 5. Proposta de nova hierarquia visual

```
Header + disclaimer interno
Filtros (rápidos + avançados recolhidos)
├── Visão Geral (5 cards grandes)
├── Alertas (8 mini-cards acionáveis)
├── Logística e Atendimento (7 cards clicáveis + secundários)
├── Análise Econômica (3–4 cards, dados internos)
├── Faturamento / NF-e (colapsável)
├── Gráficos operacionais
├── Alertas operacionais (checkboxes — mantidos)
└── Tabela + paginação
```

**Pedidos de Venda (lista):**
```
Filtros
├── Visão Geral (2 principais + 2 compactos)
└── Tabela (margem na linha)
```

---

## 6. Alertas acionáveis — mapeamento de filtros

| Alerta | Filtro existente | Status |
|--------|------------------|--------|
| Sem NF | `hasInvoice=false` (`invoiceFilter`) | Implementado |
| Pendentes atrasados | `logisticStatus=overduePending` | Implementado |
| Com corte | `hasCut=true` (`cutFilter`) | Implementado |
| Pedidos para revisar | `needsDataReview=true` | Implementado |
| Atrasados | `overdueOnly=true` | Implementado |
| Parciais | `partialOrCut=true` | Implementado |
| Margem negativa | — | **Pendente** — sem filtro dedicado na API |
| Sem custo | — | **Pendente** — sem filtro dedicado |
| Sem produto | — | **Pendente** — sem filtro dedicado |

Cards pendentes ficam visuais (variant warning/danger) sem quebrar filtros.

---

## 7. Permissões

- Gestão e listagem: `sales_orders.view`
- Margem/custo: expostos a quem tem `sales_orders.view` (sem permissão granular hoje)
- Disclaimer de relatório interno permanece na gestão
- Ocultar seção econômica exigiria nova permissão — **não alterado** (regra de negócio/permissão intacta)

---

## 8. Riscos de alteração

| Risco | Mitigação |
|-------|-----------|
| Quebrar filtro por card logístico | Reutilizar `toggleManagementStatusCard` e handlers existentes |
| Regressão visual em print | Cards agrupados; mesmos `data-testid` críticos preservados |
| Confundir totais entre seções | Visão geral usa `fulfillmentKpis`; logística usa agregados BI — mesma base de pedidos filtrados |
| Alterar cálculo acidentalmente | React só mapeia payload; zero lógica nova em helpers de margem/fulfillment |
| Testes de ordem antiga | Atualizar testes estruturais para nova ordem de blocos |

---

## 9. Decisões de implementação

1. Extrair dashboard KPI para `SalesOrderManagementKpiDashboard.tsx`.
2. Usar `MetricCard` + `MetricCardGrid` com `compact` para alertas/secundários.
3. Renomear labels conforme tabela de melhorias (sem alterar campos API).
4. Remover grid monolítico de 17 cards de fulfillment da área principal.
5. Listagem: agrupar 4 cards existentes em seção “Visão Geral” com hierarquia de tamanho.
