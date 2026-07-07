# Auditoria — Relatório Presidencial / Executivo Financeiro e Comercial

**Rota:** `/finance/executive-report` · **API:** `GET /api/finance/executive-report`

**Princípio:** o relatório **não recalcula** AR/AP/Fluxo/Faturamento/Pedidos — delega aos motores oficiais listados em `FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES` (`financeExecutiveReportTypes.ts`).

**Data da auditoria:** 2026-07-07

---

## Resumo executivo

| Status | Qtd |
|--------|-----|
| OK_USA_MOTOR_OFICIAL | 15 |
| PRECISA_VALIDACAO | 0 |
| NAO_APLICAVEL | 2 |

**Conclusão:** exclusão de grupo em Pedidos e filtro empresa em Pedidos/Faturamento aplicados nos motores oficiais. Indicadores financeiros críticos delegam aos motores com testes de paridade.

---

## Matriz por tema

### 1. Pedidos de Venda

| Indicador | Builder | Motor oficial | Status |
|-----------|---------|---------------|--------|
| Vendido mês / YTD / variação | `buildSalesOrdersDashboardTab` | `salesOrderRulesEngine` | OK |
| Gráfico mensal | `monthlySeries` do tab | Mesmo motor | OK |
| Status breakdown | `statusBreakdown` | `buildOfficialStatusBreakdownFromOrders` | OK |
| Exclusão grupo (cliente) | `applySalesOrderRulesUniverseFilters` | `isGroupCompanyCustomer` | OK |
| Filtro empresa | `buildSalesOrdersDashboardTab` + motor | `companyIssuer` | OK |

- **Não usa** `Proposal` nem `responsible` para KPIs.
- **Fonte:** `SalesOrder` / `SalesOrderItem` sincronizados do Nomus.

### 2. Faturamento

| Indicador | Builder | Motor oficial | Status |
|-----------|---------|---------------|--------|
| Faturado mês / YTD / comparativo | `buildFinanceBillingDashboard` | `buildBillingDashboardFromNfes` | OK |
| Filtro empresa NF-e | `cnpjEmitente` via `mapExecutiveReportCompanyToEmitterCnpj` | OK |
| Gráfico multi-ano | `multiYearMonthly` | `financeBillingNfeDashboard` | OK |
| Exclusão intercompany | `intercompanyExclusionApplied` | `billingMarketCustomerSql` / grupo | OK |

- **Não confunde** pedido com NF-e.
- `billingSource: nfe`, `dateBase: processamento` fixos no assembler.

### 3. Contas a Receber

| Indicador | Builder | Status |
|-----------|---------|--------|
| Aberto / vencido / aging | `buildOfficialAccountsReceivableDashboard` | OK |
| Recebido mês / YTD | `sumOfficialArReceivedBySettlementInPeriod` | OK |
| Gráfico anual | `buildCashFlowAnnualComparison` + filtros relatório | OK |

- `metricsSource: official-accounts-receivable-engine`
- Default `customerType: external` → exclui contraparte do grupo.

### 4. Contas a Pagar

| Indicador | Builder | Status |
|-----------|---------|--------|
| Aberto / vencido / horizonte | `buildOfficialAccountsPayableDashboard` | OK |
| Pago mês / YTD | `sumOfficialApPaidInPaymentPeriod` | OK |
| Carteira (sem mês) | `buildExecutiveReportApPortfolioFilters` | OK |

- Eixo operacional: **vencimento**; pagamento usa data de baixa.
- Card “Agendados” é informativo (auditoria PC).

### 5. Fluxo de Caixa

| Indicador | Builder | Status |
|-----------|---------|--------|
| Entradas / saídas / saldo período | `buildFinanceCashFlowDashboard` | OK |
| Gráfico Jan–Dez | Carga anual (`cashFlowAnnualFilters`) | OK |
| Timeline mensal | `executiveSummary.monthlyTimeline` | OK |
| Radar diário | `buildExecutiveReportCashRadarBlock` | OK |

- AP no fluxo: **dueDate** (`dateBase: due`).
- Setembro/2026 alinhado ao fix de vencimento (não agendamento).

### 6. Margem / Rentabilidade

**Não presente** no relatório presidencial atual — `NAO_APLICAVEL`. Sem cálculo paralelo oculto.

### 7. Centros de Custo

| Indicador | Builder | Status |
|-----------|---------|--------|
| Gastos por centro (top N) | `buildFinanceCostCenterDashboardDefault` | OK |

### 8. Empresas do grupo

- AR / AP / Fluxo: `financeInternalGroupExclusions.ts` (contraparte + intercompany AP).
- Faturamento NF-e: exclusão de mercado intercompany.
- Pedidos: **exclui clientes do grupo** via `isSalesOrderMarketCustomer` no motor oficial.

CNPJs excluídos: Lazarios `72.569.510/0001-95`, Koppetel `14.055.501/0001-80`, SM `55.717.719/0001-30`.

---

## Scripts de validação

```bash
# Matriz + paridade AR/AP/Fluxo (requer DB)
npx tsx scripts/audit-executive-report-presidential.ts --year=2026 --month=6 --asOfDate=2026-06-26

# AR/AP KPIs vs telas
npx tsx scripts/audit-executive-report-financial-sources.ts --year=2026 --month=6 --asOfDate=2026-06-26

# Pedidos vs motor/listagem/gestão
npx tsx scripts/audit-sales-order-rules-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
```

## Testes automatizados

- `financeExecutiveReportConsistency.test.ts` — paridade AR/AP/Fluxo
- `financeExecutiveReportDataSources.test.ts` — KPIs oficiais
- `financeExecutiveReportCashFlowChart.test.ts` — gráfico anual 12 meses
- `financeExecutiveReportPresidentialAudit.test.ts` — matriz estática

---

## Histórico de correções (já em produção)

Ver `docs/executive-report-ar-ap-data-audit.md` e `docs/executive-report-payables-data-audit.md`:
- Recebido/Pago mês/YTD passaram a usar motores AR/AP oficiais (não `buildCashFlowAnnualComparison` isolado).
- Carteira AP do relatório deixou de filtrar por `month` indevidamente.
