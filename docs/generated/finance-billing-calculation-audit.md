# Auditoria de Cálculos — Faturamento

**Fonte executiva:** `SalesOrder` + `nomusRawResponse.nfes`  
**Diagnóstico:** `NomusNfe`  
**Data:** 2026-06-09

## Métricas validadas

| Métrica | Escopo | Exceção |
|---------|--------|---------|
| Faturamento ano | Ano aplicado | — |
| Mês atual / meta | Ano aplicado | — |
| Acumulado YTD | Ano | `FINANCE_BILLING_YTD_SCOPE` |
| Projeção anual | Ano | `FINANCE_BILLING_PROJECTION_SCOPE` |
| Multi-ano | Âncora ano | `FINANCE_BILLING_MULTI_YEAR_SCOPE` |
| Comparativo SO×NF-e | Ano | `FINANCE_BILLING_COMPARISON_SCOPE` |
| Faturamentos recentes | Global | `FINANCE_BILLING_RECENT_ORDERS_SCOPE` |
| Export CSV NF-e | Filtros NF-e | `FINANCE_BILLING_NFE_EXPORT_SCOPE` |

## Correções nesta fase

- **BILL-002:** endpoint `GET /api/finance/billing/export` (CSV NF-e filtrado)
- **BILL-004:** erro visível no comparativo (não mais engolido)

## Pendências

- Migração oficial para `NomusNfe` — fase posterior
- Divergência SO vs NomusNfe documentada no comparativo (não escondida)
