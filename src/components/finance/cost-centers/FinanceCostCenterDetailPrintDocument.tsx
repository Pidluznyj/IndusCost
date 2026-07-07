import React from "react";
import type { CostCenterDetailExportPayload } from "@/src/lib/financeCostCenterDetailShared";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_CC_DETAIL_EXPORT_TITLE } from "@/src/lib/financeCostCenterDetailExportMeta";

function sourceLabel(source: string): string {
  switch (source) {
    case "AUTO_RULE":
      return "Auto";
    case "BATCH":
      return "Batch";
    case "MANUAL":
      return "Manual";
    default:
      return source;
  }
}

export function FinanceCostCenterDetailPrintDocument({
  payload,
}: {
  payload: CostCenterDetailExportPayload;
}) {
  const { summary, center } = payload;
  const isConsolidated = payload.consolidated === true;
  const selectedCenters =
    payload.selectedCenterNames?.join(", ") ??
    (center.parentName && isConsolidated ? center.parentName : "");

  return (
    <div id="cc-detail-print-root">
      <div className="finance-cc-detail-print-document">
        <header className="finance-cc-detail-print-doc-header">
          <div className="finance-cc-detail-print-brand">
            <span className="finance-cc-detail-print-brand-main">IndusCost</span>
            <span className="finance-cc-detail-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-cc-detail-print-doc-title">
            {isConsolidated ? `${FINANCE_CC_DETAIL_EXPORT_TITLE} — Centros selecionados` : FINANCE_CC_DETAIL_EXPORT_TITLE}
          </h1>
          <table className="finance-cc-detail-print-meta-table">
            <tbody>
              <tr>
                <th>{isConsolidated ? "Escopo" : "Centro de custo"}</th>
                <td>{displayFinanceText(center.name)}</td>
                <th>Código</th>
                <td>{displayFinanceText(center.code)}</td>
              </tr>
              {isConsolidated && selectedCenters ? (
                <tr>
                  <th>Centros</th>
                  <td colSpan={3}>{displayFinanceText(selectedCenters)}</td>
                </tr>
              ) : (
                <tr>
                  <th>Pai</th>
                  <td>{displayFinanceText(center.parentName)}</td>
                  <th>Emitido em</th>
                  <td>{formatFinanceDateTime(payload.generatedAt)}</td>
                </tr>
              )}
              <tr>
                <th>Emitido por</th>
                <td colSpan={isConsolidated && selectedCenters ? 1 : 3}>
                  {displayFinanceText(payload.userName)}
                </td>
                {isConsolidated && selectedCenters ? (
                  <>
                    <th>Emitido em</th>
                    <td>{formatFinanceDateTime(payload.generatedAt)}</td>
                  </>
                ) : null}
              </tr>
            </tbody>
          </table>
        </header>

        <section className="finance-cc-detail-print-section">
          <h2 className="finance-cc-detail-print-section-title">Resumo</h2>
          <table className="finance-cc-detail-print-kpi-table">
            <tbody>
              <tr>
                <th>Total alocado</th>
                <td>{formatFinanceCurrency(payload.summary.totalAllocatedAmount)}</td>
                <th>Títulos</th>
                <td>{formatFinanceInteger(summary.titlesCount)}</td>
                <th>Pago/liquidado</th>
                <td>{formatFinanceCurrency(summary.paidAmount)}</td>
              </tr>
              <tr>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(summary.overdueAmount)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(summary.upcomingAmount)}</td>
                <th>Média por título</th>
                <td>{formatFinanceCurrency(summary.averageAllocatedPerTitle)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {payload.appliedFilters.length > 0 ? (
          <section className="finance-cc-detail-print-section">
            <h2 className="finance-cc-detail-print-section-title">Filtros aplicados</h2>
            <table className="finance-cc-detail-print-filter-table">
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

        <section className="finance-cc-detail-print-section">
          <h2 className="finance-cc-detail-print-section-title">Títulos alocados</h2>
          {payload.rows.length === 0 ? (
            <p className="finance-cc-detail-print-empty">
              Nenhum título encontrado para os filtros selecionados.
            </p>
          ) : (
            <table className="finance-cc-detail-print-data-table">
              <thead>
                <tr>
                  <th>AP</th>
                  {isConsolidated ? <th>Centro</th> : null}
                  <th>Empresa</th>
                  <th>Fornecedor</th>
                  <th>Classificação</th>
                  <th>Descrição</th>
                  <th>Documento</th>
                  <th>Vencimento</th>
                  <th>Pagamento</th>
                  <th>Status</th>
                  <th className="col-money">Valor</th>
                  <th className="col-money">Saldo</th>
                  <th className="col-money">Alocado</th>
                </tr>
              </thead>
              <tbody>
                {payload.rows.map((row) => (
                  <tr key={row.allocationId}>
                    <td>{row.accountsPayableId}</td>
                    {isConsolidated ? <td>{displayFinanceText(row.costCenterName)}</td> : null}
                    <td>{displayFinanceText(row.companyName)}</td>
                    <td>{displayFinanceText(row.supplierName ?? row.personName)}</td>
                    <td>{displayFinanceText(row.nomusClassification)}</td>
                    <td>{displayFinanceText(row.description)}</td>
                    <td>{displayFinanceText(row.documentNumber)}</td>
                    <td>{formatFinanceDate(row.dueDate)}</td>
                    <td>{formatFinanceDate(row.paymentDate ?? row.settlementDate)}</td>
                    <td>{displayFinanceText(row.statusLabel)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amountPayable)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.balancePayable)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.allocatedAmount)}</td>
                  </tr>
                ))}
                <tr className="finance-cc-detail-print-total-row">
                  <td colSpan={isConsolidated ? 10 : 9}>
                    Total ({formatFinanceInteger(payload.rows.length)} título(s))
                  </td>
                  <td className="col-money">{formatFinanceCurrency(payload.totals.amountPayable)}</td>
                  <td className="col-money">{formatFinanceCurrency(payload.totals.balancePayable)}</td>
                  <td className="col-money">{formatFinanceCurrency(payload.totals.allocatedAmount)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <footer className="finance-cc-detail-print-doc-footer">
          <p>Relatório gerado pelo IndusCost · {formatFinanceDateTime(payload.generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
