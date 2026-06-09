# Auditoria de Consistência — Dashboards Financeiros

**Projeto:** IndusCost  
**Branch:** `main`  
**Data:** 2026-06-09  
**Escopo:** Contas a Receber · Contas a Pagar · Faturamento

---

## 1. Resumo executivo

Auditoria técnica dos três menus financeiros para validar fontes oficiais, fórmulas, filtros aplicados e exceções documentadas.

| Tela | Fonte oficial | Status filtros | Exceções rotuladas |
|------|---------------|----------------|-------------------|
| Contas a Receber | `NomusAccountsReceivable` | ✅ Aplicados em widgets/export | Sync global; portfolio NF imediato |
| Contas a Pagar | `NomusAccountsPayable` | ✅ Aplicados em widgets/export | Sync global; ano padrão corrente |
| Faturamento executivo | `SalesOrder` + NF raw Nomus | ✅ Ano aplicado | YTD, multi-ano, projeção, comparativo, recentes |
| Faturamento NF-e | `NomusNfe` (diagnóstico) | ✅ Filtros NF-e aplicados | Fonte em validação |

**Correções nesta auditoria (fase AR):**
- Label AP `paidGreaterThanPayable`: "Valor pago maior que valor original" (antes copiava AR).
- Rótulo `FINANCE_BILLING_RECENT_ORDERS_SCOPE` em faturamentos recentes.
- Testes de export corrigidos (`format=csv` além dos filtros do dashboard).
- Suite `financeDashboardConsistencyAudit.test.ts` com cobertura transversal.

**Correções nesta fase (AP + Billing BI):**
- AP: UX BI executivo — resumo 6 KPIs, filtros principais visíveis, filtros avançados colapsáveis, chips, aging/ranking/action center.
- AP: rótulos `FINANCE_AP_PAID_THIS_MONTH_SCOPE`, `FINANCE_AP_DEFAULT_YEAR_SCOPE`, `FINANCE_AP_LAST_SYNC_FILTERED_SCOPE`.
- AP: auditoria de cálculos (`financeAccountsPayableCalculationAudit`).
- Billing: UX BI executivo — resumo 6 KPIs, filtros principais visíveis, export CSV no header.
- Billing: **BILL-002** — `GET /api/finance/billing/export` (CSV NF-e com filtros aplicados).
- Billing: **BILL-004** — erro visível no comparativo (`comparisonError` + retry).
- Billing: auditoria de cálculos (`financeBillingCalculationAudit`).

---

## 2. Endpoints e builders

### 2.1 Contas a Receber

| Endpoint | Builder | Fonte |
|----------|---------|-------|
| `GET /api/finance/accounts-receivable/dashboard` | `buildFinanceAccountsReceivableDashboard` | `NomusAccountsReceivable` |
| `GET /api/finance/accounts-receivable/titles` | `buildFinanceArTitlesPayload` | `NomusAccountsReceivable` |
| `GET /api/finance/accounts-receivable/export` | `buildFinanceArExportCsv` | `NomusAccountsReceivable` |

**Filtros aceitos:** `companyName`, `personName`, `personCnpj`, `status`, `year`, `month`, `dueDateFrom`, `dueDateTo`, `paymentMethodName`, `bankAccountName`, `invoiceIssued`.

**Titles extras:** `page`, `limit`, `sortBy`, `sortDirection`, `search`, `overdueOnly`, `qualityAlert`.

**Estratégia de carga:** `buildFinanceArPrismaWhere` + `findMany` → `filterFinanceArRows` em memória (paridade).

### 2.2 Contas a Pagar

| Endpoint | Builder | Fonte |
|----------|---------|-------|
| `GET /api/finance/accounts-payable/dashboard` | `buildFinanceAccountsPayableDashboard` | `NomusAccountsPayable` |
| `GET /api/finance/accounts-payable/titles` | `buildFinanceApTitlesPayload` | `NomusAccountsPayable` |
| `GET /api/finance/accounts-payable/export` | `buildFinanceApExportCsv` | `NomusAccountsPayable` |

**Filtros aceitos:** mesmos de AR + `documentQuery`/`documentNumber`, `suspendPayment`, `period=all`.

**Estratégia de carga:** Prisma `where` parcial + `filterFinanceApRows` em memória.

**Default:** ano corrente injetado se nenhum período informado (UI e backend).

### 2.3 Faturamento

