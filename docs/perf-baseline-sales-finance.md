# PERFORMANCE 02 — Linha de base Pedidos + Financeiro

Instrumentação isolada por flag. **Não altera regras de negócio nem layout.**

## Como medir (reexecutar)

### A) Script server-side (recomendado — serviços reais)

```bash
# PowerShell
$env:INDUSCOST_PERF_BASELINE='1'
$env:PERF_BASELINE_YEAR='2026'
$env:PERF_BASELINE_MONTH='7'
npm run perf:baseline:sales-finance
```

Requer `DATABASE_URL` apontando para o Postgres local/staging.

Saída: `tmp-audits/perf-baseline-sales-finance-<timestamp>.json`

### B) Middleware HTTP (dev server)

```bash
$env:INDUSCOST_PERF_BASELINE='1'
npm run dev
```

Navegue nas telas autenticado. Cada `/api/sales-orders*` e `/api/finance/*` emite:

- log `[perf-baseline:http] …`
- header `X-IndusCost-Perf: totalMs=…;dbMs=…;queries=…;bytes=…`

### C) Browser (fetch + renders)

No DevTools (somente DEV):

```js
localStorage.setItem('induscost_perf_baseline', '1')
location.reload()
// após navegar:
window.__induscostPerfBaseline.getSamples()
window.__induscostPerfBaseline.getRenderCounts()
```

Desligar: `localStorage.removeItem('induscost_perf_baseline')`

### D) EXPLAIN (autorizado depois)

Arquivo: `scripts/perf-baseline-explain-prep.sql`  
Usar `EXPLAIN` (não `EXPLAIN ANALYZE` em produção neste passo).

## Cenários comparáveis

| # | Cenário | Como reproduzir |
|---|---------|-----------------|
| 1 | Lista sem filtros (ano) | `/sales-orders` ano corrente |
| 2 | Lista com filtro mês | mês destaque |
| 3 | Trocar página | página 2 |
| 4 | Pedido com muitos itens | abrir detalhe do pedido mais “pesado” |
| 5 | Alternar abas detalhe | Geral → Tributos → Custos → Resultado (sem refetch esperado) |
| 6 | Financeiro sem filtros | `/finance/cash-flow` padrão |
| 7 | AR / AP / Billing / DRE / Executive | cada seção do `FinanceModule` |
| 8 | Alternar mês/período | Aplicar filtros |
| 9 | Retornar à aba já aberta | observar se refetch ocorre |

## Arquivos da instrumentação

| Arquivo | Papel |
|---------|--------|
| `src/lib/devPerfBaseline.ts` | flags + tipos + summarize |
| `src/lib/devPerfBaseline.server.ts` | ALS, measure, middleware HTTP |
| `src/lib/devPerfBaselineClient.ts` | fetch probe + render counts |
| `src/lib/prisma.ts` | event `query` só com flag |
| `server.ts` | middleware opcional |
| `src/main.tsx` | install client opcional |
| `scripts/perf-baseline-sales-finance.ts` | runner de cenários |
| `scripts/perf-baseline-explain-prep.sql` | EXPLAIN prep |
| `src/lib/devPerfBaseline.test.ts` | testes unitários |

## Confirmação

- Flag off → zero overhead funcional (middleware não registra; client não patcha fetch).
- Em `NODE_ENV=production` a flag server é ignorada.
- Respostas JSON das APIs não mudam (só header opcional com flag).
