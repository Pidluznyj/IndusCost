# Auditoria de Cálculos — Contas a Receber

**Projeto:** IndusCost  
**Branch:** `main`  
**Data:** 2026-06-09  
**Fonte oficial:** `NomusAccountsReceivable`

---

## 1. Métricas validadas

| Métrica UI | Campo | Fórmula independente | Filtros | Exceção |
|------------|-------|----------------------|---------|---------|
| Carteira em aberto | `cards.totalOpenAmount` | Σ `balanceReceivable` > 0 | Todos | — |
| Vencido | `cards.overdueAmount` | Σ saldo open com `classify === overdue` | Todos | — |
| Vencido > 30 dias | `cards.overdueOver30DaysAmount` | Σ saldo com `daysOverdue > 30` | Todos | — |
| Recebido no mês | `cards.receivedThisMonthAmount` | Σ `amountReceived` com `settlementDate` no mês corrente | Todos | **Calendário atual** |
| % Inadimplência | `cards.delinquencyRate` | vencido ÷ aberto × 100 | Todos | — |
| Atraso médio | `cards.avgDaysOverdue` | média ponderada por saldo vencido | Todos | null se sem vencidos |
| Aging (8 faixas) | `agingBuckets` | soma = saldo open com `dueDate` | Todos | sem `dueDate` excluído |
| Top devedores | `topDebtors` | top 10 por agrupamento CNPJ/nome | Todos | limite 10 |
| Títulos críticos | `criticalTitles` | top 20 open por `daysOverdue` | Todos | limite 20 |
| Export CSV | arquivo | mesmas linhas de `filterFinanceArRows` | aplicados | — |

---

## 2. Exceções rotuladas na UI

| Constante | Texto |
|-----------|-------|
| `FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE` | Recebido no mês — calendário atual, não filtro de vencimento |
| `FINANCE_AR_LAST_SYNC_FILTERED_SCOPE` | Última sync = MAX(syncedAt) entre registros filtrados |
| `FINANCE_AR_PORTFOLIO_IMMEDIATE_SCOPE` | Portfolio NF aplica filtro imediato |

**Decisão:** manter `receivedThisMonth` no calendário atual — regra de negócio já validada; alterar para mês filtrado exigiria mudança de contrato e alinhamento com AP.

---

## 3. Performance — AR-001

**Antes:** `findMany` sem `where` em dashboard, export e titles.

**Agora:** `buildFinanceArPrismaWhere` aplica pré-filtro seguro:

- ano/mês e vencimento de/até (`resolveFinanceArDueDateBounds`);
- empresa, cliente, CNPJ, forma de pagamento, conta (contains insensitive);
- status open/settled/suspended/overdue/dueToday/upcoming (parcial);
- NF emitida (sourceInvoiceId / sourceInvoiceNumber).

**Pós-carga:** `filterFinanceArRows` mantém paridade exata (substring CNPJ, classificação suspended, etc.).

**Não pré-filtrado em Prisma (por design):** busca textual parcial que Prisma não espelha 100%; classificação fina de suspended vs overdue em casos limítrofes.

---

## 4. Suite de testes

- `financeAccountsReceivableCalculationAudit.test.ts` — recálculo independente vs dashboard
- `financeAccountsReceivableDashboard.test.ts` — `buildFinanceArPrismaWhere`
- `financeDashboardConsistencyAudit.test.ts` — regressão transversal

---

## 5. Resultado

Todas as métricas auditadas batem com recálculo independente no fixture de referência (06/06/2026). Nenhuma regra de cálculo alterada nesta fase.
