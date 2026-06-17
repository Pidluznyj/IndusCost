import React, { useMemo } from "react";
import type { FinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildArOverduePrintFilterLines,
  FINANCE_AR_OVERDUE_PRINT_FOOTER_NOTE,
  FINANCE_AR_OVERDUE_PRINT_SUBTITLE,
  FINANCE_AR_OVERDUE_PRINT_TITLE,
  FINANCE_AR_OVERDUE_PRINT_TOP_CUSTOMERS,
  formatArOverduePrintPeriod,
  formatArOverduePrintScope,
  groupArOverdueTitlesByCustomer,
  truncateArOverduePrintText,
} from "@/src/lib/financeAccountsReceivableOverduePrintMeta";
import type {
  FinanceArOverduePayload,
  FinanceArOverdueUiFilters,
} from "@/src/lib/financeAccountsReceivableOverdueTypes";

export function FinanceAccountsReceivableOverduePrintDocument({
  payload,
  globalFilters,
  overdueFilters,
  emitterName,
}: {
  payload: FinanceArOverduePayload;
  globalFilters: FinanceArUiFilters;
  overdueFilters: FinanceArOverdueUiFilters;
  emitterName?: string | null;
}) {
  const { summary } = payload;
  const periodLabel = formatArOverduePrintPeriod(globalFilters);
  const scopeLabel = formatArOverduePrintScope(globalFilters);
  const filterLines = buildArOverduePrintFilterLines(globalFilters, overdueFilters);
  const priorityCustomers = payload.customerRanking.slice(0, FINANCE_AR_OVERDUE_PRINT_TOP_CUSTOMERS);
  const customerGroups = useMemo(
    () => groupArOverdueTitlesByCustomer(payload.overdueTitles),
    [payload.overdueTitles]
  );

  return (
    <div id="ar-overdue-print-root">
      <div className="finance-ar-overdue-print-document">
        <header className="finance-ar-overdue-print-doc-header">
          <div className="finance-ar-overdue-print-brand">
            <span className="finance-ar-overdue-print-brand-main">IndusCost</span>
            <span className="finance-ar-overdue-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-ar-overdue-print-doc-title">{FINANCE_AR_OVERDUE_PRINT_TITLE}</h1>
          <p className="finance-ar-overdue-print-doc-subtitle">{FINANCE_AR_OVERDUE_PRINT_SUBTITLE}</p>
          <table className="finance-ar-overdue-print-meta-table">
            <tbody>
              <tr>
                <th>Emitido em</th>
                <td>{formatFinanceDateTime(payload.generatedAt)}</td>
                <th>Emitido por</th>
                <td>{emitterName?.trim() || "—"}</td>
              </tr>
              <tr>
                <th>Período analisado</th>
                <td>{periodLabel}</td>
                <th>Referência de atraso</th>
                <td>{formatFinanceDate(payload.referenceDate)}</td>
              </tr>
              <tr>
                <th>Origem</th>
                <td>Contas a Receber Nomus</td>
                <th>Escopo</th>
                <td>{scopeLabel}</td>
              </tr>
              {filterLines.length > 0 ? (
                <tr>
                  <th>Filtros aplicados</th>
                  <td colSpan={3}>{filterLines.join(" · ")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </header>

        <section className="finance-ar-overdue-print-section">
          <h2 className="finance-ar-overdue-print-section-title">Resumo executivo</h2>
          <table className="finance-ar-overdue-print-kpi-table">
            <tbody>
              <tr>
                <th>Total vencido</th>
                <td>{formatFinanceCurrency(summary.totalOverdueAmount)}</td>
                <th>Títulos vencidos</th>
                <td>{formatFinanceInteger(summary.overdueTitlesCount)}</td>
                <th>Clientes em atraso</th>
                <td>{formatFinanceInteger(summary.overdueCustomersCount)}</td>
              </tr>
              <tr>
                <th>Média de atraso</th>
                <td>
                  {summary.averageDaysOverdue != null
                    ? `${formatFinanceInteger(summary.averageDaysOverdue)} dias`
                    : "—"}
                </td>
                <th>Maior atraso</th>
                <td>
                  {summary.maxDaysOverdue != null
                    ? `${formatFinanceInteger(summary.maxDaysOverdue)} dias`
                    : "—"}
                </td>
                <th>Maior cliente devedor</th>
                <td>
                  {summary.topOverdueCustomer
                    ? `${summary.topOverdueCustomer.name} (${formatFinanceCurrency(summary.topOverdueCustomer.amount)})`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="finance-ar-overdue-print-section">
          <h2 className="finance-ar-overdue-print-section-title">Aging de atraso</h2>
          <table className="finance-ar-overdue-print-data-table">
            <thead>
              <tr>
                <th>Faixa</th>
                <th className="col-num">Qtde.</th>
                <th className="col-money">Valor</th>
                <th className="col-num">%</th>
              </tr>
            </thead>
            <tbody>
              {payload.agingBuckets.map((row) => (
                <tr key={row.key}>
                  <td>{row.bucket}</td>
                  <td className="col-num">{row.titlesCount}</td>
                  <td className="col-money">{formatFinanceCurrency(row.amount)}</td>
                  <td className="col-num">{formatFinancePercent(row.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="finance-ar-overdue-print-section">
          <h2 className="finance-ar-overdue-print-section-title">
            Clientes prioritários para cobrança
          </h2>
          <table className="finance-ar-overdue-print-data-table">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Cliente</th>
                <th>CNPJ</th>
                <th className="col-num">Títulos</th>
                <th className="col-money">Valor vencido</th>
                <th className="col-num">Maior atraso</th>
                <th className="col-num">% total</th>
              </tr>
            </thead>
            <tbody>
              {priorityCustomers.map((row) => (
                <tr key={`${row.rank}-${row.customerName}`}>
                  <td className="col-num">{row.rank}</td>
                  <td>{displayFinanceText(row.customerName)}</td>
                  <td>{displayFinanceText(row.customerDocument)}</td>
                  <td className="col-num">{row.titlesCount}</td>
                  <td className="col-money">{formatFinanceCurrency(row.overdueAmount)}</td>
                  <td className="col-num">{formatFinanceInteger(row.maxDaysOverdue)} d</td>
                  <td className="col-num">{formatFinancePercent(row.percentOfTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="finance-ar-overdue-print-section">
          <h2 className="finance-ar-overdue-print-section-title">Detalhamento dos títulos vencidos</h2>
          {payload.overdueTitles.length === 0 ? (
            <p className="finance-ar-overdue-print-empty">
              Nenhum título vencido em aberto para os filtros selecionados.
            </p>
          ) : (
            customerGroups.map((group) => (
              <div key={group.customerKey} className="finance-ar-overdue-print-customer-group">
                <div className="finance-ar-overdue-print-group-header">
                  Cliente: {displayFinanceText(group.customerName)} | CNPJ:{" "}
                  {displayFinanceText(group.customerDocument)} | Total vencido:{" "}
                  {formatFinanceCurrency(group.totalOverdue)} | Títulos: {group.titlesCount} | Maior
                  atraso: {formatFinanceInteger(group.maxDaysOverdue)} dias
                </div>
                <table className="finance-ar-overdue-print-detail-table">
                  <colgroup>
                    <col className="col-doc" />
                    <col className="col-nf" />
                    <col className="col-pay" />
                    <col className="col-due" />
                    <col className="col-days" />
                    <col className="col-aging" />
                    <col className="col-amt" />
                    <col className="col-amt" />
                    <col className="col-amt" />
                    <col className="col-company" />
                    <col className="col-obs" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Título</th>
                      <th>NF</th>
                      <th>Forma pgto.</th>
                      <th className="col-date">Vencimento</th>
                      <th className="col-num">Dias</th>
                      <th>Aging</th>
                      <th className="col-money">Valor original</th>
                      <th className="col-money">Valor recebido</th>
                      <th className="col-money">Saldo em aberto</th>
                      <th>Empresa</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.titles.map((row) => (
                      <tr key={row.id}>
                        <td>{displayFinanceText(row.documentNumber)}</td>
                        <td>{displayFinanceText(row.nfeNumber)}</td>
                        <td>{displayFinanceText(row.paymentMethodName)}</td>
                        <td className="col-date">{formatFinanceDate(row.dueDate)}</td>
                        <td className="col-num">{formatFinanceInteger(row.daysOverdue)}</td>
                        <td>{row.agingLabel}</td>
                        <td className="col-money">{formatFinanceCurrency(row.amountReceivable)}</td>
                        <td className="col-money">{formatFinanceCurrency(row.amountReceived)}</td>
                        <td className="col-money">{formatFinanceCurrency(row.balanceReceivable)}</td>
                        <td>{displayFinanceText(row.companyName)}</td>
                        <td>{truncateArOverduePrintText(row.description, 60)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </section>

        <footer className="finance-ar-overdue-print-doc-footer">
          <p>Relatório gerado pelo IndusCost · {formatFinanceDateTime(payload.generatedAt)}</p>
          <p className="finance-ar-overdue-print-footer-note">{FINANCE_AR_OVERDUE_PRINT_FOOTER_NOTE}</p>
        </footer>
      </div>
    </div>
  );
}
