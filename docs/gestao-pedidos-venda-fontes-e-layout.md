# Gestão de Pedidos de Venda — fontes oficiais e layout

**Data:** 2026-07-09  
**Tela:** Comercial › Pedidos de Venda › Gestão de Pedido de Venda  
**HEAD de referência:** pós-migração `SystemTotalizerCard` (`932efda`) e service centralizado (`0cceb62`).

Documento de validação final cruzada (cards × tabela × Financeiro × layout).  
Diagnóstico histórico detalhado: [`auditoria-gestao-pedidos-venda-fontes.md`](./auditoria-gestao-pedidos-venda-fontes.md).

---

## Resumo executivo

| Veredito | Detalhe |
|----------|---------|
| Fonte de pedido / valor vendido | **Oficial** — `SalesOrder.totalNetValue` |
| Margem | **Motor oficial** — `calculateSalesOrderMarginsForOrders` → `OFFICIAL_SM_RULES_SOURCE` |
| Cards × tabela | **Mesmo dataset** — `activeRows` em `loadSalesOrderManagementMetrics` |
| Layout | **Padrão** — `SystemTotalizerCard` + grid executivo |
| Proposal / AR | **Não usados** como fonte de valor na gestão |
| Comercial × Financeiro | **Paridade em valor vendido e pedidos**; divergências legítimas em “faturado” e filtros |

---

## 1. Fonte oficial dos valores

### Endpoint e loader

```
GET /api/sales-orders/management
  → loadSalesOrderManagementPage (salesOrderManagementMetrics.server.ts)
      → prisma.salesOrder.findMany (WHERE gestão + vendedor oficial)
      → buildOfficialSalesOrderManagementCore
      → calculateSalesOrderMarginsForOrders
      → activeRows (inclui filtro marginStatus quando aplicado)
      → buildOfficialManagementMetricsBundle(activeRows)
```

### Campos oficiais (`officialMetrics`)

| Indicador | Campo API | Fonte Prisma / derivado |
|-----------|-----------|-------------------------|
| Total de pedidos | `totalOrders` | Contagem de `activeRows` |
| Valor vendido | `soldAmount` | Σ `SalesOrder.totalNetValue` |
| Ticket médio | `averageTicket` | `soldAmount ÷ totalOrders` |
| Valor faturado (NF) | `invoicedNfeAmount` | Σ `SalesOrderLinkedNfeContext.nfeTotalValue` |
| Gap vendido × faturado | `soldInvoicedGap` | `soldAmount − invoicedNfeAmount` |
| Carteira aberta | `openPortfolioCount` / `openPortfolioAmount` | Pedidos sem NF (`hasInvoice === false`) |
| Pedidos faturados | `invoicedOrdersCount` | Pedidos com NF válida |

**Não usa:** `Proposal`, `proposalId` (como valor vendido), `AccountsReceivable`, `responsible` como filtro Prisma direto.

### Vendedor (filtro)

- Resolução: `resolveSalesOrderListSellerWhere` → `externalSellerId` + `CommissionPerson`.
- Exibição na linha: `nomusSellerDisplayName` / resolução canônica.
- `responsible` no modelo é legado de exibição (`nomusSellerName`); **não** é a regra de filtro Prisma.

### Cliente (filtro)

- `customerId` no WHERE Prisma (`buildSalesOrderManagementWhere`).
- Cards e tabela recebem o mesmo conjunto filtrado.

---

## 2. Fonte oficial da margem

```
calculateSalesOrderMarginsForOrders
  → buildOfficialSalesMarginRulesForOrders (OFFICIAL_SM_RULES_SOURCE)
  → receita item: Nomus raw + SalesOrderItem
  → custo: produção versionada
  → imposto: contexto fiscal oficial
```

Agregação na gestão:

- `buildSalesOrderManagementMarginEconomics(activeRows, itemResultsByOrderId)`
- `aggregateSalesOrderMarginSummaries` — margem % **ponderada por `netRevenue`** (receita com custo), nunca média simples.

