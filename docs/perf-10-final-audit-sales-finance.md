# PERFORMANCE 10 — Auditoria final e preparação para commit

Auditoria do pacote PERF 02–09 (Pedidos de venda + Financeiro).  
**Sem commit, push ou deploy neste passo.**

---

## 1. Classificação do diff

### Frontend
| Arquivo | Papel |
|---------|--------|
| `src/components/SalesOrdersModule.tsx` | Lazy fetch, debounce estável, IO charts, memo props, probe render |
| `src/components/sales/SalesOrderListTable.tsx` | `memo` tabela/linha |
| `src/components/sales/SalesOrderListMarginCell.tsx` | `memo` |
| `src/components/sales/SalesOrderListMonthlyCharts.tsx` | `memo` + IO |
| `src/components/sales/SalesOrderMarginInfoTooltip.tsx` | `memo` texto |
| `src/components/sales/SalesOrderDetailDialog.tsx` | cache sessão GET detalhe (30s) |
| `src/components/sales/SalesOrderQuickSummaryDrawer.tsx` | tipo opcional `marginItems` (DTO) |
| `src/components/FinanceModule.tsx` | probe render (flag) |
| `src/components/finance/FinanceAccountsReceivable*.tsx` | lazy abas, cache, Abort, memo charts/painéis |
| `src/components/finance/FinanceAccountsPayable*.tsx` | idem AP |
| `src/components/finance/FinanceBillingPage.tsx` | NF-e sob demanda / preserve state |
| `src/components/finance/FinanceCashFlowPage.tsx` + annual/daily | IO + Abort |
| `src/components/finance/due-radar/FinanceDueRadar.tsx` | debounce/Abort alinhado |
| `src/components/finance/FinanceArAnalyticalTitlesTab.tsx` | branding print sob demanda |
| `src/components/finance/FinanceArOpenHorizonSection.tsx` | props/memo |
| `src/hooks/useSectionVisible.ts` | IntersectionObserver |
| `src/lib/uiSessionGetCache.ts` | cache GET sessão |
| `src/main.tsx` | install probe cliente (flag) |

### Backend
| Arquivo | Papel |
|---------|--------|
| `server.ts` | DTO lista/detalhe, `aggregate` totais, middleware perf (flag) |
| `src/lib/salesOrderListApiDto.ts` | select + projeção HTTP lista |
| `src/lib/salesOrderLegacyDetailApiDto.ts` | select + projeção detalhe legado |
| `src/lib/salesOrdersListSummary.ts` | `buildSalesOrderListSummaryFromAggregate` |
| `src/lib/financeAccountsReceivableRoutes.ts` | `Promise.all` loads/enrich |
| `src/lib/financeAccountsPayableRoutes.ts` | reusa mestres do `ctx` |
| `src/lib/prisma.ts` | listener query só com flag |

### Banco / migration
| Arquivo | Papel |
|---------|--------|
| `prisma/schema.prisma` | `@@index` SO createdAt+issueDate, externalSellerId |
| `prisma/migrations/20260804120000_perf08_sales_finance_read_indexes/` | 4 índices P1 (+ parciais AR/AP) |

### Instrumentação (flag-controlled — **manter**)
| Arquivo | Flag |
|---------|------|
| `src/lib/devPerfBaseline*.ts` | `INDUSCOST_PERF_BASELINE=1` / `localStorage` / `VITE_PERF_BASELINE` |
| `scripts/perf-baseline-sales-finance.ts` | script CLI |
| `scripts/perf-*-explain-prep.sql` | EXPLAIN prep (não executa sozinho) |
| `package.json` scripts `perf:baseline:*` / `test:perf-baseline` | entrada npm |

### Testes (PERF + wiring alinhado)
| Arquivo |
|---------|
| `src/lib/financeSales*.test.ts`, `uiSession*.test.ts`, `salesOrderListApiDto.test.ts`, `devPerfBaseline.test.ts` |
| Ajustes: `salesOrderMargin*.test.ts`, `salesOrderList*.test.ts`, `financeCashFlow*.test.ts`, `salesOrderListReportExport.test.ts` |

### Docs
| Arquivo |
|---------|
| `docs/perf-baseline-sales-finance.md` … `docs/perf-10-final-audit-sales-finance.md` |

### Arquivos fora do escopo PERF (mistura — **não incluir no commit PERF**)
| Arquivo | Motivo |
|---------|--------|
| `src/lib/customerSearchApi.test.ts` | Assert de permissão (`requireResource`) — wiring comercial, não performance |
| `src/lib/soldProductCustomersPage.test.ts` | Rename KPI card comercial — não Pedidos/Financeiro PERF |

### Removido / não encontrado no working tree
- Sem logs temporários, dumps, credenciais, `tmp-audits/perf*`, medições geradas.
- Instrumentação permanente **não** presente: só no-op sem flag; com flag, header agregado sem SQL/payload sensível.

---

## 2. Escopo confirmado (sem mudança funcional/visual)

| Item | Status |
|------|--------|
| Regras de negócio / cálculos / status | Inalterado (suítes audit + PERF 09) |
| Filtros / totais / permissões | Inalterado |
| Layout / textos / estilos / ações | Inalterado (sem virtualização) |
| Contratos externos | Lista/detalhe: campos omitidos **não** eram consumidos pela UI; campos de ação/IDs/totais preservados |

---

## 3. Instrumentação