| Endpoint | Builder | Fonte |
|----------|---------|-------|
| `GET /api/finance/billing/dashboard` | `buildFinanceBillingDashboard` → `buildBillingDashboardTab` | `SalesOrder` |
| `GET /api/finance/billing/nfes` | `buildFinanceBillingNfeList` | `NomusNfe` |
| `GET /api/finance/billing/comparison` | `buildFinanceBillingNfeComparison` | `SalesOrder` + `NomusNfe` |
| `GET /api/finance/billing/export` | `buildFinanceBillingNfeExportCsv` | `NomusNfe` |
| `GET/POST` sync NF-e | `nomusNfesSync` | Global |

**Dashboard filtros:** `year` apenas.

**NF-e filtros:** `year`, `month`, `customerCnpj`, `documentNumber`, `classification`, `status`, `limit`.

**Export CSV:** listagem NF-e com filtros NF-e aplicados (`FINANCE_BILLING_NFE_EXPORT_SCOPE`).

---

## 3. Matriz de métricas — Contas a Receber

| Métrica (UI) | Campo payload | Fonte | Fórmula | Filtros | Exceção |
|--------------|---------------|-------|---------|---------|---------|
| Títulos em Aberto | `cards.totalOpenAmount` | NomusAR | Σ `balanceReceivable` onde > 0 | Todos | — |
| Recebido no Mês | `cards.receivedThisMonthAmount` | NomusAR | Σ `amountReceived` com `settlementDate` no mês corrente | Todos | **Rotulado:** `FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE` |
| % Inadimplência | `cards.delinquencyRate` | NomusAR | overdue ÷ open × 100 | Todos | — |
| Vencido > 30 Dias | `cards.overdueOver30DaysAmount` | NomusAR | Σ saldo open com aging > 30d | Todos | — |
| Aging (8 faixas) | `agingBuckets` | NomusAR | Agrupa open por dias de atraso | Todos | Sem `dueDate` excluído |
| Top devedores | `topDebtors` | NomusAR | Top 10 por saldo open | Todos | Limite 10 |
| Ranking clientes | `customerRanking` | NomusAR | Todos clientes por saldo | Todos | Sem limite |
| Action Center | derivado | NomusAR | Regras sobre `criticalTitles` + quality | Todos | — |
| Títulos Críticos | `criticalTitles` | NomusAR | Top 20 overdue | Todos | Limite 20 |
| Agenda / cronograma | `scheduleBuckets`, `monthlyDueSchedule` | NomusAR | Agrupa por vencimento | Todos | — |
| Qualidade de dados | `dataQualitySummary` | NomusAR | 9 regras de anomalia | Todos | — |
| Última sync (header) | `cards.lastSyncAt` | NomusAR | MAX `syncedAt` nas linhas filtradas | Filtrado | **Rotulado:** `FINANCE_AR_LAST_SYNC_FILTERED_SCOPE` |
| Export CSV | arquivo | NomusAR | Mesmas linhas filtradas | `appliedFilters` | `format=csv` ignorado no backend |

**Frontend:** `FinanceAccountsReceivablePage.tsx` — `draftFilters` / `appliedFilters`; banner `FinanceFilterScopeBanner`.

---

## 4. Matriz de métricas — Contas a Pagar

Espelha AR com diferenças:

| Métrica | Campo | Diferença vs AR |
|---------|-------|-----------------|
| Obrigações em Aberto | `totalOpenAmount` | `balancePayable` |
| Pago no Mês | `paidThisMonthAmount` | `paymentDate ?? settlementDate` |
| % em Atraso | `overduePercent` | Nome diferente de `delinquencyRate` |
| Top fornecedores | `topSuppliers` | Limite 10 |
| Ranking | `supplierRanking` | Limite 100 |
| Empresas | `companySummary` | Limite 50 |
| Total a pagar | `totalPayableAmount` | Inclui liquidados (Σ `amountPayable`) |

**Frontend:** `FinanceAccountsPayablePage.tsx` — resumo executivo 6 KPIs, filtros principais (ano, mês, status, fornecedor, CNPJ), avançados colapsáveis, chips, banner de escopo.

**Exceções rotuladas AP:**
- `FINANCE_AP_PAID_THIS_MONTH_SCOPE` — pago no mês (calendário atual)
- `FINANCE_AP_DEFAULT_YEAR_SCOPE` — ano corrente injetado por padrão
- `FINANCE_AP_LAST_SYNC_FILTERED_SCOPE` — última sync entre filtrados

---

## 5. Matriz de métricas — Faturamento

### 5.1 Painel executivo (SalesOrder — fonte oficial)

