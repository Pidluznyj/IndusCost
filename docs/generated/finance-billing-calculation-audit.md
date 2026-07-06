# Auditoria de Cálculos — Faturamento

**Fonte executiva:** `SalesOrder` + `nomusRawResponse.nfes`  
**Diagnóstico:** `NomusNfe`  
**Previsão:** `SalesOrder.expectedDeliveryDate` (pedidos não faturados)  
**Data:** 2026-06-09

## Fonte por aba

| Aba | Fonte | Filtros |
|-----|-------|---------|
| Visão Geral | SalesOrder (NF processada) | Ano executivo |
| Acumulado NF-e | SalesOrder — série YTD acumulada | Ano |
| Mês a Mês | SalesOrder — comparativo multi-ano | Ano âncora |
| Projeção | SalesOrder — média diária YTD × dias úteis | Ano |
| Carteira Prevista | SalesOrder — pedidos não faturados | Ano |
| Detalhado NF-e | NomusNfe | Filtros NF-e |
| Comparativo | SalesOrder + NomusNfe | Ano |

## Métricas validadas

| Métrica | Fórmula | Exceção |
|---------|---------|---------|
| Faturamento ano | Σ mensal NF processada | — |
| Mês atual / meta | SUM mês; meta = anterior × 1,3 | — |
| Acumulado YTD | Σ meses ≤ ytdMonthLimit | `FINANCE_BILLING_YTD_SCOPE` |
| Projeção mês | média diária YTD × dias úteis mês | `FINANCE_BILLING_PROJECTION_SCOPE` |
| Multi-ano | 3 anos de barras | `FINANCE_BILLING_MULTI_YEAR_SCOPE` |
| Comparativo SO×NF-e | Totais mensais por fonte | `FINANCE_BILLING_COMPARISON_SCOPE` |
| Carteira prevista | Σ `totalNetValue` pedidos não faturados no ano | `FINANCE_BILLING_FORECAST_SCOPE` |
| Previsto no mês | Σ por `expectedDeliveryDate` no mês | `FINANCE_BILLING_FORECAST_SCOPE` |
| Atrasado p/ faturar | Previsto com data < hoje | `FINANCE_BILLING_FORECAST_SCOPE` |

## Regra de previsão por data

- **Campo:** `SalesOrder.expectedDeliveryDate` (Nomus `dataEntregaPadrao`)
- **Inclui:** pedidos mercado, não cancelados, **sem** NF com `dataProcessamento`
- **Exclui:** cancelados, já faturados (NF processada)
- **Valor:** `SalesOrder.totalNetValue`
- **Realizado no gráfico previsto×realizado:** faturamento por mês (NF processada)

## Correção gráficos vazios (BILL-CHART-001)

**Causa:** `ResponsiveContainer` com `height="100%"` dentro de flex sem altura definida → altura 0px.

**Correção:** `FINANCE_BILLING_CHART_HEIGHT = 280` explícito em todos os gráficos de billing.

## Correções anteriores

- **BILL-002:** export CSV NF-e
- **BILL-004:** erro visível no comparativo

## Limitações

- Previsão não filtra por cliente/CNPJ na fase atual (apenas ano)
- Migração oficial para `NomusNfe` — fase posterior
- Divergência SO vs NomusNfe documentada no comparativo

## Testes

- `financeBillingChartRender.test.ts`
- `financeBillingForecast.test.ts`
- `financeBillingChartData.test.ts`
- `financeBillingCalculationAudit.test.ts`
