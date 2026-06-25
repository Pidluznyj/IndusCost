import React from "react";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
  resolveFinanceLaunchDescription,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_AR_HORIZON_EXPORT_TITLE } from "@/src/lib/financeAccountsReceivableHorizonExportXlsx";
import type { FinanceArHorizonExportPayload } from "@/src/lib/financeAccountsReceivableHorizonExport";

export function FinanceArHorizonPrintDocument({ payload }: { payload: FinanceArHorizonExportPayload }) {
  const bucketLabel =
    payload.scope === "full" ? "Todas as faixas" : (payload.bucket?.label ?? "—");

  return (
    <div id="ar-horizon-print-root">
      <div className="finance-ar-horizon-print-document">
        <header className="finance-ar-horizon-print-doc-header">
          <div className="finance-ar-horizon-print-brand">
            <span className="finance-ar-horizon-print-brand-main">IndusCost</span>
            <span className="finance-ar-horizon-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-ar-horizon-print-doc-title">{FINANCE_AR_HORIZON_EXPORT_TITLE}</h1>
          <table className="finance-ar-horizon-print-meta-table">
            <tbody>
              <tr>
                <th>Faixa</th>
                <td>{bucketLabel}</td>
                <th>Data-base operacional</th>
                <td>{formatFinanceDate(payload.operationalBaseDate)}</td>
              </tr>
              <tr>
                <th>Emitido em</th>
                <td>{formatFinanceDateTime(payload.generatedAt)}</td>
                <th>Emitido por</th>
                <td>{displayFinanceText(payload.userName)}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="finance-ar-horizon-print-section">
          <h2 className="finance-ar-horizon-print-section-title">Resumo</h2>
          <table className="finance-ar-horizon-print-kpi-table">
            <tbody>
              <tr>
                <th>Total da faixa</th>
                <td>{formatFinanceCurrency(payload.summary.totalOpenBalance)}</td>
                <th>Títulos</th>
                <td>{formatFinanceInteger(payload.summary.titlesCount)}</td>
                <th>Ticket médio</th>
                <td>{formatFinanceCurrency(payload.summary.averageTicket)}</td>
              </tr>
              <tr>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(payload.summary.overdueAmount)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(payload.summary.upcomingAmount)}</td>
                <th>Maior cliente</th>
                <td>{displayFinanceText(payload.summary.topCustomerName)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {payload.scope === "full" ? (
          <section className="finance-ar-horizon-print-section">
            <h2 className="finance-ar-horizon-print-section-title">Resumo por faixa</h2>
            <table className="finance-ar-horizon-print-data-table">
              <thead>
                <tr>
                  <th>Faixa</th>
                  <th className="col-num">Títulos</th>
                  <th className="col-money">Valor</th>
                </tr>
              </thead>
              <tbody>
                {payload.bucketSummaries.map((bucket) => (
                  <tr key={bucket.key}>
                    <td>{bucket.label}</td>
                    <td className="col-num">{formatFinanceInteger(bucket.titlesCount)}</td>
                    <td className="col-money">{formatFinanceCurrency(bucket.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {payload.appliedFilters.length > 0 ? (
          <section className="finance-ar-horizon-print-section">
            <h2 className="finance-ar-horizon-print-section-title">Filtros aplicados</h2>
            <table className="finance-ar-horizon-print-filter-table">
              <tbody>
                {payload.appliedFilters.map((line) => (
                  <tr key={line.label}>
                    <th>{line.label}</th>
                    <td>{line.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="finance-ar-horizon-print-section">
          <h2 className="finance-ar-horizon-print-section-title">Títulos</h2>
          {payload.items.length === 0 ? (
            <p className="finance-ar-horizon-print-empty">Nenhum título encontrado para esta faixa.</p>
          ) : (
            <table className="finance-ar-horizon-print-data-table">
              <thead>
                <tr>
                  {payload.scope === "full" ? <th>Faixa</th> : null}
                  <th>Cliente</th>
                  <th>Documento</th>
                  <th>Vencimento</th>
                  <th className="col-num">Dias</th>
                  <th className="col-money">Valor a receber</th>
                  <th className="col-money">Saldo</th>
                  <th>Status</th>
                  <th>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((row) => (
                  <tr key={`${row.externalId}-${row.bucketLabel ?? ""}`}>
                    {payload.scope === "full" ? (
                      <td>{displayFinanceText(row.bucketLabel)}</td>
                    ) : null}
                    <td>{displayFinanceText(row.personName)}</td>
                    <td>{displayFinanceText(row.sourceInvoiceNumber ?? row.personCnpj)}</td>
                    <td>{formatFinanceDate(row.dueDate)}</td>
                    <td className="col-num">{formatFinanceInteger(row.daysOverdue)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amountReceivable)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.balanceReceivable)}</td>
                    <td>{formatFinanceCalculatedStatus(row.calculatedStatus)}</td>
                    <td>{displayFinanceText(resolveFinanceLaunchDescription({ description: row.description }))}</td>
                  </tr>
                ))}
                <tr className="finance-ar-horizon-print-total-row">
                  <td colSpan={payload.scope === "full" ? 5 : 4}>
                    Total ({formatFinanceInteger(payload.summary.titlesCount)} título(s))
                  </td>
                  <td className="col-money">{formatFinanceCurrency(payload.summary.totalOpenBalance)}</td>
                  <td className="col-money">{formatFinanceCurrency(payload.summary.totalOpenBalance)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <footer className="finance-ar-horizon-print-doc-footer">
          <p>Relatório gerado pelo IndusCost · {formatFinanceDateTime(payload.generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
