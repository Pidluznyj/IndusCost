# PERFORMANCE 11 — Commit, merge, regressão e push

Integração segura das otimizações Pedidos + Financeiro (PERF 02–10).

## Branches

| Papel | Branch | Tip |
|-------|--------|-----|
| Base | `origin/main` | `83f17a2` |
| Trabalho | `perf/sales-finance` | `155a687` + `306f6ce` |
| Integração | `integration/performance-sales-finance` | merge `67fd425` |
| Oficial | `main` | após merge da integração |

## Commits

1. `155a687` — `perf(sales-finance): otimizar carregamento e consultas`
2. `306f6ce` — `perf(database): adicionar índices para pedidos e financeiro`
3. `67fd425` — `merge: integrar otimizações de pedidos e financeiro`

## Excluídos do escopo (não commitados)

- `src/lib/customerSearchApi.test.ts`
- `src/lib/soldProductCustomersPage.test.ts`

## Migration

`prisma/migrations/20260804120000_perf08_sales_finance_read_indexes/` — só índices P1; **não aplicada em produção neste passo**.

## Validações

Pré-commit / pós-merge / branch oficial: suítes PERF (56), SO search (87), AR (289), AP (239), CF (437), nav (17), action-permissions (36), `prisma validate`, `vite build` — OK.  
`tsc --noEmit` / lint: falhas preexistentes (`tmp-audits`, fixtures admin).  
Conflitos: nenhum. Marcadores `<<<<<<<`: zero em código.

## Confirmações

Sem deploy, sem migrate no servidor, sem sync, sem force push, sem alteração de dados/regras/layout.
