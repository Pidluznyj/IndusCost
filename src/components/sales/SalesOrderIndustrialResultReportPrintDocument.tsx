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

function RowCells({ row }: { row: SalesOrderIndustrialResultReportRow }) {
  const commercial = moneyOrDash(row.orderCommercialValue);
  const result = moneyOrDash(row.industrialResult, true);
  const incomplete = !row.includedInConsolidation;
  return (
    <tr className={incomplete ? "sales-orders-industrial-print-row--incomplete" : undefined}>
      <td>{displayFinanceText(row.orderCode)}</td>
      <td>{formatFinanceDate(row.issueDate)}</td>
      <td>{displayFinanceText(row.customerName)}</td>
      <td>{displayFinanceText(row.sellerName)}</td>
      <td>{displayFinanceText(row.orderStatusLabel)}</td>
      <td>{displayFinanceText(row.invoiceStatusLabel)}</td>
      <td className={commercial.className}>{commercial.text}</td>
      <td className={moneyOrDash(row.revenueAfterTaxes).className}>
        {moneyOrDash(row.revenueAfterTaxes).text}
      </td>
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
      <td className={moneyOrDash(row.totalIndustrialCost).className}>
        {moneyOrDash(row.totalIndustrialCost).text}
      </td>
      <td className={moneyOrDash(row.icms).className}>{moneyOrDash(row.icms).text}</td>
      <td className={moneyOrDash(row.ipi).className}>{moneyOrDash(row.ipi).text}</td>
      <td className={moneyOrDash(row.pis).className}>{moneyOrDash(row.pis).text}</td>
      <td className={moneyOrDash(row.cofins).className}>{moneyOrDash(row.cofins).text}</td>
      <td className={moneyOrDash(row.icmsSt).className}>{moneyOrDash(row.icmsSt).text}</td>
      <td className={moneyOrDash(row.difal).className}>{moneyOrDash(row.difal).text}</td>
      <td className={moneyOrDash(row.fcp).className}>{moneyOrDash(row.fcp).text}</td>
      <td className={moneyOrDash(row.otherTaxes).className}>
        {moneyOrDash(row.otherTaxes).text}
      </td>
      <td className={moneyOrDash(row.totalTaxes).className}>
        {moneyOrDash(row.totalTaxes).text}
      </td>
      <td>{displayFinanceText(row.taxSourceLabel)}</td>
      <td className={result.className}>{result.text}</td>
      <td className="sales-orders-print-money">{percentOrDash(row.industrialMarginPercent)}</td>
      <td>{displayFinanceText(row.costSourceStatusLabel)}</td>
      <td>{displayFinanceText(row.costTableVersionLabel ?? "—")}</td>
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
  return (
    <div
      id="sales-orders-print-root"
      className="sales-orders-industrial-print-root"
      data-testid="sales-orders-industrial-result-print-document"
    >
      <SalesOrderIndustrialResultReportPrintCover payload={payload} branding={branding} />

      <section className="sales-orders-print-summary-grid">
        <SummaryKpiCard label="Pedidos" value={formatFinanceInteger(s.ordersCount)} />
        <SummaryKpiCard
          label="Completos"
          value={formatFinanceInteger(s.completeOrdersCount)}
          tone="positive"
        />
        <SummaryKpiCard
          label="Custo incompleto"
          value={formatFinanceInteger(s.incompleteCostOrdersCount)}
          tone={s.incompleteCostOrdersCount > 0 ? "warning" : "neutral"}
        />
        <SummaryKpiCard
          label="Imposto incompleto"
          value={formatFinanceInteger(s.incompleteTaxOrdersCount)}
          tone={s.incompleteTaxOrdersCount > 0 ? "warning" : "neutral"}
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
          label="Total impostos"
          value={formatFinanceCurrency(s.totalTaxesTotal)}
        />
        <SummaryKpiCard
          label="Receita após impostos"
          value={formatFinanceCurrency(s.revenueAfterTaxesTotal)}
          tone="info"
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

      <table className="sales-orders-print-table sales-orders-industrial-print-table">
        <thead>
          <tr>
            <th colSpan={6}>Identificação</th>
            <th colSpan={2}>Receita</th>
            <th colSpan={5}>Custos</th>
            <th colSpan={10}>Impostos</th>
            <th colSpan={2}>Resultado</th>
            <th colSpan={2}>Rastreabilidade</th>
          </tr>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Vendedor</th>
            <th>Situação</th>
            <th>NF</th>
            <th>Valor pedido</th>
            <th>Receita após imp.</th>
            <th>MP</th>
            <th>HH</th>
            <th>HM</th>
            <th>Outros</th>
            <th>Custo total</th>
            <th>ICMS</th>
            <th>IPI</th>
            <th>PIS</th>
            <th>COFINS</th>
            <th>ICMS-ST</th>
            <th>DIFAL</th>
            <th>FCP</th>
            <th>Outros imp.</th>
            <th>Total imp.</th>
            <th>Fonte</th>
            <th>Resultado ind.</th>
            <th>Margem %</th>
            <th>Fonte custo</th>
            <th>Versão</th>
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
