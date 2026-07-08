import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { FinanceArTitlesPrintBrand } from "@/src/components/finance/FinanceArTitlesPrintBrand";
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
  FINANCE_AR_TITLES_PRINT_DATA_SOURCE,
  FINANCE_AR_TITLES_PRINT_FOOTER_NOTE,
  FINANCE_AR_TITLES_PRINT_SUBTITLE,
  FINANCE_AR_TITLES_PRINT_TITLE,
} from "@/src/lib/financeArTitlesPrintMeta";
import {
  financeArTitlesPrintMoneyClass,
  financeArTitlesPrintStatusBadgeClass,
  financeArTitlesPrintTotalMoneyClass,
} from "@/src/lib/financeArTitlesPrintStatus";
import type { FinanceArTitleListItem, FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";
import { safeTrim } from "@/src/lib/safeTrim";

function SummaryKpiCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className={[
        "finance-ar-titles-print-summary-card",
        tone ? `finance-ar-titles-print-summary-card--${tone}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="finance-ar-titles-print-summary-card-label">{label}</p>
      <p className="finance-ar-titles-print-summary-card-value">{value}</p>
    </div>
  );
}

export function FinanceAccountsReceivableTitlesPrintDocument({
  payload,
  filters,
  allItems,
  generatedAt,
  emitterName,
  branding,
}: {
  payload: FinanceArTitlesPayload;
  filters: FinanceArAnalyticalUiFilters;
  allItems: FinanceArTitleListItem[];
  generatedAt: string;
  emitterName?: string | null;
  branding: BrandingSettingsDTO;
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
        branding={branding}
      />

      <div className="finance-ar-titles-print-document">
        <div className="finance-ar-titles-print-doc-header">
          <div className="finance-ar-titles-print-doc-header-top">
            <FinanceArTitlesPrintBrand branding={branding} />
            <div className="finance-ar-titles-print-doc-header-text">
              <h1 className="finance-ar-titles-print-doc-title">{FINANCE_AR_TITLES_PRINT_TITLE}</h1>
              <p className="finance-ar-titles-print-doc-subtitle">{FINANCE_AR_TITLES_PRINT_SUBTITLE}</p>
            </div>
          </div>

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
                <td>{FINANCE_AR_TITLES_PRINT_DATA_SOURCE}</td>
              </tr>
            </tbody>
          </table>

          {filterLines.length > 0 ? (
            <div className="finance-ar-titles-print-filter-band">
              <p className="finance-ar-titles-print-filter-band-label">Filtros aplicados</p>
              <p className="finance-ar-titles-print-filter-band-value">{filterLines.join(" · ")}</p>
            </div>
          ) : null}
        </div>

        <section className="finance-ar-titles-print-section">
          <h2 className="finance-ar-titles-print-section-title">Resumo executivo</h2>
          <div className="finance-ar-titles-print-summary-grid">
            <SummaryKpiCard label="Títulos" value={formatFinanceInteger(summary.totalTitles)} />
            <SummaryKpiCard
              label="Valor original"
              value={formatFinanceCurrency(summary.totalOriginalValue)}
            />
            <SummaryKpiCard
              label="Valor recebido"
              value={formatFinanceCurrency(summary.totalReceivedValue)}
              tone="received"
            />
            <SummaryKpiCard
              label="Em aberto"
              value={formatFinanceCurrency(summary.totalOpenValue)}
              tone="open"
            />
            <SummaryKpiCard
              label="Vencido"
              value={formatFinanceCurrency(summary.totalOverdueValue)}
              tone="risk"
            />
            <SummaryKpiCard
              label="A vencer"
              value={formatFinanceCurrency(summary.totalDueValue)}
              tone="success"
            />
            <SummaryKpiCard
              label="Ticket médio"
              value={formatFinanceCurrency(summary.averageTicket)}
            />
          </div>
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
                    <td className="col-status">
                      <span className={financeArTitlesPrintStatusBadgeClass(row.calculatedStatus)}>
                        {formatFinanceCalculatedStatus(row.calculatedStatus)}
                      </span>
                    </td>
                    <td className="col-num">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                    <td
                      className={financeArTitlesPrintMoneyClass("original", row.calculatedStatus)}
                    >
                      {formatFinanceCurrency(row.amountReceivable)}
                    </td>
                    <td
                      className={financeArTitlesPrintMoneyClass("received", row.calculatedStatus)}
                    >
                      {formatFinanceCurrency(row.amountReceived)}
                    </td>
                    <td className={financeArTitlesPrintMoneyClass("open", row.calculatedStatus)}>
                      {formatFinanceCurrency(row.balanceReceivable)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="finance-ar-titles-print-total-row">
                  <td colSpan={8}>Total</td>
                  <td className={financeArTitlesPrintTotalMoneyClass("original")}>
                    {formatFinanceCurrency(summary.totalOriginalValue)}
                  </td>
                  <td className={financeArTitlesPrintTotalMoneyClass("received")}>
                    {formatFinanceCurrency(summary.totalReceivedValue)}
                  </td>
                  <td className={financeArTitlesPrintTotalMoneyClass("open")}>
                    {formatFinanceCurrency(summary.totalOpenValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <footer className="finance-ar-titles-print-footer">
          <p>{FINANCE_AR_TITLES_PRINT_FOOTER_NOTE}</p>
          <p>{formatFinanceDateTime(generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
