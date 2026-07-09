# Auditoria — Comercial › Pedidos de Venda › Gestão de Pedido de Venda

**Data:** 2026-07-09  
**Escopo:** diagnóstico de fontes de dados dos cards/KPIs (sem correção de regra de negócio).  
**HEAD de referência:** pós-migração de Indicadores (`SystemTotalizerCard`).

---

## Resumo executivo

A tela **Gestão de Pedido de Venda** consome **SalesOrder** via `GET /api/sales-orders/management`. **Não usa Proposal** como fonte de valor vendido, vendedor ou margem.

| Área | Veredito |
|------|----------|
| Pedido / valor vendido (header) | **Oficial** — `SalesOrder.totalNetValue` + Nomus `nomusRawResponse` |
| Vendedor | **Oficial com ressalva** — `externalSellerId` + `CommissionPerson`; filtro texto usa `nomusSellerName` |
| Margem | **Motor oficial** — `calculateOfficialSalesOrderMarginsForOrders` (backend) |
| Valor faturado (card Visão Geral) | **Oficial NF, definição diferente do Financeiro** — soma `nfeTotalValue` |
| Carteira / logística | **Oficial BI logístico** — status logístico derivado de pedido + NF |
| Paridade com listagem | **Parcial** — mesmo motor de regras, filtros de gestão são superset |
| Paridade com Financeiro | **Divergente em “valor faturado” e “carteira”** — métricas com nomes parecidos, fórmulas distintas |

**Principais riscos (não bloqueantes imediatos, mas explicam suspeita do usuário):**

1. **“Valor faturado” na Gestão ≠ “Valor faturado” no Financeiro** (NF agregada vs. valor do pedido com NF).
2. **Filtro `marginStatus`** recalcula tabela e bloco de margem, mas **não** recalcula Visão Geral / logística / alertas operacionais.
3. **Excel interno (gestão)** usa `buildManagementRowsFromOrders` direto, **sem** `sellerIdentityCtx` (paridade de vendedor/export).
4. **Cards de margem** ainda usam `MetricCard` + `buildSalesOrderMarginCoverageHint` longo no helper (UX; não altera cálculo).
5. Itens passados ao motor de margem na rota de gestão usam **select reduzido**; receita/custo vêm sobretudo do **Nomus raw** (oficial, mas pode divergir da listagem se DB e raw divergirem).

**Correção sem migration:** sim — todas as divergências são agregação/apresentação/filtro no backend ou frontend.

---

## Checklist How it works (10 perguntas)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Usa SalesOrder ou Proposal? | **SalesOrder** (+ itens, NF link, Nomus raw). Proposal só aparece no **GET /api/sales-orders** (listagem detalhe), não na rota de gestão. |
| 2 | Cards = mesma fonte da listagem? | **Mesmo motor** (`buildOfficialSalesOrderRulesResult` / `salesOrderRulesEngine`). Listagem usa escopo `list`; gestão usa escopo `management` + filtros logísticos extras. |
| 3 | Cards = mesma fonte dos exports? | **Margem: sim** (`calculateSalesOrderMarginsForOrders`). **Linhas logísticas do Excel interno:** parcial — export não passa `sellerIdentityCtx`. |
| 4 | Margem = motor oficial ou local? | **Backend oficial** — `salesMarginRulesAdapter` → `buildOfficialSalesMarginRulesForOrders`. Frontend só agrega (`aggregateSalesOrderMarginSummaries`). |
| 5 | Valor vendido = total do pedido? | **Sim** — `SalesOrder.totalNetValue` (soma nas KPIs: `fulfillmentKpis.totalSoldValue`). |
| 6 | Valor faturado = NF válida? | **Sim na gestão** — soma `invoicedValue` = `linkedNfeContext.nfeTotalValue` (NF vinculada / fallback raw). **Não** é o mesmo critério do Financeiro (ver divergências). |
| 7 | Helpers oficiais no Financeiro? | **Sim** — `buildOfficialSalesOrderRulesResult`, `mapOfficialFinancePortfolioFromManagementRows`, `SALES_ORDER_RULES_PRISMA_SELECT`. Financeiro reutiliza o mesmo motor. |
| 8 | Duplicação de query Comercial × Financeiro? | **Sim** — ambos fazem `prisma.salesOrder.findMany` + motor de regras; rotas diferentes (`/api/sales-orders/management` vs `/api/finance/sales-orders/dashboard`). |
| 9 | Filtros alteram cards e tabela? | **Quase todos sim**; exceção: **`marginStatus`** filtra tabela + `marginEconomics`, mas **não** `fulfillmentKpis` / cards logísticos / Visão Geral. |
| 10 | Corrige sem migration? | **Sim.** |

