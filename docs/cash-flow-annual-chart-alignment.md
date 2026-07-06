# Alinhamento — Fluxo anual vs Fluxo planejado

## Fonte do gráfico planejado (referência)

| Camada | Função / componente |
|--------|---------------------|
| UI | `FinanceCashFlowMonthlyPlannedChart` |
| Mapeamento gráfico | `buildExecutiveMonthlyPlannedChartRows` (`financeCashFlowExecutiveChart.ts`) |
| Timeline mensal | `buildExecutiveMonthlyTimeline` (`financeCashFlowExecutiveSummary.ts`) |
| Filtros carteira | `filterArRowsForYtdReceived` + `filterApRowsForCashFlowExecutiveTimeline` |
| Alocação mensal | Recebido/Pago pelo **vencimento**; A Receber/A Pagar pelo **vencimento em aberto** |
| Tabela | `FinanceCashFlowMonthlyTimelineTable` — colunas Entradas est. / Saídas est. / Saldo líq. |

## Fonte antiga do gráfico anual (divergente)

| Camada | Função |
|--------|--------|
| Endpoint | `GET /api/finance/cash-flow/annual-comparison` |
| Motor antigo | `buildAnnualComparisonMonthlyTimeline` em `financeCashFlowAnnualComparison.ts` |
| Filtros | `filterArRowsForAnnualComparison` / `filterApRowsForAnnualComparison` |
| Alocação | Recebido/Pago pela **data de baixa/pagamento**; aberto por vencimento |

## Causa da divergência

O gráfico anual recalculava entradas/saídas realizadas por **data de liquidação/pagamento**, enquanto o fluxo planejado (e a tabela Linha do tempo mensal) aloca realizados pelo **vencimento operacional** (`dueDate`). Isso deslocava valores entre meses e impedia que `netCashAmount` coincidisse com `netFlow` / Saldo líq.

## Correção aplicada

`buildCashFlowAnnualComparison` passou a:

1. Filtrar carteira com `filterRowsForPlannedAnnualComparison` (mesmos filtros YTD do planejado, sem mês da página).
2. Chamar `buildExecutiveMonthlyTimeline` — **sem recálculo paralelo**.
3. Mapear cada linha via `mapExecutiveMonthlyRowToAnnualComparisonMonth`:

| Payload anual | Timeline planejada |
|---------------|-------------------|
| `receivedAmount` | `received` |
| `receivableOpenAmount` | `receivableOpenDue` |
| `cashInTotalAmount` | `estimatedInflow` |
| `paidAmount` | `paid` |
| `payableOpenAmount` | `payableOpenDue` |
| `cashOutTotalAmount` | `estimatedOutflow` |
| `netCashAmount` | `netFlow` |
| `accumulatedCashAmount` | `accumulatedNet` |
| `plannedNetCashAmount` | `netFlow` (mesmo valor) |
| `differenceAgainstPlanned` | sempre `0` |

Resposta do endpoint inclui `source: "cash-flow-planned-engine"`.

Helpers legados por baixa/pagamento permanecem exportados (`@deprecated`) apenas para testes de regressão do motor antigo.

## Regra de equivalência mês a mês

Para cada mês `m`:

```
cashInTotalAmount  = receivedAmount + receivableOpenAmount  = estimatedInflow
cashOutTotalAmount = paidAmount + payableOpenAmount         = estimatedOutflow
netCashAmount      = cashInTotalAmount - cashOutTotalAmount = netFlow (planejado)
differenceAgainstPlanned = netCashAmount - plannedNetCashAmount = 0
```

Critério: diferença zero ou apenas centavos por arredondamento (`roundMoney`).

## Auditoria

```bash
npx tsx scripts/audit-cash-flow-annual-comparison.ts --year=2026
```

Compara mês a mês entradas, saídas, saldo anual e saldo do gráfico planejado.
