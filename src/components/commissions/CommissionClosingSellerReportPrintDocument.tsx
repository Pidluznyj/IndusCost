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
    <div id="sales-orders-print-root">
      <div className="sales-orders-print-document">
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

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard label="Total recebido" value={formatFinanceCurrency(summary.totalReceivedAmount)} />
            <SummaryKpiCard label="Base comissionável" value={formatFinanceCurrency(summary.commissionBaseAmount)} />
            <SummaryKpiCard label="Comissão bruta" value={formatFinanceCurrency(summary.grossCommissionAmount)} />
            <SummaryKpiCard label="Comissão excluída" value={formatFinanceCurrency(summary.excludedCommissionAmount)} />
            <SummaryKpiCard label="Comissão final" value={formatFinanceCurrency(summary.finalCommissionAmount)} />
            <SummaryKpiCard label="Títulos" value={formatFinanceInteger(summary.titleCount)} />
            <SummaryKpiCard label="Pedidos" value={formatFinanceInteger(summary.orderCount)} />
            <SummaryKpiCard label="Clientes" value={formatFinanceInteger(summary.customerCount)} />
            <SummaryKpiCard
              label="Percentual médio"
              value={summary.averageRate != null ? `${summary.averageRate.toFixed(2)}%` : "—"}
            />
          </div>
        </section>

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Analítico</h2>
          <table className="sales-orders-print-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>NF</th>
                <th>CR</th>
                <th>Parc.</th>
                <th>Venc. CR</th>
                <th>Baixa</th>
                <th className="col-money">Original CR</th>
                <th className="col-money">Recebido</th>
                <th className="col-money">Pago a mais</th>
                <th className="col-money">Base</th>
                <th className="col-money">%</th>
                <th className="col-money">Comissão</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lineKey}>
                  <td>{displayFinanceText(row.orderCode)}</td>
                  <td>{displayFinanceText(row.customerName)}</td>
                  <td>{displayFinanceText(row.nfeNumber)}</td>
                  <td>{displayFinanceText(row.receivableNumber)}</td>
                  <td>{row.installment ?? "—"}</td>
                  <td>{row.receivableDueDate ? formatFinanceDate(row.receivableDueDate) : "—"}</td>
                  <td>{row.settlementDate ? formatFinanceDate(row.settlementDate) : "—"}</td>
                  <td className="sales-orders-print-money col-money">
                    {row.originalReceivableAmount != null
                      ? formatFinanceCurrency(row.originalReceivableAmount)
                      : "—"}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.receivedGrossAmount)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {row.overpaidAmount > 0 ? formatFinanceCurrency(row.overpaidAmount) : "—"}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.commissionBaseAmount)}
                  </td>
                  <td className="col-money">{row.commissionRate.toFixed(2)}%</td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.commissionAmount)}
                  </td>
                  <td>{row.statusLabel}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8}>Totais</td>
                <td className="sales-orders-print-money col-money">
                  {formatFinanceCurrency(totals.totalReceivedAmount)}
                </td>
                <td />
                <td className="sales-orders-print-money col-money">
                  {formatFinanceCurrency(totals.commissionBaseAmount)}
                </td>
                <td />
                <td className="sales-orders-print-money col-money">
                  {formatFinanceCurrency(totals.finalCommissionAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        <p className="sales-orders-print-footer-note">
          {COMMISSION_CLOSING_SELLER_REPORT_PRINT_FOOTER} · {formatFinanceDateTime(new Date().toISOString())}
        </p>
      </div>
    </div>
  );
}
