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
import {
  COMMISSION_CLOSING_REPORT_PRINT_FOOTER_NOTE,
  COMMISSION_CLOSING_REPORT_PRINT_SOURCE,
  COMMISSION_CLOSING_REPORT_PRINT_SUBTITLE,
  COMMISSION_CLOSING_REPORT_PRINT_TITLE,
} from "@/src/lib/commissions/commissionClosingReportPrintMeta";
import type { ReceiptClosingPagePayload } from "@/src/lib/commissions/commissionReceiptClosingApi.shared";
import "@/src/components/sales/sales-order-report-print.css";

function SummaryKpiCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="sales-orders-print-summary-card">
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

function monthLabel(year: number, month: number): string {
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * PDF do fechamento de comissões — mesmo padrão do relatório de Pedidos de Venda.
 * Deve ser portalizado em `document.body` (fora de #root) para o CSS
 * `sales-orders-print-route` não esconder o conteúdo.
 */
export function CommissionClosingReportPrintDocument({
  payload,
  branding,
}: {
  payload: ReceiptClosingPagePayload;
  branding: BrandingSettingsDTO | null;
}) {
  const brand = branding ?? DEFAULT_BRANDING;
  const cards = payload.cards;
  const closing = payload.closing;
  const period = monthLabel(payload.year, payload.month);
  const statusLabel = payload.mode === "CLOSED" ? "FECHADO" : payload.mode;

  const metaLines = useMemo(() => {
    const lines = [
      { label: "Período", value: period },
      { label: "Status", value: statusLabel },
      {
        label: "Registros",
        value: formatFinanceInteger(payload.lines.length),
      },
      { label: "Origem", value: COMMISSION_CLOSING_REPORT_PRINT_SOURCE },
    ];
    if (closing?.closedAt) {
      lines.splice(2, 0, {
        label: "Fechado em",
        value: formatFinanceDateTime(closing.closedAt),
      });
    }
    if (closing?.closedBy) {
      lines.splice(closing?.closedAt ? 3 : 2, 0, {
        label: "Fechado por",
        value: displayFinanceText(closing.closedBy),
      });
    }
    return lines;
  }, [
    closing?.closedAt,
    closing?.closedBy,
    period,
    payload.lines.length,
    statusLabel,
  ]);

  const filterBand = [
    `Ano/Mês: ${period}`,
    `Status: ${statusLabel}`,
    closing?.notes?.includes("CRITICAL_DIVERGENCE_ACCEPTED")
      ? "Divergência crítica: aceita"
      : payload.criticalDivergence
        ? "Divergência crítica: detectada"
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div id="sales-orders-print-root">
      <div className="sales-orders-print-document">
        <div className="sales-orders-print-cover">
          <PrintHeader
            branding={brand}
            documentTitle={COMMISSION_CLOSING_REPORT_PRINT_TITLE}
            documentHighlight={period}
            metaLines={metaLines}
            subtitle={COMMISSION_CLOSING_REPORT_PRINT_SUBTITLE}
            className="sales-orders-print-doc-header"
          />
          <div className="sales-orders-print-filter-band">
            <p className="sales-orders-print-filter-band-label">Filtros / contexto</p>
            <p className="sales-orders-print-filter-band-value">{filterBand}</p>
          </div>
        </div>

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard
              label="Títulos recebidos"
              value={formatFinanceInteger(
                payload.materializationSummary.totalReceivablesCount
              )}
            />
            <SummaryKpiCard
              label="Total recebido"
              value={formatFinanceCurrency(cards.totalReceivedAmount)}
            />
            <SummaryKpiCard
              label="Recebido com schedule"
              value={formatFinanceCurrency(cards.receivedWithScheduleAmount)}
            />
            <SummaryKpiCard
              label="Recebido cliente excluído"
              value={formatFinanceCurrency(cards.receivedExcludedCustomerAmount)}
            />
            <SummaryKpiCard
              label="Empresas do grupo excluídas"
              value={formatFinanceInteger(
                payload.materializationSummary.groupCompanyExcludedCount
              )}
            />
            <SummaryKpiCard
              label="Base comissionável"
              value={formatFinanceCurrency(cards.commissionableBaseAmount)}
            />
            <SummaryKpiCard
              label="Comissão bruta"
              value={formatFinanceCurrency(cards.grossCommissionAmount)}
            />
            <SummaryKpiCard
              label="Comissão excluída"
              value={formatFinanceCurrency(cards.excludedCommissionAmount)}
            />
            <SummaryKpiCard
              label="Comissão final a pagar"
              value={formatFinanceCurrency(cards.finalCommissionAmount)}
            />
            <SummaryKpiCard
              label="Vendedores"
              value={formatFinanceInteger(payload.bySeller.length)}
            />
            <SummaryKpiCard
              label="Divergências críticas aceitas"
              value={
                closing?.notes?.includes("CRITICAL_DIVERGENCE_ACCEPTED") ? "Sim" : "Não"
              }
            />
            <SummaryKpiCard
              label="Registros"
              value={formatFinanceInteger(payload.lines.length)}
            />
          </div>
        </section>

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Por vendedor</h2>
          <table className="sales-orders-print-table">
            <thead>
              <tr>
                <th>Vendedor canônico</th>
                <th className="col-money">Recebido único</th>
                <th className="col-money">Base</th>
                <th className="col-money">Comissão bruta</th>
                <th className="col-money">Comissão excluída</th>
                <th className="col-money">Comissão final</th>
                <th>Exceções</th>
              </tr>
            </thead>
            <tbody>
              {payload.bySeller.map((row) => (
                <tr key={row.sellerGroupKey || row.sellerId || row.sellerName || "sem"}>
                  <td>{displayFinanceText(row.sellerName) || "Sem vendedor"}</td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.receivedAmount)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.commissionableBase)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.grossCommission)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.excludedCommission)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(row.releasedCommission)}
                  </td>
                  <td>{formatFinanceInteger(row.exceptionCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sales-orders-print-section">
          <h2 className="sales-orders-print-section-title">Analítico</h2>
          <table className="sales-orders-print-table">
            <thead>
              <tr>
                <th>CR</th>
                <th>NF</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Vendedor</th>
                <th className="col-money">Recebido bruto</th>
                <th className="col-money">Base comissão</th>
                <th className="col-money">Comissão</th>
                <th>Status</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {payload.lines.map((line) => (
                <tr key={line.lineKey}>
                  <td>
                    {displayFinanceText(
                      line.receivableNumber ??
                        (line.nomusReceivableId != null
                          ? String(line.nomusReceivableId)
                          : null)
                    )}
                  </td>
                  <td>{displayFinanceText(line.nfeNumber)}</td>
                  <td>{displayFinanceText(line.orderCode)}</td>
                  <td>{displayFinanceText(line.customerName)}</td>
                  <td>
                    {displayFinanceText(line.canonicalSellerName ?? line.rawSellerName)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(
                      line.uniqueReceivedAmount > 0
                        ? line.uniqueReceivedAmount
                        : line.receivedAmount
                    )}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(line.commissionableBaseAmount)}
                  </td>
                  <td className="sales-orders-print-money col-money">
                    {formatFinanceCurrency(line.releasedCommissionAmount)}
                  </td>
                  <td>{displayFinanceText(line.status)}</td>
                  <td>{displayFinanceText(line.statusReason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="sales-orders-print-footer">
          <p>{COMMISSION_CLOSING_REPORT_PRINT_FOOTER_NOTE}</p>
        </footer>
      </div>
    </div>
  );
}