---

## Tarefa 1 — Mapa técnico

### Frontend

| Papel | Arquivo |
|-------|---------|
| Página principal | `src/components/sales/SalesOrderManagementPage.tsx` |
| Dashboard KPI (Visão Geral, Alertas, margem) | `src/components/sales/SalesOrderManagementKpiDashboard.tsx` |
| Bloco margem (cards %) | `src/components/sales/SalesOrderManagementMarginOverview.tsx` |
| Painel secundário (Logística / Margem / NF-e) | `src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx` |
| Filtros | `src/components/sales/SalesOrderManagementFiltersBar.tsx` |
| Drawer inteligência (pedido) | `src/components/sales/SalesOrderIntelligenceDrawer.tsx` |
| Componente de card | `src/components/ui/MetricCard.tsx` (**não** `SystemTotalizerCard`) |
| Formatadores margem | `src/lib/salesOrderMarginDisplay.ts`, `src/lib/salesOrderManagementMetricCards.ts` |
| Formatadores moeda compacta | `src/lib/formatFinancialMetric.ts` / `kpiDisplayFormat.ts` (via `MetricCard` `amountFormat`) |

**Hooks / estado:** `SalesOrderManagementPage` — `useState` + `useEffect` + `fetchJsonOk(getSalesOrderManagementApiPath(queryString))`. Sem React Query dedicado.

### Backend

| Papel | Arquivo |
|-------|---------|
| Rota HTTP | `GET /api/sales-orders/management` em `src/lib/salesOrderIntelligenceRoutes.ts` → `loadSalesOrderManagementPage` |
| Filtros / WHERE Prisma | `src/lib/salesOrderManagement.ts` — `parseSalesOrderManagementFilters`, `buildSalesOrderManagementWhere` |
| Motor oficial pedidos | `src/lib/salesOrderRulesAdapter.ts` → `buildOfficialSalesOrderManagementCore` → `src/lib/salesOrderRulesEngine.ts` |
| Linhas + lifecycle + NF | `src/lib/salesOrderIntelligence.ts` — `mapLifecycleToManagementRow` |
| NF vinculada | `src/lib/salesOrderLinkedNfe.ts` — `loadSalesOrderLinkedNfeContextMap` |
| KPIs faturamento | `src/lib/salesOrderManagementFulfillment.ts` — `buildFulfillmentKpis` |
| Margem consolidada | `src/lib/salesOrderManagementMargin.ts` — `buildSalesOrderManagementMarginEconomics` |
| Motor margem | `src/lib/salesMarginRulesAdapter.ts` — `calculateOfficialSalesOrderMarginsForOrders` |
| Status logístico BI | `src/lib/salesOrderLogisticStatus.ts` |
| Vendedor oficial | `src/lib/commissions/commissionSellerIdentity.server.ts` + `enrichManagementRowWithNomusSellerResolution` |
| Excel interno margem | `GET /api/sales-orders/management/export-internal.xlsx` → `src/lib/salesOrderInternalMarginExport.server.ts` |

### Prisma (gestão)

- Tabela principal: **`SalesOrder`** (`issueDate`, `totalNetValue`, `nomusSellerName`, `externalSellerId`, `nomusRawResponse`, `companyIssuer`, …).
- Itens: **`SalesOrderItem`** (select reduzido em `SALES_ORDER_RULES_PRISMA_SELECT`).
- NF: **`SalesOrderNfeLink`** + tabela Nomus NF (via `loadSalesOrderLinkedNfeContextMap`).
- Cliente: **`Customer`** (+ opcional `CrmCustomerCommercialOwner` — só exibição CRM, não valor).
- **Não consulta `Proposal`** na rota de gestão.

