import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { DEFAULT_BRANDING } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { CommissionClosingSellerReport } from "@/src/lib/commissions/commissionClosings.shared";
import {
  COMMISSION_CLOSING_SELLER_REPORT_PRINT_FOOTER,
  COMMISSION_CLOSING_SELLER_REPORT_PRINT_SOURCE,
  COMMISSION_CLOSING_SELLER_REPORT_PRINT_SUBTITLE,
  COMMISSION_CLOSING_SELLER_REPORT_PRINT_TITLE,
} from "@/src/lib/commissions/commissionClosings.shared";
import "@/src/components/sales/sales-order-report-print.css";

function SummaryKpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="sales-orders-print-summary-card">
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

function StackLine({
  primary,
  secondary,
  align = "left",
}: {
  primary: string;
  secondary?: string | null;
  align?: "left" | "right";
}) {
  return (
    <div
      className={
        align === "right"
          ? "comm-closing-print-stack comm-closing-print-stack--right"
          : "comm-closing-print-stack"
      }
    >
      <span className="comm-closing-print-stack-primary">{primary}</span>
      {secondary ? (
        <span className="comm-closing-print-stack-secondary">{secondary}</span>
      ) : null}
    </div>
  );
}

/**
 * Relatório PDF por vendedor — grid analítico em colunas compostas (2 linhas)
 * para caber em A4 paisagem sem esmagar 14 colunas.
 */
