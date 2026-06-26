# Motor oficial de regras — Pedidos de Venda

Versão: `SALES_ORDER_RULES_ENGINE_VERSION` (`1.0.0`)

## Objetivo

Concentrar as regras oficiais de Pedidos de Venda (SalesOrder) em um módulo server-side, pronto para consumo futuro — **sem alterar consumidores existentes nesta fase**.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/lib/salesOrderRulesEngine.ts` | Motor principal |
| `src/lib/salesOrderRulesEngine.types.ts` | Contratos/tipos |
| `src/lib/salesOrderRulesEngine.test.ts` | Testes unitários + compatibilidade |
| `docs/sales-order-rules-engine.md` | Esta documentação |

## Fontes consolidadas (delegação — não duplicar)

| Domínio | Helper delegado |
|---------|-----------------|
| Lista (Pedidos de Venda) | `summarizeSalesOrderListRows`, `buildSalesOrderListSummary` |
| Gestão | `buildManagementRowsFromOrders`, `buildFulfillmentKpis` |
| Status logístico BI | `buildSalesOrderBiLogisticStatus` |
| NF vinculada | `buildSalesOrderLinkedNfeContext` / motor linked NFe |
| Período | `resolveSalesOrderIssueDateRange` (sempre `issueDate`) |
| Executivo (meta/projeção) | `computeGrowthTarget`, `computeMonthProjection`, `computeYtdDailyAverageByWorkday` |
| Data civil | `financeCivilDate` |
| Margem | **Orquestra apenas** — repassa `marginSummary`; não recalcula |

## Regras oficiais documentadas

### Valor vendido / Valor líquido

- **Campo:** `SalesOrder.totalNetValue` (header)
- **Não** soma linhas de `SalesOrderItem` para valor vendido agregado
- Cancelados incluídos se filtro de status permitir (lista); excluídos em métricas executivas YTD/mês

### Valor faturado vinculado

- NF vinculada via `SalesOrderNfeLink` / motor `salesOrderLinkedNfe`
- Valor = `invoicedValue` / `nfeTotalValue` por pedido (sem duplicar pedido; múltiplas NF somadas no motor linked)

### Gap vendido × faturado

`totalSoldValue − totalInvoicedValue` (`buildFulfillmentKpis`)

### Total de pedidos / Ticket médio

- Pedidos **únicos** (`SalesOrder.id`)
- Ticket = `valor vendido ÷ count` (`computeTicketAverage`)

### Itens

- Soma de `SalesOrder.totalItems` (header), não qty de linhas

### Status logístico

Motor único `buildSalesOrderBiLogisticStatus`:

| cardId | Label |
|--------|-------|
| `deliveredOnTime` | Entregue no Prazo |
| `deliveredLate` | Entregue com Atraso |
| `overduePending` | Atrasado (Pendente) |
| `onTimePending` | No Prazo (Pendente) |
| `finishedOrCancelled` | Finalizado/Cancelado |
| `reviewData` | Revisar dados |

DataPlanejada = `expectedDeliveryDate`; DataReal = `dataProcessamento` NF.

### NF / OP

- **Com/Sem NF:** `hasInvoice` / linked NFe context
- **Com/Sem OP:** `hasLinkedProductionOrder` do lifecycle Nomus raw

### Margem

O motor **não recalcula margem**. Expõe `marginSummary` anexado pelo motor oficial (`salesOrderMarginService`).

## API principal

```typescript
import { buildSalesOrderRulesResult } from "./salesOrderRulesEngine.js";

const result = buildSalesOrderRulesResult(orders, {
  referenceDate: new Date(),
  listFilters: { year: 2026 },
  managementFilters: { year: 2026 },
  linkedNfeContextMap,
});
```

## Pendências conhecidas

- **Lista vs Gestão:** filtros independentes (`listFilters` vs `managementFilters`) — `soldAmount` da lista pode diferir de `totalSoldValue` da gestão se filtros divergirem (por design).
- **Produtos vendidos:** agrega linhas de item — escopo distinto, não coberto por este motor de pedido-header.
- **CRM SQL:** consumidor paralelo — migração futura.

## Testes

```bash
npx tsx --test src/lib/salesOrderRulesEngine.test.ts
```

## Próxima etapa (fora deste escopo)

Integrar telas, Relatório Executivo, CRM, exportações para consumir `buildSalesOrderRulesResult`.
