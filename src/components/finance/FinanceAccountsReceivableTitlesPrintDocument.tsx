import React from "react";
import { FinanceAccountsReceivableTitlesPrintCover } from "@/src/components/finance/FinanceAccountsReceivableTitlesPrintCover";
import type { FinanceArAnalyticalUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildFinanceArTitlesPrintFilterLines,
  FINANCE_AR_TITLES_PRINT_FOOTER_NOTE,
  FINANCE_AR_TITLES_PRINT_SUBTITLE,
  FINANCE_AR_TITLES_PRINT_TITLE,
} from "@/src/lib/financeArTitlesPrintMeta";
import type { FinanceArTitleListItem, FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";
import { safeTrim } from "@/src/lib/safeTrim";

export function FinanceAccountsReceivableTitlesPrintDocument({
  payload,
  filters,
  allItems,
  generatedAt,
  emitterName,
}: {
  payload: FinanceArTitlesPayload;
  filters: FinanceArAnalyticalUiFilters;
  allItems: FinanceArTitleListItem[];
  generatedAt: string;
  emitterName?: string | null;
}) {
  const { summary } = payload;
  const filterLines = buildFinanceArTitlesPrintFilterLines(filters);

  return (
    <div id="ar-titles-print-root">
      <FinanceAccountsReceivableTitlesPrintCover
        payload={payload}
        filters={filters}
        generatedAt={generatedAt}
        emitterName={emitterName}
        titlesCount={allItems.length}
      />

      <div className="finance-ar-titles-print-document">
        <header className="finance-ar-titles-print-doc-header">
          <div className="finance-ar-titles-print-brand">
            <span className="finance-ar-titles-print-brand-main">IndusCost</span>
            <span className="finance-ar-titles-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-ar-titles-print-doc-title">{FINANCE_AR_TITLES_PRINT_TITLE}</h1>
          <p className="finance-ar-titles-print-doc-subtitle">{FINANCE_AR_TITLES_PRINT_SUBTITLE}</p>
          <table className="finance-ar-titles-print-meta-table">
            <tbody>
              <tr>
                <th>Emitido em</th>
                <td>{formatFinanceDateTime(generatedAt)}</td>
                <th>Emitido por</th>
                <td>{safeTrim(emitterName) || "—"}</td>
              </tr>
              <tr>
                <th>Títulos</th>
                <td>{formatFinanceInteger(allItems.length)}</td>
                <th>Origem</th>
                <td>Contas a Receber Nomus</td>
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

        <section className="finance-ar-titles-print-section">
          <h2 className="finance-ar-titles-print-section-title">Resumo executivo</h2>
          <table className="finance-ar-titles-print-kpi-table">
            <tbody>
              <tr>
                <th>Títulos</th>
                <td>{formatFinanceInteger(summary.totalTitles)}</td>
                <th>Valor original</th>
                <td>{formatFinanceCurrency(summary.totalOriginalValue)}</td>
                <th>Valor recebido</th>
                <td>{formatFinanceCurrency(summary.totalReceivedValue)}</td>
              </tr>
              <tr>
                <th>Em aberto</th>
                <td>{formatFinanceCurrency(summary.totalOpenValue)}</td>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(summary.totalOverdueValue)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(summary.totalDueValue)}</td>
              </tr>
              <tr>
                <th>Ticket médio</th>
                <td colSpan={5}>{formatFinanceCurrency(summary.averageTicket)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="finance-ar-titles-print-section">
          <h2 className="finance-ar-titles-print-section-title">
            Detalhamento analítico ({formatFinanceInteger(allItems.length)})
          </h2>
          {allItems.length === 0 ? (
            <p className="finance-ar-titles-print-empty">
              Nenhum título encontrado para os filtros selecionados.
            </p>
          ) : (
            <table className="finance-ar-titles-print-data-table">
              <thead>
                <tr>
                  <th className="col-client">Cliente</th>
                  <th className="col-company">Empresa</th>
                  <th className="col-doc">Documento</th>
                  <th className="col-date">Emissão</th>
                  <th className="col-date">Vencimento</th>
                  <th className="col-date">Recebimento</th>
                  <th className="col-status">Status</th>
                  <th className="col-num">Dias</th>
                  <th className="col-money">Original</th>
                  <th className="col-money">Recebido</th>
                  <th className="col-money">Aberto</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((row) => (
                  <tr key={row.externalId}>
                    <td className="col-client">{displayFinanceText(row.personName)}</td>
                    <td className="col-company">{displayFinanceText(row.companyName)}</td>
                    <td className="col-doc">
                      {displayFinanceText(
                        row.sourceInvoiceNumber ??
                          (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null)
                      )}
                    </td>
                    <td className="col-date">{formatFinanceDate(row.competenceDate)}</td>
                    <td className="col-date">{formatFinanceDate(row.dueDate)}</td>
                    <td className="col-date">{formatFinanceDate(row.settlementDate)}</td>
                    <td className="col-status">{formatFinanceCalculatedStatus(row.calculatedStatus)}</td>
                    <td className="col-num">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amountReceivable)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amountReceived)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.balanceReceivable)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>Total</td>
                  <td className="col-money">{formatFinanceCurrency(summary.totalOriginalValue)}</td>
                  <td className="col-money">{formatFinanceCurrency(summary.totalReceivedValue)}</td>
                  <td className="col-money">{formatFinanceCurrency(summary.totalOpenValue)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <footer className="finance-ar-titles-print-footer">
          {FINANCE_AR_TITLES_PRINT_FOOTER_NOTE} · {formatFinanceDateTime(generatedAt)}
        </footer>
      </div>
    </div>
  );
}
