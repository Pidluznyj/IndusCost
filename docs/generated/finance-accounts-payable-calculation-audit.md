# Auditoria de Cálculos — Contas a Pagar

**Fonte:** `NomusAccountsPayable`  
**Data:** 2026-06-09

## Métricas validadas

| Métrica | Campo | Exceção |
|---------|-------|---------|
| Obrigações em aberto | `totalOpenAmount` | — |
| Vencido | `overdueAmount` | — |
| Vence hoje | `dueTodayAmount` | — |
| Vencido > 30 dias | `overdueOver30DaysAmount` | — |
| Pago no mês | `paidThisMonthAmount` | **Calendário atual** (`FINANCE_AP_PAID_THIS_MONTH_SCOPE`) |
| % em atraso | `overduePercent` | — |
| Próx. 7/30 dias | `dueNext7DaysAmount` / `dueNext30DaysAmount` | — |
| Aging | `agingBuckets` | — |
| Top fornecedores | `topSuppliers` | Limite 10 |
| Títulos críticos | `criticalTitles` | Limite 20 |

## Defaults

Ano corrente injetado quando nenhum período informado — rotulado com `FINANCE_AP_DEFAULT_YEAR_SCOPE`.

## Suite

`financeAccountsPayableCalculationAudit.test.ts`
