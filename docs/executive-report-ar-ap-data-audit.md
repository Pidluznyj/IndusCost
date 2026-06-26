# Auditoria de dados AR/AP — Relatório Executivo Financeiro e Comercial

## 1. Helper/endpoint da tela Contas a Receber

- **Rota:** `GET /api/finance/accounts-receivable/dashboard`
- **Carga:** `loadFinanceArManagementRowsFromPrisma` + `loadFinanceArOpenHorizonRowsFromPrisma` (horizonte)
- **Motor:** `buildFinanceAccountsReceivableDashboard` em `financeAccountsReceivableDashboard.ts`
- **Filtros:** `parseFinanceArDashboardFilters` / query da página AR

## 2. Helper/endpoint da tela Contas a Pagar

- **Rota:** `GET /api/finance/accounts-payable/dashboard`
- **Carga:** `loadFinanceApRows` (Prisma via `buildFinanceApPrismaWhere`)
- **Motor:** `buildFinanceAccountsPayableDashboard` em `financeAccountsPayableDashboard.ts`
- **Filtros:** `parseFinanceApDashboardFilters` + `resolveFinanceApDashboardFiltersForLoad`

## 3. Helper/endpoint do Relatório Executivo (após correção)

- **Rota:** `GET /api/finance/executive-report`
- **Orquestração:** `buildFinanceExecutiveReport` em `financeExecutiveReport.ts`
- **Camada de KPIs:** `financeExecutiveReportDataSources.ts`
  - `buildExecutiveReportReceivablesSection` → motor AR oficial
  - `buildExecutiveReportPayablesSection` → motor AP oficial
- **Gráficos anuais AR/AP:** `buildCashFlowAnnualComparison` com portfólio carregado pelos **mesmos filtros** do relatório (`buildExecutiveReportCashFlowFilters`)

## 4. Onde estava a divergência

| Métrica | Antes (relatório) | Oficial AR/AP |
|---------|-------------------|---------------|
| Em aberto / Vencido | Dashboard oficial ✓ | Dashboard cards |
| Recebido/Pago mês | `buildCashFlowAnnualComparison` (realização por baixa, **filtros mínimos**) | `receivedThisMonthAmount` / `paidThisMonthAmount` (baixa/pagamento no mês calendário, **filtros da tela**) |
| Recebido/Pago YTD | Soma mensal do comparativo anual filter-independent | Não exposto como card único; calculado agora via `sumFinanceArReceivedBySettlementInPeriod` / `sumFinanceApPaidInPaymentPeriod` com **mesma regra do dashboard** |
| Gráfico AR/AP | Portfólio sem empresa/NFe/escopo gerencial | Deve refletir filtros do relatório |

## 5–7. Filtros, data-base, mês/ano

- Relatório usa `asOfDate` como `referenceDate` (fim do dia civil). Telas ao vivo usam `new Date()` — para paridade use a mesma `asOfDate` no script de auditoria.
- Filtros mapeados em `buildExecutiveReportArFilters` / `buildExecutiveReportApFilters` (empresa, ano, mês, NF-e, escopo gerencial).
- Comparativo anual passou a usar `cashFlowFilters` do relatório, não mais `createAnnualComparisonBaseFilters()` isolado.

## 8–15. Regras de negócio

| Pergunta | Resposta |
|----------|----------|
| Vencimento vs baixa? | Recebido/Pago mês e YTD usam **data de baixa/pagamento** (mesma regra dos cards oficiais). Em aberto/vencido usam classificação operacional do dashboard. |
| Saldo vs recebido? | Cards de realizado usam `amountReceived` / `resolveFinanceApRealizedAmount`, não saldo em aberto. |
| Cancelados/excluídos? | Mesmos filtros `filterFinanceArManagementReportRows` / `filterFinanceApRows` + syncCutoff Nomus. |
| Saneamento gerencial? | Sim — mesma carga Prisma e cutoffs. |
| Data civil / timezone? | `startOfLocalDay` / `endOfLocalDay` — sem UTC shift. |
| Valores líquidos vs originais? | Mesmos campos do dashboard (`amountReceived`, `balanceReceivable`, etc.). |
| Duplicidade de parcelas? | Deduplicação AR via `deduplicateFinanceArRows` no pipeline oficial. |
| Mês corrente vs anual? | KPIs de mês usam mês do relatório; YTD acumula Jan→mês selecionado (cap em `asOfDate` quando no mês corrente). |

## Metadados de auditoria no payload

```json
{
  "accountsReceivable": { "metricsSource": "official-accounts-receivable-engine" },
  "accountsPayable": { "metricsSource": "official-accounts-payable-engine" }
}
```

## Script de comparação

`scripts/audit-executive-report-financial-sources.ts`

```bash
npx tsx scripts/audit-executive-report-financial-sources.ts --year=2026 --month=6 --asOfDate=2026-06-26
```
