import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
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
 * PDF do fechamento de comissões — mesmo padrão visual do relatório de Pedidos de Venda
 * (`sales-order-report-print.css` + window.print).
 */
export function CommissionClosingReportPrintDocument({
  payload,
  branding,
}: {
  payload: ReceiptClosingPagePayload;
  branding: BrandingSettingsDTO | null;
}) {
  const companyName = branding?.companyName?.trim() || "Lazarios Koppetel";
  const logoUrl = branding?.logoUrl?.trim() || null;
  const slogan = branding?.slogan?.trim() || null;
  const cards = payload.cards;
  const closing = payload.closing;

  return (
    <div id="sales-orders-print-root" className="sales-orders-print-document">
      <header className="print-doc-header">
        <div className="print-doc-header-grid">
          <div className="print-doc-logo-wrap">
            {logoUrl ? (
              <img src={logoUrl} alt={companyName} className="print-doc-logo" />
            ) : (
              <div className="print-doc-company-text">
                <p className="print-doc-company-name">{companyName}</p>
                {slogan ? <p className="print-doc-company-slogan">{slogan}</p> : null}
              </div>
            )}
          </div>
          <div className="print-doc-meta">
            <p className="print-doc-meta-title">{COMMISSION_CLOSING_REPORT_PRINT_TITLE}</p>
            <p className="print-doc-meta-subtitle">{COMMISSION_CLOSING_REPORT_PRINT_SUBTITLE}</p>
            <p>
              Período: <strong>{monthLabel(payload.year, payload.month)}</strong>
            </p>
            <p>
              Status: <strong>{payload.mode === "CLOSED" ? "FECHADO" : payload.mode}</strong>
            </p>
            {closing?.closedAt ? (
              <p>
                Fechado em: <strong>{formatFinanceDateTime(closing.closedAt)}</strong>
              </p>
            ) : null}
            {closing?.closedBy ? (
              <p>
                Fechado por: <strong>{displayFinanceText(closing.closedBy)}</strong>
              </p>
            ) : null}
            <p>Origem: {COMMISSION_CLOSING_REPORT_PRINT_SOURCE}</p>
            {closing?.notes ? (
              <p>
                Observação: <strong>{displayFinanceText(closing.notes)}</strong>
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <section className="sales-orders-print-section">
        <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
        <div className="sales-orders-print-summary-grid">
          <SummaryKpiCard
            label="Títulos recebidos"
            value={formatFinanceInteger(payload.materializationSummary.totalReceivablesCount)}
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
              <tr key={row.sellerId ?? row.sellerName ?? "sem"}>
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
                      (line.nomusReceivableId != null ? String(line.nomusReceivableId) : null)
                  )}
                </td>
                <td>{displayFinanceText(line.nfeNumber)}</td>
                <td>{displayFinanceText(line.orderCode)}</td>
                <td>{displayFinanceText(line.customerName)}</td>
                <td>{displayFinanceText(line.canonicalSellerName ?? line.rawSellerName)}</td>
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
  );
}
