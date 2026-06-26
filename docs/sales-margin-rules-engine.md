# Motor oficial de regras — Margem de Venda

Versão: `SALES_MARGIN_RULES_ENGINE_VERSION` (`1.0.0`)

## Objetivo

Concentrar as regras oficiais de Margem de Venda em um módulo server-side, pronto para consumo futuro por Pedidos de Venda, Gestão, Aba Resultado, CRM, Relatório Executivo, PDFs e Excel — **sem alterar consumidores existentes nesta fase**.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/lib/salesMarginRulesEngine.ts` | Motor principal |
| `src/lib/salesMarginRulesEngine.types.ts` | Contratos/tipos |
| `src/lib/salesMarginRulesEngine.test.ts` | Testes unitários + compatibilidade |
| `docs/sales-margin-rules-engine.md` | Esta documentação |

## Fontes consolidadas (orquestração — não duplicar)

| Domínio | Helper delegado |
|---------|-----------------|
| Receita/custo/margem item (PV) | `salesOrderMarginMath.calculateSalesOrderItemMargin` |
| Consolidação pedido | `salesOrderMarginMath.calculateSalesOrderMarginSummary` |
| Imposto médio | `averageSalesTaxEngine` (TaxRule / ProductPricing) |
| Margem gerencial com imposto | `salesOrderResultMath.computeSalesOrderResultItem` |
| Agregação multi-pedido | `salesOrderMarginDisplay.aggregateSalesOrderMarginSummaries` |
| Status / elegibilidade | `salesOrderMarginStatus` |
| Resolução custo runtime (DB) | `salesOrderMarginService.server` — **fora deste motor**; inputs chegam com `unitCost` resolvido |
| Pedidos de Venda (receita) | preparado para `salesOrderRulesEngine` — não duplica regra de pedido |
| NF-e (faturamento) | `sourceMode invoiceBased` — **pendente** |

## Modos de fonte

| Modo | Descrição |
|------|-----------|
| `orderBased` | Receita de `SalesOrderItem` (`netTotalValue` ou `qty × netUnitPrice`) — **padrão** |
| `invoiceBased` | Receita de NF vinculada — contrato preparado; implementação futura |

## Fórmulas oficiais

### Receita bruta vendida (`grossSalesAmount`)

`netTotalValue ?? quantity × netUnitPrice` — mesma regra de `salesOrderMarginMath`.

### Imposto estimado (`taxAmount`)

`grossSalesAmount × taxPercent / 100` via `computeSalesTaxAmount`.

- `taxPercent` por produto: `ProductPricing → TaxRule` (`loadProductTaxPercentIndex`)
- Fallback: regra fiscal ACTIVE (`resolveDefaultSalesTaxPercent`)
- **Nunca** percentual hardcoded no motor

### Receita líquida gerencial (`netSalesAmount`)

`grossSalesAmount − taxAmount` — mesma regra da aba Resultado.

### Custo total (`totalCost`)

`unitCost × quantity` — custo unitário oficial do produto (já resolvido upstream).

### Margem R$ gerencial (`marginAmount`)

`netSalesAmount − totalCost`

### Margem % (`marginPercent`)

`marginAmount / netSalesAmount × 100` — por item/pedido.

### Margem % agregada

`Σ marginAmount / Σ netSalesAmount × 100` — **ponderada**, nunca média simples de %.

### Markup

`netSalesAmount / totalCost` quando custo > 0.

### Margem vendida (sem camada fiscal — PV/Gestão)

`soldMarginAmount = netRevenue − totalCost` — espelha `salesOrderMarginMath` (`taxMode none`).

## Tratamentos especiais

| Situação | Status | Comportamento |
|----------|--------|---------------|
| Item cancelado | `ITEM_CANCELADO` | Excluído da consolidação |
| Sem produto | `SEM_PRODUTO_VINCULADO` | Sem custo inventado |
| Sem custo | `SEM_CUSTO` | Alerta; excluído da consolidação |
| Custo zero | `CUSTO_ZERO` | Margem % null |
| Receita zero | `RECEITA_INVALIDA` | Sem NaN |
| Margem negativa | `MARGEM_NEGATIVA` | Alerta; entra na consolidação |
| Pedido parcial | `PARTIAL` | Itens válidos consolidados |

## Cancelados, cortes e parciais

- **Cancelados:** itens com `isCanceled` ou status Nomus cancelado — excluídos (`ITEM_CANCELADO`)
- **Cortes/parciais:** receita usa valor vendido do item (`netTotalValue`); não recalcula por NF neste modo
- **Pedido cancelado:** filtro `includeCanceled: false` (padrão) exclui pedido inteiro

## Pendências conhecidas

| Tópico | Notas |
|--------|-------|
| PV vs Resultado | PV usa margem sobre receita vendida sem deduzir imposto; Resultado deduz imposto TaxRule |
| `invoiceBased` | Aguarda motor NF-e oficial |
| Resolução de custo DB | Continua em `salesOrderMarginService.server`; motor recebe inputs resolvidos |

## API principal

```typescript
import { buildSalesMarginRulesResult } from "./salesMarginRulesEngine.js";

const result = buildSalesMarginRulesResult(orders, {
  referenceDate: new Date(),
  year: 2026,
  taxMode: "deductFromGross",
  taxContext: {
    productTaxIndex,
    defaultTaxPercent: 8,
    defaultTaxLabel: "Regra padrão",
  },
});
```

## Testes

```bash
npx tsx --test src/lib/salesMarginRulesEngine.test.ts
```

## Próxima etapa (fora deste escopo)

Integrar telas, Relatório Executivo, CRM, Aba Resultado e exportações para consumir `buildSalesMarginRulesResult`.