export function CommissionClosingSellerReportPrintDocument({
  report,
  branding,
}: {
  report: CommissionClosingSellerReport;
  branding: BrandingSettingsDTO | null;
}) {
  const brand = branding ?? DEFAULT_BRANDING;
  const { closing, seller, summary, rows, totals } = report;

  const metaLines = useMemo(
    () => [
      { label: "Vendedor", value: seller.displayName },
      { label: "Período", value: closing.periodLabel },
      { label: "Status", value: closing.statusLabel },
      {
        label: "Fechado em",
        value: closing.closedAt ? formatFinanceDateTime(closing.closedAt) : "—",
      },
      { label: "Fechado por", value: displayFinanceText(closing.closedByName) },
      { label: "Origem", value: COMMISSION_CLOSING_SELLER_REPORT_PRINT_SOURCE },
    ],
    [closing, seller.displayName]
  );

  return (
    <div id="sales-orders-print-root" className="comm-closing-print-root">
      <div className="sales-orders-print-document comm-closing-print-document">
        <div className="sales-orders-print-cover">
          <PrintHeader
            branding={brand}
            documentTitle={COMMISSION_CLOSING_SELLER_REPORT_PRINT_TITLE}
            documentHighlight={seller.displayName}
            metaLines={metaLines}
            subtitle={COMMISSION_CLOSING_SELLER_REPORT_PRINT_SUBTITLE}
            className="sales-orders-print-doc-header"
          />
          <div className="sales-orders-print-filter-band">
            <p className="sales-orders-print-filter-band-label">Contexto</p>
            <p className="sales-orders-print-filter-band-value">
              Fechamento {closing.periodLabel} · {closing.statusLabel} · Ledger oficial
            </p>
          </div>
        </div>

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
          <div className="sales-orders-print-summary-grid sales-orders-print-summary-grid--6">
            <SummaryKpiCard
              label="Total recebido"
              value={formatFinanceCurrency(summary.totalReceivedAmount)}
            />
            <SummaryKpiCard
              label="Base comissionável"
              value={formatFinanceCurrency(summary.commissionBaseAmount)}
            />
            <SummaryKpiCard
              label="Comissão final"
              value={formatFinanceCurrency(summary.finalCommissionAmount)}
            />
            <SummaryKpiCard label="Títulos" value={formatFinanceInteger(summary.titleCount)} />
            <SummaryKpiCard label="Pedidos" value={formatFinanceInteger(summary.orderCount)} />
            <SummaryKpiCard
              label="% médio"
              value={
                summary.averageRate != null ? `${summary.averageRate.toFixed(2)}%` : "—"
              }
            />
          </div>
        </section>

        <section className="sales-orders-print-section sales-orders-print-section--detail">
          <h2 className="sales-orders-print-section-title">Analítico</h2>
          <p className="sales-orders-print-disclaimer">
            Cada linha agrupa documentos, datas e valores em blocos de duas linhas para leitura
            executiva em A4 paisagem.
          </p>
          <table className="sales-orders-print-table sales-orders-print-data-table comm-closing-print-table">
            <thead>
              <tr>
                <th className="comm-closing-col-order">Pedido / Cliente</th>
                <th className="comm-closing-col-docs">Documentos</th>
                <th className="comm-closing-col-dates">Datas</th>
                <th className="comm-closing-col-amounts">Valores CR</th>
                <th className="comm-closing-col-base">Base / %</th>
                <th className="comm-closing-col-commission col-money">Comissão</th>
                <th className="comm-closing-col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const due = row.receivableDueDate
                  ? formatFinanceDate(row.receivableDueDate)
                  : "—";
                const settled = row.settlementDate
                  ? formatFinanceDate(row.settlementDate)
                  : "—";
                const original =
                  row.originalReceivableAmount != null
                    ? formatFinanceCurrency(row.originalReceivableAmount)
                    : "—";
                const received = formatFinanceCurrency(row.receivedGrossAmount);
                const overpaid =
                  row.overpaidAmount > 0
                    ? `+ ${formatFinanceCurrency(row.overpaidAmount)}`
                    : null;
                return (
                  <tr key={row.lineKey}>
                    <td className="comm-closing-col-order">
                      <StackLine
                        primary={displayFinanceText(row.orderCode)}
                        secondary={displayFinanceText(row.customerName)}
                      />
                    </td>
                    <td className="comm-closing-col-docs">
                      <StackLine
                        primary={`NF ${displayFinanceText(row.nfeNumber)}`}
                        secondary={`CR ${displayFinanceText(row.receivableNumber)} · Parc. ${
                          row.installment ?? "—"
                        }`}
                      />
                    </td>
                    <td className="comm-closing-col-dates">
                      <StackLine primary={`Venc. ${due}`} secondary={`Baixa ${settled}`} />
                    </td>
                    <td className="comm-closing-col-amounts">
                      <StackLine
                        primary={`Orig. ${original}`}
                        secondary={
                          overpaid ? `Rec. ${received} · ${overpaid}` : `Rec. ${received}`
                        }
                        align="right"
                      />
                    </td>
                    <td className="comm-closing-col-base">
                      <StackLine
                        primary={formatFinanceCurrency(row.commissionBaseAmount)}
                        secondary={`${row.commissionRate.toFixed(2)}%`}
                        align="right"
                      />
                    </td>
                    <td className="sales-orders-print-money col-money comm-closing-col-commission">
                      <span className="comm-closing-print-commission">
                        {formatFinanceCurrency(row.commissionAmount)}
                      </span>
                    </td>
                    <td className="comm-closing-col-status">
                      <span className="comm-closing-print-status">{row.statusLabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="sales-orders-print-total-row">
                <td colSpan={3}>Totais ({formatFinanceInteger(rows.length)} linha(s))</td>
                <td className="sales-orders-print-money col-money">
                  {formatFinanceCurrency(totals.totalReceivedAmount)}
                </td>
                <td className="sales-orders-print-money col-money">
                  {formatFinanceCurrency(totals.commissionBaseAmount)}
                </td>
                <td className="sales-orders-print-money col-money sales-orders-print-money--total">
                  {formatFinanceCurrency(totals.finalCommissionAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        <p className="sales-orders-print-footer-note">
          {COMMISSION_CLOSING_SELLER_REPORT_PRINT_FOOTER} ·{" "}
          {formatFinanceDateTime(new Date().toISOString())}
        </p>
      </div>
    </div>
  );
}
