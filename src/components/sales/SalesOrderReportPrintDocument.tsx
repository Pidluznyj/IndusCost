import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { SalesOrderReportPrintCover } from "./SalesOrderReportPrintCover";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  SALES_ORDER_REPORT_PRINT_DISCLAIMER,
  SALES_ORDER_REPORT_PRINT_FOOTER_NOTE,
} from "@/src/lib/sales/salesOrderReportPrintMeta";
import type {
  SalesOrderReportPayload,
  SalesOrderReportRow,
} from "@/src/lib/sales/salesOrderReport";
import {
  salesOrderBillingStatusLabelCompactForPdf,
  type SalesOrderBillingStatus,
} from "@/src/lib/sales/salesOrderListBillingStatus";

type SummaryCardTone =
  | "neutral"
  | "positive"
  | "warning"
  | "risk"
  | "info";

function SummaryKpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: SummaryCardTone;
}) {
  const cls = tone && tone !== "neutral" ? `sales-orders-print-summary-card--${tone}` : "";
  return (
    <div className={["sales-orders-print-summary-card", cls].filter(Boolean).join(" ")}>
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

/**
 * Classe de tom para a coluna "Faturamento" no PDF. Reaproveita a paleta de
 * `sales-orders-print-status--*` para consistência tipográfica; a lógica de
 * mapear tom por status de faturamento vive só aqui.
 */
function billingStatusToneClass(status: SalesOrderBillingStatus): string {
  switch (status) {
    case "INVOICED":
      return "sales-orders-print-status sales-orders-print-status--success";
    case "PARTIALLY_INVOICED":
      return "sales-orders-print-status sales-orders-print-status--info";
    case "NOT_INVOICED":
      return "sales-orders-print-status sales-orders-print-status--muted";
    case "CANCELED":
      return "sales-orders-print-status sales-orders-print-status--danger";
    default:
      return "sales-orders-print-status sales-orders-print-status--unknown";
  }
}

function moneyClassForRow(kind: "original" | "active" | "canceled" | "invoiced" | "pending"): string {
  const base = "sales-orders-print-money";
  switch (kind) {
    case "canceled":
      return `${base} sales-orders-print-money--risk`;
    case "invoiced":
      return `${base} sales-orders-print-money--received`;
    case "pending":
      return `${base} sales-orders-print-money--open`;
    case "active":
      return `${base} sales-orders-print-money--strong`;
    default:
      return base;
  }
}

export function SalesOrderReportPrintDocument({
  payload,
  branding,
}: {
  payload: SalesOrderReportPayload;
  branding: BrandingSettingsDTO;
}) {
  const { summary, rows } = payload;

  return (
    <div id="sales-orders-print-root">
      <div className="sales-orders-print-document">
        <SalesOrderReportPrintCover payload={payload} branding={branding} />

        <section className="sales-orders-print-section sales-orders-print-section--summary">
          <h2 className="sales-orders-print-section-title">Resumo executivo</h2>
          <div className="sales-orders-print-summary-grid">
            <SummaryKpiCard
              label="Pedidos"
              value={formatFinanceInteger(summary.ordersCount)}
            />
            <SummaryKpiCard
              label="Valor original"
              value={formatFinanceCurrency(summary.originalValue)}
            />
            <SummaryKpiCard
              label="Valor ativo"
              value={formatFinanceCurrency(summary.activeValue)}
              tone="positive"
            />
            <SummaryKpiCard
              label="Valor cancelado"
              value={formatFinanceCurrency(summary.canceledValue)}
              tone="risk"
            />
            <SummaryKpiCard
              label="Total NF válido"
              value={formatFinanceCurrency(summary.invoicedValue)}
              tone="info"
            />
            <SummaryKpiCard
              label="A faturar"
              value={formatFinanceCurrency(summary.amountToInvoice)}
              tone="warning"
            />
            <SummaryKpiCard
              label="Saldo financeiro (CR)"
              value={formatFinanceCurrency(summary.financialBalance)}
              tone="warning"
            />
            <SummaryKpiCard
              label="CR recebido"
              value={formatFinanceCurrency(summary.crReceivedTotal)}
              tone="positive"
            />
            <SummaryKpiCard
              label="Ticket médio"
              value={formatFinanceCurrency(summary.averageTicket)}
            />
            <SummaryKpiCard
              label="Itens (ativos/cancel.)"
              value={`${formatFinanceInteger(summary.activeItemsCount)} / ${formatFinanceInteger(
                summary.canceledItemsCount
              )}`}
            />
            <SummaryKpiCard
              label="Pedidos com NF"
              value={formatFinanceInteger(summary.invoicedCount)}
              tone="positive"
            />
            <SummaryKpiCard
              label="Pedidos sem NF"
              value={formatFinanceInteger(summary.notInvoicedCount)}
              tone="warning"
            />
            <SummaryKpiCard
              label="Sem CR gerado"
              value={formatFinanceInteger(summary.ordersWithoutCrCount)}
              tone="warning"
            />
          </div>
        </section>

        <p className="sales-orders-print-disclaimer">
          {SALES_ORDER_REPORT_PRINT_DISCLAIMER}
        </p>

        <section className="sales-orders-print-section sales-orders-print-section--detail">
          <h2 className="sales-orders-print-section-title">
            Detalhamento analítico ({formatFinanceInteger(rows.length)}
            {payload.truncated
              ? ` de ${formatFinanceInteger(payload.totalOrdersInScope)}`
              : ""}
            )
          </h2>
          {/*
            Ordem canônica das colunas da tabela analítica (2026-07):
              Cliente · Pedido · Emissão · Entrega · Vendedor · Faturamento
              · Itens · Valor ativo · Total NF · A faturar · Saldo CR
          */}
          {rows.length === 0 ? (
            <p className="sales-orders-print-empty">
              Nenhum pedido encontrado para os filtros selecionados.
            </p>
          ) : (
            <table className="sales-orders-print-data-table">
              <thead>
                <tr>
                  <th className="col-client">Cliente</th>
                  <th className="col-order">Pedido</th>
                  <th className="col-date">Emissão</th>
                  <th className="col-date">Entrega</th>
                  <th className="col-seller">Vendedor</th>
                  <th className="col-status">Faturamento</th>
                  <th className="col-num">Itens</th>
                  <th className="col-money">Valor ativo</th>
                  <th className="col-money">Total NF</th>
                  <th className="col-money">A faturar</th>
                  <th className="col-money">Saldo CR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderId}>
                    <td className="col-client">
                      <span className="sales-orders-print-client-text">
                        {displayFinanceText(row.customerName)}
                      </span>
                    </td>
                    <td className="col-order">
                      {/* PDF analítico: somente o código do pedido (ex.: PD 02739). */}
                      <span className="sales-orders-print-order-code">{row.orderCode}</span>
                    </td>
                    <td className="col-date">{formatFinanceDate(row.issueDate)}</td>
                    <td className="col-date">{formatFinanceDate(row.expectedDeliveryDate)}</td>
                    <td className="col-seller">
                      <span className="sales-orders-print-seller-text">
                        {displayFinanceText(row.sellerName)}
                      </span>
                    </td>
                    <td className="col-status">
                      <span
                        className={billingStatusToneClass(row.billingStatus)}
                        title={row.billingStatusLabel}
                      >
                        {salesOrderBillingStatusLabelCompactForPdf(row.billingStatus)}
                      </span>
                    </td>
                    <td className="col-num">
                      {formatFinanceInteger(row.itemsCount)}
                      {row.canceledItemsCount > 0 ? (
                        <span className="sales-orders-print-canceled-count">
                          {" "}
                          ({row.canceledItemsCount} canc.)
                        </span>
                      ) : null}
                    </td>
                    <td className={`col-money ${moneyClassForRow("active")}`}>
                      {formatFinanceCurrency(row.activeValue)}
                    </td>
                    <td className={`col-money ${moneyClassForRow("invoiced")}`}>
                      {formatFinanceCurrency(row.invoicedValue)}
                    </td>
                    <td className={`col-money ${moneyClassForRow("pending")}`}>
                      {formatFinanceCurrency(row.amountToInvoice)}
                    </td>
                    <td className={`col-money ${moneyClassForRow("pending")}`}>
                      {row.financialBalance == null
                        ? "—"
                        : formatFinanceCurrency(row.financialBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sales-orders-print-total-row">
                  <td colSpan={6}>Total</td>
                  <td className="col-num">
                    {formatFinanceInteger(summary.totalItemsCount)}
                  </td>
                  <td className={`col-money ${moneyClassForRow("active")} sales-orders-print-money--total`}>
                    {formatFinanceCurrency(summary.activeValue)}
                  </td>
                  <td className={`col-money ${moneyClassForRow("invoiced")} sales-orders-print-money--total`}>
                    {formatFinanceCurrency(summary.invoicedValue)}
                  </td>
                  <td className={`col-money ${moneyClassForRow("pending")} sales-orders-print-money--total`}>
                    {formatFinanceCurrency(summary.amountToInvoice)}
                  </td>
                  <td className={`col-money ${moneyClassForRow("pending")} sales-orders-print-money--total`}>
                    {formatFinanceCurrency(summary.financialBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {payload.truncated ? (
            <p className="sales-orders-print-empty">
              Foram exibidos {formatFinanceInteger(rows.length)} de{" "}
              {formatFinanceInteger(payload.totalOrdersInScope)} pedidos filtrados. Ajuste os
              filtros para visualizar o restante — o XLSX inclui a mesma janela.
            </p>
          ) : null}
        </section>

        <footer className="sales-orders-print-footer">
          <p>{SALES_ORDER_REPORT_PRINT_FOOTER_NOTE}</p>
          <p>{formatFinanceDateTime(payload.generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}

/** Exportado para QA/reuso — evita depender de `rows.length` inline. */
export function totalRowsForPrint(rows: readonly SalesOrderReportRow[]): number {
  return rows.length;
}