### Relação com Financeiro › Pedidos de Venda

| Aspecto | Comercial Gestão | Financeiro |
|---------|------------------|------------|
| Endpoint | `/api/sales-orders/management` | `/api/finance/sales-orders/dashboard` |
| Motor pedidos | `buildOfficialSalesOrderManagementCore` | `buildOfficialSalesOrderRulesResult` |
| Select Prisma | `SALES_ORDER_RULES_PRISMA_SELECT` | Idem |
| UI cards | `MetricCard` | `SystemTotalizerCard` |
| Valor faturado | Σ `nfeTotalValue` | Σ `totalNetValue` onde `hasInvoice` |
| Carteira aberta | BI: pedidos não finalizados/cancelados | Pedidos **sem** NF processada |

---

## Tarefa 2 — Cards e fontes (tabela técnica)

### Visão Geral (`SalesOrderManagementKpiDashboard`)

| Card (UI) | Campo exibido | Endpoint | Service / função | Tabela / fonte | Cálculo | Oficial? | Risco |
|-----------|---------------|----------|------------------|----------------|---------|----------|-------|
| Total de pedidos | `fulfillmentKpis.totalOrders` | management | `buildFulfillmentKpis` ← `officialCore.rows` | `SalesOrder` (filtrado) | Contagem de linhas pós-filtros gestão (exc. `marginStatus`) | Sim | Baixo |
| Valor vendido | `fulfillmentKpis.totalSoldValue` | management | idem | `SalesOrder.totalNetValue` | Σ header líquido | Sim | Baixo |
| Valor faturado | `fulfillmentKpis.totalInvoicedValue` | management | idem | NF via `SalesOrderLinkedNfeContext` | Σ `row.invoicedValue` (= `nfeTotalValue`) | Sim (NF) | **Médio** — ≠ Financeiro |
| Gap vendido × faturado | `soldInvoicedGap` | management | idem | Pedido vs NF | `totalSoldValue − totalInvoicedValue` | Sim | **Médio** — sensível à definição de faturado |
| % no prazo | `onTimePercent` | management | `buildFulfillmentKpis` | Lifecycle + NF + prazo | % entregues no prazo entre elegíveis | Sim | Baixo |

### Margem do filtro (`SalesOrderManagementMarginOverview`)

| Card | Campo | Endpoint | Service | Fonte | Cálculo | Oficial? | Risco |
|------|-------|----------|---------|-------|---------|----------|-------|
| Margem % | `marginEconomics.consolidated.marginPercent` | management | `buildSalesOrderManagementMarginEconomics` → `aggregateSalesOrderMarginSummaries` | Motor margem por item | Ponderada por `netRevenue` (receita com custo) | Sim | Baixo |
| Margem R$ | `consolidated.marginValue` | management | idem | Motor margem | Σ margens dos pedidos no escopo | Sim | Baixo |
| Receita líquida | `consolidated.netRevenue` | management | idem | Itens Nomus + imposto | Receita líquida **da margem** (não valor vendido total) | Sim | **Médio** — label pode confundir |
| Custo estimado | `consolidated.totalCost` | management | idem | Custo produção versionado | Σ custo oficial resolvido | Sim | Baixo |
| Pedidos c/ margem | `ordersWithMarginData` | management | idem | Contagem summaries | Pedidos com payload de margem | Sim | Baixo |

**Nota:** bloco de margem respeita filtro `marginStatus`; Visão Geral **não**.

### Alertas (clicáveis)

