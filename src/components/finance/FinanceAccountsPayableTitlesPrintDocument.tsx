import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { FinanceAccountsPayableTitlesPrintCover } from "@/src/components/finance/FinanceAccountsPayableTitlesPrintCover";
import type { FinanceApUiFilters } from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  buildFinanceApTitlesPrintSummary,
  resolveFinanceApTitleDocumentReference,
} from "@/src/lib/financeApTitlesPrint";
import {
  FINANCE_AP_TITLES_PRINT_DISCLAIMER,
  FINANCE_AP_TITLES_PRINT_FOOTER_NOTE,
} from "@/src/lib/financeApTitlesPrintMeta";
import {
  financeApTitlesPrintMoneyClass,
  financeApTitlesPrintStatusBadgeClass,
  financeApTitlesPrintTotalMoneyClass,
} from "@/src/lib/financeApTitlesPrintStatus";
import type { FinanceApTitleListItem } from "@/src/lib/financeAccountsPayableTitles";

function SummaryKpiCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className={[
        "finance-ap-titles-print-summary-card",
        tone ? `finance-ap-titles-print-summary-card--${tone}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="finance-ap-titles-print-summary-card-label">{label}</p>
      <p className="finance-ap-titles-print-summary-card-value">{value}</p>
    </div>
  );
}

export function FinanceAccountsPayableTitlesPrintDocument({
  filters,
  allItems,
  generatedAt,
  emitterName,
  branding,
}: {
  filters: FinanceApUiFilters;
  allItems: FinanceApTitleListItem[];
  generatedAt: string;
  emitterName?: string | null;
  branding: BrandingSettingsDTO;
}) {
  const summary = useMemo(() => buildFinanceApTitlesPrintSummary(allItems), [allItems]);

  return (
    <div id="ap-titles-print-root">
      <div className="finance-ap-titles-print-document">
        <FinanceAccountsPayableTitlesPrintCover
          filters={filters}
          generatedAt={generatedAt}
          emitterName={emitterName}
          titlesCount={allItems.length}
          branding={branding}
        />

        <section className="finance-ap-titles-print-section finance-ap-titles-print-section--summary">
          <h2 className="finance-ap-titles-print-section-title">Resumo executivo</h2>
          <div className="finance-ap-titles-print-summary-grid">
            <SummaryKpiCard label="Títulos" value={formatFinanceInteger(summary.totalTitles)} />
            <SummaryKpiCard
              label="Valor original"
              value={formatFinanceCurrency(summary.totalOriginalValue)}
            />
            <SummaryKpiCard
              label="Valor pago"
              value={formatFinanceCurrency(summary.totalPaidValue)}
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

        <p className="finance-ap-titles-print-disclaimer">{FINANCE_AP_TITLES_PRINT_DISCLAIMER}</p>

        <section className="finance-ap-titles-print-section finance-ap-titles-print-section--detail">
          <h2 className="finance-ap-titles-print-section-title">
            Detalhamento analítico ({formatFinanceInteger(allItems.length)})
          </h2>
          {allItems.length === 0 ? (
            <p className="finance-ap-titles-print-empty">
              Nenhum título encontrado para os filtros selecionados.
            </p>
          ) : (
            <table className="finance-ap-titles-print-data-table">
              <thead>
                <tr>
                  <th className="col-client">Fornecedor</th>
                  <th className="col-doc">Documento / NF</th>
                  <th className="col-date">Vencimento</th>
                  <th className="col-date">Operacional</th>
                  <th className="col-date">Pagamento</th>
                  <th className="col-status">Status</th>
                  <th className="col-num">Dias</th>
                  <th className="col-money">Original</th>
                  <th className="col-money">Pago</th>
                  <th className="col-money">Aberto</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((row) => (
                  <tr key={row.externalId}>
                    <td className="col-client">{displayFinanceText(row.personName)}</td>
                    <td className="col-doc">
                      {displayFinanceText(resolveFinanceApTitleDocumentReference(row))}
                    </td>
                    <td className="col-date">{formatFinanceDate(row.dueDate)}</td>
                    <td className="col-date">{formatFinanceDate(row.operationalDueDate)}</td>
                    <td className="col-date">
                      {formatFinanceDate(row.paymentDate ?? row.settlementDate)}
                    </td>
                    <td className="col-status">
                      <span className={financeApTitlesPrintStatusBadgeClass(row.calculatedStatus)}>
                        {formatFinanceCalculatedStatus(row.calculatedStatus)}
                      </span>
                    </td>
                    <td className="col-num">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                    <td className={financeApTitlesPrintMoneyClass("original", row.calculatedStatus)}>
                      {formatFinanceCurrency(row.amountPayable)}
                    </td>
                    <td className={financeApTitlesPrintMoneyClass("paid", row.calculatedStatus)}>
                      {formatFinanceCurrency(row.amountPaid)}
                    </td>
                    <td className={financeApTitlesPrintMoneyClass("open", row.calculatedStatus)}>
                      {formatFinanceCurrency(row.balancePayable)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="finance-ap-titles-print-total-row">
                  <td colSpan={7}>Total</td>
                  <td className={financeApTitlesPrintTotalMoneyClass("original")}>
                    {formatFinanceCurrency(summary.totalOriginalValue)}
                  </td>
                  <td className={financeApTitlesPrintTotalMoneyClass("paid")}>
                    {formatFinanceCurrency(summary.totalPaidValue)}
                  </td>
                  <td className={financeApTitlesPrintTotalMoneyClass("open")}>
                    {formatFinanceCurrency(summary.totalOpenValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <footer className="finance-ap-titles-print-footer">
          <p>{FINANCE_AP_TITLES_PRINT_FOOTER_NOTE}</p>
          <p>{formatFinanceDateTime(generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
