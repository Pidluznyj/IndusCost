import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { SalesOrderIndustrialResultReportPrintCover } from "./SalesOrderIndustrialResultReportPrintCover";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DISCLAIMER,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_FOOTER_NOTE,
} from "@/src/lib/sales/salesOrderIndustrialResultReportPrintMeta";
import type {
  SalesOrderIndustrialResultReportPayload,
  SalesOrderIndustrialResultReportRow,
} from "@/src/lib/sales/salesOrderIndustrialResultReport";

function moneyOrDash(value: number | null | undefined, negativeTone = false): {
  text: string;
  className: string;
} {
  if (value == null || !Number.isFinite(value)) {
    return { text: "—", className: "sales-orders-print-money sales-orders-print-money--muted" };
  }
  const negative = value < 0;
  return {
    text: formatFinanceCurrency(value),
    className: [
      "sales-orders-print-money",
      negative && negativeTone ? "sales-orders-print-money--risk" : "",
      !negative && negativeTone ? "sales-orders-print-money--strong" : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function percentOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinancePercent(value);
}

function SummaryKpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warning" | "risk" | "info";
}) {
  const cls = tone && tone !== "neutral" ? `sales-orders-print-summary-card--${tone}` : "";
  return (
    <div className={["sales-orders-print-summary-card", cls].filter(Boolean).join(" ")}>
      <p className="sales-orders-print-summary-card-label">{label}</p>
      <p className="sales-orders-print-summary-card-value">{value}</p>
    </div>
  );
}

function shortTaxSource(label: string): string {
  const raw = label.trim().toLowerCase();
  if (raw.startsWith("real")) return "Real";
  if (raw.startsWith("estimado")) return "Estim.";
  if (raw.startsWith("misto")) return "Misto";
  if (raw.startsWith("incompleto")) return "Inc.";
  return label;
}

function RowCells({ row }: { row: SalesOrderIndustrialResultReportRow }) {
  const commercial = moneyOrDash(row.orderCommercialValue);
  const taxes = moneyOrDash(row.totalTaxes);
  const costTotal = moneyOrDash(row.totalIndustrialCost);
  const result = moneyOrDash(row.industrialResult, true);
  const incomplete = !row.includedInConsolidation;
  return (
    <tr className={incomplete ? "sales-orders-industrial-print-row--incomplete" : undefined}>
      <td className="sales-orders-industrial-col-order">{displayFinanceText(row.orderCode)}</td>
      <td className="sales-orders-industrial-col-date">{formatFinanceDate(row.issueDate)}</td>
      <td className="sales-orders-industrial-col-customer">{displayFinanceText(row.customerName)}</td>
      <td className={commercial.className}>{commercial.text}</td>
      <td className={moneyOrDash(row.materialCost).className}>
        {moneyOrDash(row.materialCost).text}
      </td>
      <td className={moneyOrDash(row.laborHourCost).className}>
        {moneyOrDash(row.laborHourCost).text}
      </td>
      <td className={moneyOrDash(row.machineHourCost).className}>
        {moneyOrDash(row.machineHourCost).text}
      </td>
      <td className={moneyOrDash(row.otherIndustrialCost).className}>
        {moneyOrDash(row.otherIndustrialCost).text}
      </td>
      <td className={costTotal.className}>{costTotal.text}</td>
      <td className={taxes.className}>{taxes.text}</td>
      <td className="sales-orders-industrial-col-tax-source">
        {shortTaxSource(row.taxSourceLabel)}
      </td>
      <td className={result.className}>{result.text}</td>
      <td className="sales-orders-print-money sales-orders-industrial-col-margin">
        {percentOrDash(row.industrialMarginPercent)}
      </td>
    </tr>
  );
}

export function SalesOrderIndustrialResultReportPrintDocument({
  payload,
  branding,
}: {
  payload: SalesOrderIndustrialResultReportPayload;
  branding: BrandingSettingsDTO;
}) {
  const s = payload.summary;
  const incompleteNote =
    s.incompleteCostOrdersCount + s.incompleteTaxOrdersCount > 0
      ? ` · ${s.incompleteCostOrdersCount} sem custo · ${s.incompleteTaxOrdersCount} com imposto incompleto (fora da consolidação)`
      : "";

  return (
    <div
      id="sales-orders-print-root"
      className="sales-orders-industrial-print-root"
      data-testid="sales-orders-industrial-result-print-document"
    >
      <SalesOrderIndustrialResultReportPrintCover payload={payload} branding={branding} />

      <section className="sales-orders-print-summary-grid sales-orders-industrial-summary-grid">
        <SummaryKpiCard
          label="Pedidos"
          value={`${formatFinanceInteger(s.completeOrdersCount)} / ${formatFinanceInteger(s.ordersCount)}`}
        />
        <SummaryKpiCard
          label="Valor comercial"
          value={formatFinanceCurrency(s.orderCommercialValueTotal)}
        />
        <SummaryKpiCard
          label="Custo industrial"
          value={formatFinanceCurrency(s.totalIndustrialCostTotal)}
        />
        <SummaryKpiCard
          label="Impostos"
          value={formatFinanceCurrency(s.totalTaxesTotal)}
        />
        <SummaryKpiCard
          label="Resultado industrial"
          value={formatFinanceCurrency(s.industrialResultTotal)}
          tone={s.industrialResultTotal < 0 ? "risk" : "positive"}
        />
        <SummaryKpiCard
          label="Margem industrial"
          value={
            s.industrialMarginPercentConsolidated == null
              ? "—"
              : formatFinancePercent(s.industrialMarginPercentConsolidated)
          }
          tone="info"
        />
      </section>

      <p className="sales-orders-industrial-flow-note">
        Leitura: valor do pedido − impostos − custos (MP + HH + HM + outros) = quanto sobra
        {incompleteNote}.
      </p>

      <table className="sales-orders-print-table sales-orders-industrial-print-table">
        <colgroup>
          <col className="sales-orders-industrial-col-order" />
          <col className="sales-orders-industrial-col-date" />
          <col className="sales-orders-industrial-col-customer" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money-strong" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-tax-source" />
          <col className="sales-orders-industrial-col-money-strong" />
          <col className="sales-orders-industrial-col-margin" />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={3}>Pedido</th>
            <th>Receita</th>
            <th colSpan={5}>Custos industriais</th>
            <th colSpan={2}>Impostos</th>
            <th colSpan={2}>Quanto sobra</th>
          </tr>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Valor</th>
            <th>MP</th>
            <th>HH</th>
            <th>HM</th>
            <th>Outros</th>
            <th>Custo</th>
            <th>Total</th>
            <th>Fonte</th>
            <th>Resultado</th>
            <th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((row) => (
            <RowCells key={row.salesOrderId} row={row} />
          ))}
        </tbody>
      </table>

      {payload.truncated ? (
        <p className="sales-orders-print-disclaimer">
          Exibindo {payload.rows.length} de {payload.totalOrdersInScope} pedidos (limite{" "}
          {payload.rowsLimit}).
        </p>
      ) : null}

      <p className="sales-orders-print-disclaimer">{SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DISCLAIMER}</p>
      <footer className="sales-orders-print-footer">
        <span>{SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_FOOTER_NOTE}</span>
        <span>{formatFinanceDateTime(payload.generatedAt)}</span>
      </footer>
    </div>
  );
}