| Métrica (UI) | Campo | Fórmula | Filtros | Exceção |
|--------------|-------|---------|---------|---------|
| Faturamento {ano} | `multiYearSummary.yearTotal` | Σ mensal 12 meses | Ano | Meses futuros = 0 no total anual |
| Faturamento mês atual | `target.actual` | SUM mês de referência | Ano | Histórico = dezembro |
| Meta (+30%) | `target.target` | mês anterior × 1,3 | Ano | — |
| % Atingimento | `target.achievementPercent` | actual/target × 100 | Ano | null se inválido |
| Acumulado YTD | `multiYearSummary.ytdTotal` | Σ até `ytdMonthLimit` | Ano | **YTD — não filtra mês NF-e** |
| Multi-ano chart | `multiYearMonthly` | 3 anos de séries | Ano âncora | **Multi-ano — não filtra cliente** |
| Projeção | `projection.*` | média diária YTD × dias úteis | Ano | **Projeção — não NF-e** |
| Top clientes | `topCustomers` | GROUP BY customer, ano inteiro | Ano | — |
| Faturamentos recentes | `recentInvoicedOrders` | Últimos 15 pedidos globalmente | **Nenhum** | **Rotulado: global** |

**Valor:** `SalesOrder.totalNetValue`  
**Data faturamento:** MAX `nfes[].dataProcessamento` do `nomusRawResponse`  
**Exclusão:** clientes intercompany (Lazarios, Koppetel, SM)

### 5.2 Diagnóstico NF-e (NomusNfe)

| Métrica | Fonte | Filtros |
|---------|-------|---------|
| Listagem NF-e | `NomusNfe` | Ano, mês, CNPJ, NF, classificação, status |
| Comparativo mensal | SO vs NomusNfe | Ano apenas |

**Divergências documentadas (não maquiadas):**
- Data SO: `dataProcessamento`; NomusNfe: `COALESCE(xmlDhEmi, dataProcessamento)`
- Mercado SO: SQL customer; NomusNfe: flag `isMarketSale`
- Comparativo pode mostrar divergência > 10% com ícone vermelho

---

## 6. Exceções documentadas (rótulos UI)

| Constante | Texto | Onde |
|-----------|-------|------|
| `FINANCE_FILTER_APPLIED_SCOPE` | Indicadores refletem filtros aplicados | Banner AR/AP |
| `FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE` | Painel executivo — ano selecionado | Billing filtros/overview |
| `FINANCE_BILLING_YTD_SCOPE` | YTD — ano sim, não mês NF-e | Acumulado, Projeção |
| `FINANCE_BILLING_MULTI_YEAR_SCOPE` | Comparativo histórico multi-ano | Overview, Acumulado, Mensal |
| `FINANCE_BILLING_PROJECTION_SCOPE` | Projeção anual | Aba Projeção |
| `FINANCE_BILLING_COMPARISON_SCOPE` | Comparativo diagnóstico — só ano | Comparison panel |
| `FINANCE_BILLING_NFE_LIST_SCOPE` | Listagem NF-e filtrada | NF-e details |
| `FINANCE_BILLING_RECENT_ORDERS_SCOPE` | Recentes — global | Overview |
| `FINANCE_SYNC_GLOBAL_SCOPE` | Sync global | Billing sync panel |
| `FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE` | Recebido no mês — calendário atual | KPI AR |
| `FINANCE_AR_LAST_SYNC_FILTERED_SCOPE` | Última sync entre filtrados | Header AR |
| `FINANCE_AR_PORTFOLIO_IMMEDIATE_SCOPE` | Portfolio NF imediato | Constante (UI pendente) |
| `FINANCE_AP_PAID_THIS_MONTH_SCOPE` | Pago no mês — calendário atual | KPI AP |
| `FINANCE_AP_DEFAULT_YEAR_SCOPE` | Ano corrente padrão | Header/filtros AP |
| `FINANCE_AP_LAST_SYNC_FILTERED_SCOPE` | Última sync entre filtrados | Header AP |
| `FINANCE_BILLING_NFE_EXPORT_SCOPE` | Export CSV NF-e filtrado | Header Billing |

---

## 7. Problemas encontrados

### Críticos / comportamentais