**Mantida** (pequena, flag, operacional, sem dados sensíveis):
- Client: fetch probe + render counts só com flag DEV
- Server: middleware + Prisma query events só com `INDUSCOST_PERF_BASELINE=1` e `NODE_ENV !== production`
- Header `X-IndusCost-Perf` (métricas agregadas)

**Não há** instrumentação temporária a remover além do já gated.

---

## 4. Resultados consolidados (estrutural; ms reais PENDING sem DB)

| Dimensão | Antes | Depois | Melhoria |
|----------|-------|--------|----------|
| Requisições (mount típico) | SO: list+branding+charts; CF: 3 GET; Billing: dash+nfes; AR overdue remount: GET | branding/print; charts/IO; cache 30–60s; lazy abas | −0–3 GET por tela |
| Payload SO lista | spread Prisma + Customer full + raw em summary | DTO slim (sem raw/sync no JSON) | Alto (transfer) |
| Consultas SO totais | `count` + `findMany` N | 1× `aggregate` | −1 scan + −N rows |
| Consultas AR/AP | sequencial | `Promise.all` / reuso ctx | −latência wall; AP −2 queries mestres |
| Renders digitar filtro | tabela/charts re-render amplos | memo + props estáveis | −renders |
| Índices | seq/filtros sem idx sort | P1 SO + parciais AR/AP | Index Scan esperado* |

**Maior ganho esperado:** listagem Pedidos (aggregate + DTO + memo), AR titles/dashboard (paralelismo), CF mount (IO), reabertura detalhe SO (cache).

**Ainda dependentes de volume/servidor:** dashboards AR/AP com muitos títulos abertos; CF YTD; EXPLAIN/migrate apply em ambiente real; baseline `npm run perf:baseline:sales-finance` (**P1001** local).

---

## 5. Testes finais (reexecução PERF 10)

| Check | Resultado |
|-------|-----------|
| PERF unit (03–05,07–09 + cache/DTO/baseline) | **56/56** |
| `test:sales-orders-search` | **87/87** |
| `test:finance:accounts-receivable` | **289/289** |
| `test:finance:accounts-payable` | **239/239** |
| `test:finance:cash-flow` | **437/437** |
| `npx prisma validate` | **OK** |
| `npm run build` | **OK** |
| `npx prisma migrate status` | **P1001** (DB local offline) — migration SQL revisada nos testes PERF 08 |
| `npm run lint` (`tsc --noEmit`) | **FAIL preexistente** (`tmp-audits/*`, fixtures admin `permissionsVersion`, erros antigos em `server.ts` fora das rotas PERF) |

**Nenhum erro novo atribuído aos arquivos PERF** (build Vite passa; suítes afetadas verdes).

---

## 6. Git — estado e separação

### Status (resumo)
- **40** arquivos modificados rastreados (+1041 / −501)
- **28** untracked (docs PERF, migration, scripts, libs/hooks/testes PERF)
- **Sem** Kanban / IRPJ-CSLL / publicação de custos / precedência MP / Provisão por pedido no diff

### Separação obrigatória antes do commit PERF

**Commit A — PERF (este pacote):** tudo listado nas seções Frontend/Backend/Banco/Instrumentação/Testes PERF/Docs, **exceto** os dois abaixo.

**Commit B — wiring comercial (opcional, separado):**
1. `src/lib/customerSearchApi.test.ts`
2. `src/lib/soldProductCustomersPage.test.ts`

> **Não fazer commit único misturando A+B.**  
> Neste passo: **nenhum commit realizado.**

### Mensagem sugerida (somente Commit A)

```
perf(sales-finance): lazy fetch, DTOs, aggregates, memo e índices P1

Reduz GETs/payloads/consultas/re-renders em Pedidos e Financeiro sem
alterar filtros, totais, permissões ou layout. Inclui migration de
índices de leitura P1 e baseline opcional por flag.
```

---

## 7. Checklist de entrega

1. **Arquitetura:** cache sessão + lazy aba/IO; DTO/select; aggregate + Promise.all; memo React; índices P1; probe por flag.  
2. **Gargalos corrigidos:** fetch eager, payload raw, summary N-rows, round-trips AR/AP, re-renders de grade/charts, sort sem índice.  
3. **Frontend:** §1 Frontend.  
4. **Backend:** §1 Backend.  
5. **Banco:** índices P1 + schema.  
6. **Índices:** `SalesOrder_createdAt_issueDate_idx`, `SalesOrder_externalSellerId_idx`, `NomusAccountsReceivable_open_dueDate_idx`, `NomusAccountsPayable_open_dueDate_idx`.  
7. **Arquivos:** ver git status (40 M + 28 ??).  
8. **Migration:** `20260804120000_perf08_sales_finance_read_indexes`.  
9. **Testes:** §5 (todos verdes nas suítes afetadas).  
10. **Métricas:** §4 (quantitativo ms PENDING DB).  
11. **Falhas preexistentes:** lint/tsc `tmp-audits` + admin fixtures; migrate status P1001.  
12. **Lint:** FAIL preexistente.  
13. **TypeScript:** erros preexistentes; build OK.  
14. **Build:** OK.  
15. **Git status:** dirty PERF; 2 testes fora de escopo.  
16. **Mensagem commit:** §6.  
17. **Sem mudança funcional:** confirmado.  
18. **Sem mudança visual:** confirmado.  
19. **Sem commit / push / deploy:** confirmado.