| Card | Campo | Observação |
|------|-------|------------|
| Margem R$ | `consolidated.marginValue` | Σ margens dos pedidos no escopo |
| Margem % | `consolidated.marginPercent` | `(Σ marginValue) / (Σ netRevenue) × 100` |
| Receita líquida | `consolidated.netRevenue` | Receita **com custo** usada na margem — ≠ valor vendido total |
| Custo estimado | `consolidated.totalCost` | Custo oficial resolvido |
| Itens sem custo | `sourceAudit.itemsWithoutCost` | Contagem em nível de item (`SEM_CUSTO`) |
| Margem negativa (itens) | `sourceAudit.itemsWithNegativeMargin` | Contagem em nível de item |

`proposalId` / `proposalItemId` podem aparecer **apenas** no motor de margem para resolver tabela de preço vigente — **não** substituem `totalNetValue`.

---

## 3. Cards × tabela — paridade

`loadSalesOrderManagementMetrics` monta `activeRows` **antes** de `buildOfficialManagementMetricsBundle`. Portanto:

- `officialMetrics.totalOrders` = `fulfillmentKpis.totalOrders` = `summary.gridFilteredCount` = `total` da paginação = linhas após todos os filtros (incl. `marginStatus`).
- `officialMetrics.soldAmount` = Σ `row.totalNetValue` das linhas filtradas.
- A tabela paginada é `activeRows.slice(page)` — mesma fonte dos cards.

**Como auditar divergência:**

1. Abrir bloco **Fontes dos indicadores (auditoria)** no topo da página (`data-testid="sales-order-management-source-audit"`).
2. Conferir `filteredOrdersCount` vs total na paginação.
3. Exportar Excel interno (usa `loadSalesOrderManagementMetrics`) e somar coluna valor líquido.
4. Se `marginStatus` ativo, cards de Visão Geral **também** refletem o subconjunto (correção `0cceb62`).

---

## 4. Comercial × Financeiro

| Indicador | Gestão (Comercial) | Financeiro › Pedidos de Venda | Paridade? |
|-----------|-------------------|------------------------------|-----------|
| Período | `issueDate` ano/mês | `issueDate` ano/mês | **Sim** (mesmo campo) |
| Valor vendido | Σ `totalNetValue` | `totalOrdersAmount` / `monthSalesAmount` | **Sim** (mesmo campo, escopo de filtros pode diferir) |
| Quantidade pedidos | `totalOrders` | `orderCount` | **Sim** (definição equivalente) |
| Ticket médio | `averageTicket` | `averageTicketAmount` | **Sim** (fórmula idêntica) |
| Valor faturado | `invoicedNfeAmount` (Σ NF) | `invoicedOrdersAmount` (Σ header pedido com NF) | **Divergência legítima** |
| Carteira aberta | Pedidos sem NF | `openPortfolio*` sem NF processada | **Conceito alinhado**; BI logístico adicional na gestão |
| Margem | Consolidada no filtro | Portfolio margin (quando exposta) | Mesmo motor; escopos de filtro podem diferir |
| Meta comercial | Não exibida | `monthTargetAmount` | Só Financeiro |

### Divergências justificadas (não são bug)

1. **Valor faturado:** Gestão soma valores das **NF-e vinculadas** (`nfeTotalValue`). Financeiro soma o **valor líquido do pedido** para pedidos com NF. Gap vendido × faturado na gestão usa a definição fiscal.
2. **Filtros:** Gestão tem superset (status logístico BI, prazo, fulfillment, `marginStatus`, NF parcial, etc.). Financeiro tem meta, projeção e filtros executivos adicionais.
3. **Vendedor:** Gestão usa `resolveSalesOrderListSellerWhere` (ID canônico). Financeiro ainda aceita `sellerName` via `buildSalesOrderListWhere` (texto). Com o mesmo vendedor resolvido, valores devem coincidir; com busca textual ambígua, pode haver diferença de escopo.
4. **Receita líquida (card margem):** É receita da **margem com custo**, não o valor vendido do header.

