# PERFORMANCE 09 — Regressão completa (Pedidos + Financeiro)

Validação funcional/técnica das otimizações PERF 03–08.  
**Sem novas features, sem mudança de layout/regras, sem commit/push/deploy.**

## 1. Cenários testados

### Pedidos de venda (automatizado)
| Área | Cobertura |
|------|-----------|
| Listagem / ordem / paginação / busca | `test:sales-orders-search`, PERF 09, `salesOrdersListSummary` |
| Filtros (ano/mês/cliente/vendedor/NF/CR) | `salesOrdersListFilters`, `buildSalesOrderListWhere` |
| Totais / summary aggregate | PERF 05 + list summary |
| Margem / permissões margem | `test:sales-orders-margins` (wiring atualizado) |
| Grid UI / drawer / tooltip | `salesOrderListGrid` |
| DTO payload (sem raw) | PERF 04 |
| Render memo / debounce | PERF 07 |
| Detalhe / abas / NF / impostos | suítes fiscais + wiring detalhe (não E2E browser) |

### Financeiro (automatizado)
| Tela | Resultado |
|------|-----------|
| Contas a Receber | `test:finance:accounts-receivable` — **289/289** |
| Contas a Pagar | `test:finance:accounts-payable` — **239/239** |
| Fluxo de Caixa | `test:finance:cash-flow` — **437/437** |
| Faturamento + NF-e | `test:finance` (billing + nfes) — **ok** |
| Navegação / BI shell | `test:finance:navigation` — **ok** |
| Permissões AR/AP/ações | `test:action-permissions` + commercial — **ok** |
| Lazy tabs / cache / Abort | PERF 03 — **ok** |
| Índices P1 | PERF 08 — **ok** |

### Não executado neste ambiente
- Navegação manual autenticada no browser
- Comparação quantitativa de IDs/totais em Postgres (`localhost:5432` **P1001**)
- `npm run perf:baseline:sales-finance` — **PENDING** (DB)

## 2. Resultados comparados (paridade)

Onde há fixture/unitário de motor:
- Cards, aging, ranking, export AR/AP batem com recálculo independente
- Totais da lista SO via aggregate ≡ população filtrada (não só página)
- Ordem lista: `createdAt DESC, issueDate DESC` preservada
- Draft ≠ applied em AR/AP/CF; export usa applied

**Diferença de velocidade ≠ diferença de resultado** — validado por asserts de igualdade numérica nas suítes de audit.

## 3. Diferenças encontradas

| Item | Tipo | Ação |
|------|------|------|
| Wiring de testes de margem/lista apontando para padrões antigos em `server.ts` | Teste desatualizado (não regra) | Atualizado para `parseSalesOrderListQuery` / metrics.server |
| PDF Helvetica: `Condição` → `Condicao` no stream | Preexistente encoding | Assert aceita ASCII |
| `requirePermission("customers.view")` vs `requireResource("commercial.customers")` | Teste desatualizado | Assert alinhado ao server |
| CF UI paths / `calendarDisplayMonth` na page | Wiring desatualizado | Assert em tipos/calendar + painéis |
| Sold products KPI card class rename | Preexistente UI | Assert aceita `FinanceExecutiveTotalizerCard` |

**Nenhuma diferença de totais/IDs/ordem/status atribuída às otimizações PERF.**

## 4. Correções realizadas (somente testes)

- `salesOrderMarginService.test.ts`
- `salesOrderManagementMargin.test.ts`
- `financeCashFlowReconciliationMap.test.ts`
- `financeCashFlowValidation.test.ts`
- `customerSearchApi.test.ts`
- `salesOrderListReportExport.test.ts`
- `soldProductCustomersPage.test.ts`
- Novo: `financeSalesRegressionPerf09.test.ts`

## 5. Testes aprovados (núcleo PERF + telas)

| Suite | Pass |
|-------|-----:|
| PERF 03–05 + 07–09 + cache/DTO/baseline unit | 39+ |
| `test:sales-orders-search` | 87 |
| `test:finance:accounts-receivable` | 289 |
| `test:finance:accounts-payable` | 239 |
| `test:finance:cash-flow` | 437 |
| `test:finance` billing+nfes + navigation | ok |
| Permissões AR/AP/commercial | ok |

## 6. Falhas / limitações preexistentes

| Item | Nota |
|------|------|
| `npm run lint` (`tsc --noEmit`) | Falha por erros em `tmp-audits/*` e fixtures admin (`permissionsVersion`) — **fora do escopo PERF**; tsconfig não exclui `tmp-audits` |
| Baseline server + migrate deploy | DB local indisponível |
| E2E visual browser | Não rodado aqui |

## 7–9. Lint / TypeScript / Build / Prisma

| Check | Resultado |
|-------|-----------|
| `npx prisma validate` | **OK** |
| `npm run build` (vite) | **OK** (`✓ built`) |
| `npm run lint` / `tsc --noEmit` | **FAIL preexistente** (`tmp-audits` + testes admin UI) — não introduzido por PERF 03–08 |

## 10. Métricas finais (estrutural — DB PENDING)

| Tela/aba | Antes (PERF 02/03) | Depois (03–08) | Melhoria |
|---|---|---|---|
| SO lista mount | list + branding + charts eager | list; branding no print; charts IO | −1 GET branding; charts adiados |
| SO detalhe reabrir ≤30s | GET detail | cache hit | −1 GET |
| Billing fora Documentos | dashboard + nfes | dashboard; nfes se aba Documentos | −0–1 GET |
| Billing voltar Documentos | refetch | cache/state | −1 GET |
| CF mount | dashboard + annual + daily | dashboard; IO annual/daily | −0–2 GET até scroll |
| AR overdue remount | GET | cache ≤60s | −1 GET |
| SO list DB | count + findMany summary | **aggregate** | −1 full scan sum |
| AR/AP aberto | Seq em balance | índice parcial `open_dueDate` (migração) | Index Scan esperado* |
| SO sort | sem índice `createdAt` | `createdAt+issueDate` idx | Index Scan esperado* |
| Digitar filtro SO | N linhas re-render | memo linhas/tabela | −renders* |
| Digitar draft AR/AP | charts re-render | memo + props estáveis | −renders* |

\* Quantitativo `dbMs` / render counts: reexecutar com DB + `localStorage.induscost_perf_baseline=1`.

## 11–13. Confirmações

- Regras de negócio / filtros / totais / permissões: **inalteradas** (suítes de audit + PERF 09)
- Layout: **inalterado** (sem virtualização; CSS/textos preservados)
- **Nenhum commit, push ou deploy** neste passo