| # | Problema | Tela | Status |
|---|----------|------|--------|
| 1 | AR carrega tabela inteira sem Prisma where | AR | **Corrigido** — `buildFinanceArPrismaWhere` |
| 2 | `receivedThisMonth`/`paidThisMonth` usam mês calendário atual | AR/AP | **Rotulado** em AR (`FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE`) |
| 3 | `lastSyncAt` no header = max das linhas filtradas | AR/AP | **Rotulado** em AR |
| 4 | Faturamentos recentes ignoram ano | Billing | **Rotulado** |
| 5 | Sem export CSV em Faturamento | Billing | **Corrigido** — `GET /api/finance/billing/export` |
| 6 | Erros de comparison engolidos silenciosamente | Billing | **Corrigido** — `comparisonError` + retry na UI |
| 7 | Divergência SO vs NomusNfe (data + mercado) | Billing | Documentado no comparativo |

### Corrigidos nesta auditoria

| # | Correção |
|---|----------|
| C1 | Label AP `paidGreaterThanPayable` |
| C2 | Rótulo faturamentos recentes |
| C3 | Testes export com `format=csv` |
| C4 | Teste classification NF-e (`market` vs `MARKET_REVENUE`) |
| C5 | AR: Prisma pre-filter + auditoria de cálculos (`financeAccountsReceivableCalculationAudit`) |
| C6 | AR: UX BI executivo — resumo 6 KPIs, filtros principais visíveis |
| C7 | AP: UX BI executivo + auditoria de cálculos |
| C8 | Billing: UX BI executivo + export CSV + erro comparativo visível |
| C9 | Rótulos AP (`FINANCE_AP_*`) e export (`FINANCE_BILLING_NFE_EXPORT_SCOPE`) |

---

## 8. Validação de filtros (frontend)

| Componente | AR | AP | Billing |
|------------|----|----|---------|
| KPI cards | `appliedFilters` | `appliedFilters` | `appliedYear` |
| Gráficos | payload filtrado | payload filtrado | payload por ano |
| Aging/rankings | payload filtrado | payload filtrado | N/A |
| Action center | payload filtrado | payload filtrado | N/A |
| Títulos críticos | payload filtrado | payload filtrado | N/A |
| Abas detalhadas | payload + `appliedFilters` | payload + `appliedFilters` | NF-e: `appliedNfeFilters` |
| Export CSV | `appliedFilters` | `appliedFilters` | `appliedNfeFilters` |
| Formulário filtros | `draftFilters` | `draftFilters` | `draftYear` + `draftNfeFilters` |

---

## 9. Testes executados

```
npm run test:finance:accounts-receivable
npm run test:finance:accounts-payable
npm run test:finance:billing
npm run test:finance:billing-nfes
npm run test:finance:navigation
npm run lint
npm run build
```

**Novos/atualizados:**
- `src/lib/financeDashboardConsistencyAudit.test.ts`
- `src/lib/financeFilterCompliance.test.ts` (export + classification)
- `src/lib/financeAccountsReceivablePageFilters.test.ts`
- `src/lib/financeAccountsReceivableCalculationAudit.test.ts`
- `src/lib/financeAccountsPayablePageFilters.test.ts`
- `src/lib/financeAccountsPayableCalculationAudit.test.ts`
- `src/lib/financeBillingPageFilters.test.ts`
- `src/lib/financeBillingCalculationAudit.test.ts`
- `src/lib/financeBillingNfeExport.test.ts`

**Cobertura mínima validada:**
- Filtro mês → cards, aging, ranking, críticos
- Filtro cliente/fornecedor → ranking + export
- Filtro status → cards
- Filtro CNPJ/empresa → cards
- Export com filtros aplicados + `format=csv`
- YTD e recentes rotulados
- Meses futuros = `null` (não zero falso)
- Ausência NaN/Infinity em métricas AR/AP

---

## 10. Recomendações pendentes

1. ~~**AR:** adicionar Prisma pre-filter~~ — implementado; monitorar escala em produção.
2. ~~**Billing:** implementar export CSV com filtros NF-e~~ — implementado.
3. **Billing:** rotular `receivedThisMonth` equivalente se adicionado; manter recent orders label.
4. **AR/AP:** exibir `FINANCE_SYNC_GLOBAL_SCOPE` no painel de sync.
5. **AR:** rotular portfolio NF com `FINANCE_AR_PORTFOLIO_IMMEDIATE_SCOPE`.
6. ~~**Billing:** exibir erro quando comparison falha~~ — implementado.
7. **Billing:** alinhar parsers de ano (executive 2020…current+1 vs 2000–2100).
8. **Unificar:** `lastSyncAt` global vs filtrado — decidir e documentar.
9. **Migrar fonte oficial** para NomusNfe somente após validação completa do comparativo.
10. **AP:** Prisma pre-filter (espelhar AR) se escala exigir.

---

*Gerado automaticamente pela auditoria de consistência financeira — IndusCost.*