| Card | Campo | Fonte | Oficial? | Risco |
|------|-------|-------|----------|-------|
| Pendentes atrasados | `fulfillmentKpis.pendingLate` | Status logístico `overduePending` | Sim | Baixo |
| Sem NF | `ordersWithoutNfe` | `hasInvoice === false` | Sim | Baixo |
| Com corte | `withCutCount` | `completionStatus` / `hasCut` | Sim | Baixo |
| Pedidos para revisar | `needsReviewCount` | `needsDataReview` (NF/dados) | Sim | Baixo |
| Margem negativa | `marginEconomics.ordersWithNegativeMargin` | `marginSummary.hasNegativeMargin` | Sim | Respeita `marginStatus` só na tabela |
| Sem custo / Sem produto | `ordersWithoutCost` / `ordersWithoutProduct` | flags do summary | Sim | idem |
| Atrasados | `logisticCards.overduePending + deliveredLate` | Cards logísticos | Sim | Baixo |
| Parciais | `partialCount` | `completionStatus === partial` | Sim | Baixo |

### Logística (aba secundária)

| Card | Campo | Fonte | Cálculo | Oficial? | Risco |
|------|-------|-------|---------|----------|-------|
| Total no filtro | `dashboardCards[total]` | `buildBiLogisticDashboardCards` | Contagem + Σ valor | Sim (BI) | Baixo |
| Entregue no prazo / atrasado / pendente… | cards por `logisticStatusCardId` | `salesOrderLogisticStatus.ts` | Fórmula Power BI | Sim | Baixo |
| Carteira válida (rodapé) | `validPortfolioCount/Value` | `total − finishedOrCancelled` | Valor BI carteira válida | Sim | **Médio** — ≠ carteira aberta Financeiro |
| SLA médio / % atendimento | `fulfillmentKpis.*` | NF + lifecycle | Médias | Sim | Baixo |

### NF-e (aba secundária)

| Card | Campo | Fonte | Oficial? |
|------|-------|-------|----------|
| Com NF / Sem NF | `ordersWithNfe` / `ordersWithoutNfe` | `hasInvoice` | Sim |
| % faturado | `averageInvoicedPercent` | média `invoiceCoveragePercent` | Sim (NF/pedido) |
| Entregues no prazo | `deliveredOnTime` | status logístico | Sim |

### Cards **não presentes** na Gestão (existem no Financeiro)

- Pedidos emitidos (rótulo equivalente: “Total de pedidos”)
- Ticket médio
- Meta mês / média diária
- Valor em carteira / carteira aberta (conceito financeiro explícito)

---

## Tarefa 3 — Regra oficial de margem

### Fluxo na gestão

```
loadSalesOrderManagementPage
  → prisma.salesOrder.findMany (WHERE gestão)
  → buildOfficialSalesOrderManagementCore (linhas + KPIs logísticos)
  → calculateSalesOrderMarginsForOrders
       → buildOfficialSalesMarginRulesForOrders
            → buildSalesOrderMarginContext (custos versionados)
            → buildOfficialSalesMarginRulesResult (imposto / receita item)
  → buildSalesOrderManagementMarginEconomics (agrega summaries)
```

### O que o motor usa (correto)

- Receita item: Nomus raw (`matchRawItemToDbItem`) + campos do item quando presentes.
- Custo: tabela de custo de produção versionada (`buildSalesOrderMarginInputsFromVersionedProductionCosts`).
- Imposto: `resolveOfficialSalesMarginTaxContext` / regra fiscal configurada.
- Referência comercial (tabela de preço): `proposalId` / `proposalItemId` **apenas** para resolver tabela vigente — **não** substitui valor vendido do pedido.
- Consolidação: `aggregateSalesOrderMarginSummaries` — % ponderada por receita, nunca média simples.

### O que **não** foi encontrado (erros graves)

- ❌ Proposal como fonte de valor vendido  
- ❌ Margem calculada só no frontend  
- ❌ AR como proxy de valor vendido  
- ❌ Custo local improvisado no card  

### Ressalvas

| Ressalva | Detalhe |
|----------|---------|
| Select de itens reduzido na gestão | Rota passa itens sem `productId`/`totalNetValue` DB; motor compensa via Nomus raw. Risco se raw incompleto. |
| `marginStatus` | Cards de Visão Geral não acompanham o filtro. |
| Label “Receita líquida” | Exibe `netRevenue` da margem (receita com custo), não `totalSalesRevenueInScope`. |

