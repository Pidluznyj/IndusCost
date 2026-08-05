import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { DEFAULT_BRANDING } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { formatSalesOrderDisplayCode } from "@/src/lib/salesOrderListUi";
import {
  buildCommissionOrderProvisionFilterSummary,
  type CommissionOrderProvisionReportPayload,
} from "@/src/lib/commissions/commissionOrderProvision.shared";
import {
  COMMISSION_ORDER_PROVISION_PRINT_FOOTER_NOTE,
  COMMISSION_ORDER_PROVISION_PRINT_SOURCE,
  COMMISSION_ORDER_PROVISION_PRINT_SUBTITLE,
  COMMISSION_ORDER_PROVISION_PRINT_TITLE,
} from "@/src/lib/commissions/commissionOrderProvisionReportPrintMeta";
import "@/src/components/sales/sales-order-report-print.css";
import "@/src/components/commissions/commission-order-provision-print.css";

function SummaryKpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="sales-orders-print-summary-card">
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

function formatDatePt(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/**
 * PDF/impressão da Provisão por pedido — mesmo padrão do fechamento de
 * comissões (CommissionClosingReportPrintDocument), A4 retrato.
 * Deve ser portalizado em `document.body` (fora de #root) para o CSS
 * `sales-orders-print-route` não esconder o conteúdo.
 */
export function CommissionOrderProvisionReportPrintDocument({
  payload,
  branding,
}: {
  payload: CommissionOrderProvisionReportPayload;
  branding: BrandingSettingsDTO | null;
}) {
  const brand = branding ?? DEFAULT_BRANDING;
  const cards = payload.cards;

  const metaLines = useMemo(
    () => [
      { label: "Período", value: payload.periodLabel },
      { label: "Pedidos", value: formatFinanceInteger(cards.orderCount) },
      { label: "Gerado em", value: formatFinanceDateTime(payload.generatedAt) },
      { label: "Origem", value: COMMISSION_ORDER_PROVISION_PRINT_SOURCE },
    ],
    [payload.periodLabel, payload.generatedAt, cards.orderCount]
  );

  const filterSummary = useMemo(
    () => buildCommissionOrderProvisionFilterSummary(payload),
    [payload]
  );

  return (
    <div id="sales-orders-print-root" className="comm-order-provision-print-root">
      <div className="sales-orders-print-document comm-order-provision-print-document">
        <div className="sales-orders-print-cover">
          <PrintHeader
            branding={brand}
            documentTitle={COMMISSION_ORDER_PROVISION_PRINT_TITLE}
            documentHighlight={payload.periodLabel}
            metaLines={metaLines}
            subtitle={COMMISSION_ORDER_PROVISION_PRINT_SUBTITLE}
            className="sales-orders-print-doc-header"
          />
          <div className="sales-orders-print-filter-band">
            <p className="sales-orders-print-filter-band-label">Filtros aplicados</p>
            <p className="sales-orders-print-filter-band-value">{filterSummary}</p>
          </div>
        </div>

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Resumo</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard label="Pedidos" value={formatFinanceInteger(cards.orderCount)} />
            <SummaryKpiCard
              label="Comissão acumulada"
              value={formatFinanceCurrency(cards.totalFinalCommissionAmount)}
            />
            <SummaryKpiCard
              label="Base vendida"
              value={formatFinanceCurrency(cards.totalSoldAmount)}
            />
            <SummaryKpiCard
              label="Comissão bruta (antes exclusão)"
              value={formatFinanceCurrency(cards.totalGrossCommissionAmount)}
            />
          </div>
        </section>

        {cards.sellers.length > 0 ? (
          <section className="sales-orders-print-section">
            <h2 className="sales-orders-print-section-title">Por vendedor</h2>
            <table className="sales-orders-print-table">
              <thead>
                <tr>
                  <th>Vendedor canônico</th>
                  <th className="col-money">Pedidos</th>
                  <th className="col-money">Comissão final</th>
                </tr>
              </thead>
              <tbody>
                {cards.sellers.map((seller) => (
                  <tr key={seller.key}>
                    <td>{displayFinanceText(seller.sellerName)}</td>
                    <td className="sales-orders-print-money col-money">
                      {formatFinanceInteger(seller.orderCount)}
                    </td>
                    <td className="sales-orders-print-money col-money">
                      {formatFinanceCurrency(seller.totalFinalCommissionAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Pedidos</h2>
          <table className="sales-orders-print-table">
            <thead>
              <tr>
                <th className="comm-order-provision-col-order">Pedido</th>
                <th className="comm-order-provision-col-date">Data venda</th>
                <th className="comm-order-provision-col-customer">Cliente</th>
                <th className="comm-order-provision-col-seller">Vendedor</th>
                <th className="comm-order-provision-col-nfe">NF-e</th>
                <th className="comm-order-provision-col-base col-money">Base</th>
                <th className="comm-order-provision-col-commission col-money">Comissão</th>
                <th className="comm-order-provision-col-obs">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row) => (
                <tr key={row.salesOrderId}>
                  <td>
                    {formatSalesOrderDisplayCode(row.orderCode) || row.orderCode || "—"}
                  </td>
                  <td>{formatDatePt(row.saleDate)}</td>
                  <td>{displayFinanceText(row.customerName)}</td>
                  <td>
                    {displayFinanceText(row.canonicalSellerName ?? row.rawSellerName)}
                  </td>
                  <td>{row.nfeIds.length > 0 ? row.nfeIds.join(", ") : "—"}</td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.totalSoldAmount)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.totalFinalCommissionAmount)}
                  </td>
                  <td>
                    {row.hasCustomerExcludedItems
                      ? "Cliente excluído"
                      : row.totalFinalCommissionAmount <= 0.009
                        ? "Comissão zero"
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="sales-orders-print-footer">
          <p>{COMMISSION_ORDER_PROVISION_PRINT_FOOTER_NOTE}</p>
        </footer>
      </div>
    </div>
  );
}
