# Diagnóstico — Aba Resultado (Pedidos de Venda)

Data: 2026-06-24

## Respostas

1. **Rota/componente:** `/sales-orders` → `SalesOrdersModule` (lista). Nova aba: `/sales-orders/result` → `SalesOrderResultPage`.
2. **Abas:** A lista principal não tinha abas; sub-rotas (`/management`, `/sold-products`, `/indicators`). Resultado segue o mesmo padrão de sub-rota.
3. **Lista/detalhe:** Lista em `/sales-orders`, detalhe em `/sales-orders/:id`.
4. **Valor vendido:** `extractSalesOrderItemRevenue` + `SalesOrder.totalNetValue` via `salesOrderMarginMath` / `salesOrderMetricsEngine`.
5. **Custo:** `resolveSalesOrderItemCost` → `getProductCostAnalysis` / `productOfficialFinalCost` (CIU oficial).
6. **Margem de pedido:** `calculateSalesOrderItemMargin` + `calculateSalesOrderMarginSummary` em `salesOrderMarginMath.ts`.
7. **Imposto médio:** Não existia label literal. Fonte oficial = soma de `TaxComponent.percentage` da `TaxRule` (`ProductPricing` ou regra fiscal padrão ACTIVE). Motor: `averageSalesTaxEngine.ts`.
8. **Imposto na margem atual:** **Não.** Margem oficial PV = receita líquida − custo (sem imposto). A aba Resultado estende com camada gerencial documentada.
9. **Custo de produto:** CIU oficial (`totalIndustrialCost`) via motor de custo; snapshot histórico quando disponível.
10. **Produto vinculado:** `resolveSalesOrderItemProduct` (productId, SKU, Nomus raw).
11. **Sem produto:** status `SEM_PRODUTO_VINCULADO`, alerta, excluído da margem consolidada.
12. **Sem custo:** status `SEM_CUSTO`, alerta, custo não inventado.
13. **Margem negativa:** status `MARGEM_NEGATIVA`, destaque vermelho.
14. **Margem agregada hoje:** ponderada por receita (`Σ margem / Σ receita`), não média simples.
15. **Meta/projeção:** `buildSalesOrdersDashboardTab` + `salesOrderDashboardRules` (+30% sobre ano anterior).
16. **Dias úteis:** `executiveDashboardWorkdays.ts` (seg–sex, sem feriados).
17. **Helper feriados:** não implementado nesta fase.
18. **Payload PV existente:** listagem com `marginSummary`; indicadores em `/api/sales-orders/margin-indicators`.
19. **Backend criado:** `buildSalesOrderResultDashboard`, GET `/api/sales-orders/results`.
20. **Só visual:** layout, gráficos Recharts, filtros UI, tooltips.

## Divergência de margem

| Motor oficial PV | Margem gerencial (aba Resultado) |
|------------------|----------------------------------|
| netRevenue − cost | (netRevenue − tax) − cost |
| Sem imposto | TaxRule oficial |

A extensão está em `salesOrderResultMath.ts`, não altera `salesOrderMarginMath.ts`.

## Projeção

- Mês atual: média diária do mês × dias úteis totais do mês.
- Meses futuros: média diária YTD × dias úteis do mês.
- Meta: `computeGrowthTarget` (+30% ano anterior) quando histórico existe.

## Limitações

- Feriados não considerados nos dias úteis.
- Imposto por produto usa primeira TaxRule em ProductPricing; fallback = regra fiscal ACTIVE padrão.