---

## Tarefa 4 — Filtros

| Filtro | WHERE Prisma | Pós-processamento | Cards afetados | Tabela |
|--------|--------------|-------------------|----------------|--------|
| Ano / mês | `SalesOrder.issueDate` | — | Todos | Sim |
| Cliente | `customerId` | — | Todos | Sim |
| Vendedor (texto) | `nomusSellerName` contains ou `externalSellerId` | Resolução canônica na linha | Todos | Sim |
| Empresa | `companyIssuer` | — | Todos | Sim |
| Status pedido | `status` (se usado) | — | Todos | Sim |
| NF (`hasInvoice`) | — | lifecycle | Sim | Sim |
| Status logístico BI | — | `logisticStatusCardId` | Logística + alertas | Sim |
| Prazo / fulfillment / cobertura NF | — | `matchesFulfillmentExtendedFilters` | Sim | Sim |
| `marginStatus` | — | **só** `marginFilteredRows` | **Só margem + tabela** | Sim |
| Busca `q` | OR inteligente | — | Todos | Sim |
| Paginação | — | slice após filtros | Não | Sim |

---

## Divergências e priorização

### P0 — Esclarecer / alinhar definições (produto)

1. **Valor faturado:** Gestão = Σ NF; Financeiro = Σ valor pedido com NF. Documentar na UI ou unificar métrica.
2. **Carteira:** Gestão “carteira válida BI” ≠ Financeiro “carteira aberta sem NF”.

### P1 — Consistência técnica

3. **`marginStatus`:** Recalcular `fulfillmentKpis` / Visão Geral com o mesmo conjunto de pedidos da tabela **ou** deixar explícito que alertas operacionais ignoram filtro de margem.
4. **Excel interno gestão:** Passar `sellerIdentityCtx` e preferir `buildOfficialSalesOrderManagementCore` para paridade com API.
5. **Select de itens na margem (gestão):** Alinhar com `SALES_ORDER_ITEM_MARGIN_SELECT` ou deixar `buildSalesOrderMarginContext` sempre recarregar itens completos.

### P2 — UX (sem mudar cálculo)

6. Migrar cards para `SystemTotalizerCard` (como Indicadores / Financeiro).
7. Mover `buildSalesOrderMarginCoverageHint` para tooltip em `SalesOrderManagementMarginOverview`.

### Não alterar (confirmado)

- Motor `salesOrderRulesEngine` / `salesMarginRulesEngine`.
- Regra de NF em `salesOrderLinkedNfe.ts`.
- Export Excel interno (estrutura/colunas) — só paridade de escopo se P1 for feito.
- AR/AP/Faturamento/comissões.

---

## Arquivos a corrigir (quando autorizado)

| Prioridade | Arquivo | Motivo |
|------------|---------|--------|
| P1 | `src/lib/salesOrderIntelligenceRoutes.ts` | Paridade margem/itens; opcional recorte KPIs por `marginStatus` |
| P1 | `src/lib/salesOrderInternalMarginExport.server.ts` | `sellerIdentityCtx` + motor oficial |
| P0/P1 | `src/components/sales/SalesOrderManagementKpiDashboard.tsx` | Labels/tooltips “valor faturado” vs financeiro |
| P2 | `src/components/sales/SalesOrderManagementMarginOverview.tsx` | SystemTotalizerCard + tooltip |
| P2 | `src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx` | SystemTotalizerCard |
| P1 | `docs/design-system-totalizer-cards.md` | Nota de paridade Gestão × Financeiro |

---

## Testes de auditoria

Estáticos em `src/lib/salesOrderManagementSourcesAudit.test.ts` (presença de rotas, ausência de Proposal na gestão, motor oficial).

---

## Referências cruzadas

- Listagem: `GET /api/sales-orders` + `buildOfficialSalesOrderListPayload` (`server.ts`)
- Financeiro: `src/lib/financeSalesOrdersDashboard.ts`
- Indicadores margem: `GET /api/sales-orders/margin-indicators`
- Auditoria consumo margem: `scripts/audit-sales-margin-rules-consumption.ts`