### Quando investigar como bug

- Mesmos filtros (ano, mês, cliente, vendedor canônico) e `soldAmount` ≠ Financeiro `monthSalesAmount`.
- `filteredOrdersCount` ≠ total paginado.
- `itemsWithoutCost` no audit ≠ contagem manual de itens `SEM_CUSTO` no export.

---

## 5. Componentes de card (layout)

| Componente | Uso |
|------------|-----|
| `SystemTotalizerCard` | Todos os KPIs da gestão |
| `SYSTEM_TOTALIZER_GRID_CLASS` | Grid responsivo alinhado ao Fluxo de Caixa |
| `SYSTEM_TOTALIZER_METRIC_CARD_CLASS` | Altura/tipografia estável |
| `formatKpiCompactCurrency` | Valores grandes: `R$ 6,21 Mi`, `R$ 449,3 mil` |
| `FinanceBiCalcTooltip` | Explicações via ícone (i) em `helperText` |
| `SalesOrderMarginInfoTooltip` | Composição longa da margem (fora do corpo do card) |
| `resolveMarginCardShortSubtitle` | Subtítulo curto para cobertura parcial |

**Arquivos UI:**

- `SalesOrderManagementKpiDashboard.tsx` — Visão Geral + Alertas
- `SalesOrderManagementMarginOverview.tsx` — Margem do filtro
- `SalesOrderManagementKpiSecondaryPanel.tsx` — Logística / Margem / NF-e

---

## 6. Cenários de validação visual

| Cenário | O que verificar |
|---------|-----------------|
| Ano 2026, todos os meses | Grid não quebra; valores compactos; contagem bate com paginação |
| Julho/2026 | Filtro mês reduz cards e tabela igualmente |
| Vendedor específico | Cards e tabela com mesmo `filteredOrdersCount` |
| Cliente específico | Idem |
| Valores milionários | Display `Mi`/`mil`; valor completo no hover (`title`) |
| Margem parcial | Subtítulo curto + tooltip (i); aviso em `sourceAudit.partialCoverageWarning` |
| Itens sem custo | Alerta “Sem custo” = `sourceAudit.itemsWithoutCost` |
| Valor zero | Card exibe `—` ou `R$ 0,00` sem quebra de layout |

---

## 7. Limitações conhecidas

| Limitação | Impacto |
|-----------|---------|
| Receita líquida ≠ valor vendido | Label pode confundir; tooltip explica escopo da margem |
| Faturado fiscal ≠ faturado financeiro | Comparar indicadores corretos entre módulos |
| Filtro vendedor Financeiro (texto) vs Gestão (canônico) | Possível diferença de escopo com nomes ambíguos |
| Motor de margem depende de Nomus raw | Pedidos sem raw completo podem ter margem parcial |
| Paginação | Soma manual na tabela visível ≠ total do card (usar export ou audit) |

---

## 8. Como auditar divergência (checklist)

1. Anotar filtros ativos (chips na barra de filtros).
2. Ler `sourceAudit` na página: `orderValueSource`, `marginSource`, `filteredOrdersCount`, `itemsWithoutCost`.
3. Comparar `officialMetrics.totalOrders` com total da paginação.
4. Export interno: somar valor líquido e comparar com `soldAmount`.
5. Financeiro: mesmos ano/mês/cliente — comparar **valor vendido** (`monthSalesAmount`), não “faturado” cruzado com NF.
6. Margem: abrir tooltip (i) no bloco Margem — composição detalhada.
7. Testes automatizados: `salesOrderManagementCrossValidation.test.ts`, `salesOrderManagementMetrics.test.ts`, `salesOrderManagementSourcesAudit.test.ts`.

---

## 9. Testes e checks

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm test
npm run build
npm run check:browser-bundle
```

Suíte relevante: `salesOrderManagementCrossValidation.test.ts` (validação cruzada pós-padronização).
