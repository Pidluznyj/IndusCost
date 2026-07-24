# PERFORMANCE 05 — Consultas de banco (Pedidos + Financeiro)

Sem migration, sem índices novos, sem mudança de regra/resultado/layout. Sem commit/push/deploy.

## Otimizações aplicadas

### 1. N+1 / round-trips removidos

| Local | Antes | Depois |
|-------|-------|--------|
| AP dashboard CC/fornecedores | `buildApCostCenterIntegrationContext` + **2º** `loadCostCenters`/`loadSuppliers` | Reusa `ctx.costCenterById` / `ctx.suppliers` |
| SO list (pós-página) | `linkedNfe` → depois `attachMargins` (sequencial) | `Promise.all` dos dois |

### 2. Consultas consolidadas

| Local | Antes | Depois |
|-------|-------|--------|
| SO list totals | `count` + `findMany` de **todas** as linhas (`totalNetValue`/`totalItems`) | **1×** `aggregate` (`_count` + `_sum`) |
| Round-trips iniciais SO list | 4 (page, count, summary rows, marginOrders) | 3 (page, aggregate, marginOrders) |

### 3. Filtros no banco

- Paginação da listagem de pedidos já era `skip`/`take` no Prisma — mantida.
- AR/AP titles: paginação ainda em memória (regras FIN-05 / qualidade) — **não** movida para SQL neste passo (risco alto de divergência).

### 4. Agregações

- Cards/totais da listagem SO: `prisma.salesOrder.aggregate({ where, _count, _sum })` + `buildSalesOrderListSummary` — **mesma população** do `where` da tabela.

### 5. Paralelismo seguro

- AR dashboard: `loadFinanceArRows` ‖ `loadFinanceArOpenHorizonRowsFromPrisma`
- AR titles + export.xlsx: contextos FIN-05 ‖ links NF
- SO list: linked NFe ‖ margens da página

## Arquivos

- `server.ts`
- `src/lib/financeAccountsReceivableRoutes.ts`
- `src/lib/financeAccountsPayableRoutes.ts`
- `src/lib/salesOrdersListSummary.ts` (`buildSalesOrderListSummaryFromAggregate`)
- `src/lib/financeSalesQueryPerf.test.ts`
- testes de wiring SO atualizados

## Testes

```bash
npx tsx --test src/lib/financeSalesQueryPerf.test.ts src/lib/salesOrderListApiDto.test.ts src/lib/salesOrderListIndicatorsParity.test.ts src/lib/salesOrderListMissingPresenceExclusion.test.ts src/lib/salesOrdersListSummary.test.ts
```

## Métricas (estrutural; DB PENDING)

| Cenário | Antes (round-trips) | Depois | Registros carregados |
|---------|---------------------|--------|----------------------|
| SO list (totais) | N linhas filtradas + count | 1 aggregate | 0 linhas de summary |
| SO list pós-página | 2 sequenciais (NF, margem) | 1 paralelo (2 queries) | igual (só página) |
| AR dashboard | 2 sequenciais | 1 paralelo | igual |
| AR titles enrich | 3 sequenciais | 1 paralelo (3) | igual |
| AP dashboard mestres | ctx + 2 extras | só ctx | −2 queries |

Reexecutar baseline com Postgres:

```bash
$env:INDUSCOST_PERF_BASELINE='1'
npm run perf:baseline:sales-finance
```

## Confirmações

- População/filtros/totais da listagem SO via mesma `where`
- Paridade unitária soma-em-memória ≡ aggregate helper
- Nenhum commit / push / deploy
