import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { SalesOrderIndustrialResultReportPrintCover } from "./SalesOrderIndustrialResultReportPrintCover";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { toCivilDateKey } from "@/src/lib/financeCivilDate";
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

/** Data compacta MM/AA (dia civil) para o grid do PDF industrial. */
function formatIndustrialIssueMonthYear(iso: string | null | undefined): string {
  const key = toCivilDateKey(iso);
  if (!key) return "—";
  const [, year, month] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) ?? [];
  if (!year || !month) return "—";
  return `${month}/${year.slice(-2)}`;
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
  // totalTaxes: real da NF quando houver; senão o estimado usado no cálculo de margem.
  const taxes = moneyOrDash(row.totalTaxes);
  const costTotal = moneyOrDash(row.totalIndustrialCost);
  const result = moneyOrDash(row.industrialResult, true);
  const incomplete = !row.includedInConsolidation;
  return (
    <tr className={incomplete ? "sales-orders-industrial-print-row--incomplete" : undefined}>
      <td className="sales-orders-industrial-col-order">{displayFinanceText(row.orderCode)}</td>
      <td className="sales-orders-industrial-col-date">{formatIndustrialIssueMonthYear(row.issueDate)}</td>
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
          label="Total R$ pedidos"
          value={formatFinanceCurrency(s.orderCommercialValueTotal)}
        />
        <SummaryKpiCard
          label="Custo HH R$"
          value={formatFinanceCurrency(s.laborHourCostTotal)}
        />
        <SummaryKpiCard
          label="Custo HM R$"
          value={formatFinanceCurrency(s.machineHourCostTotal)}
        />
        <SummaryKpiCard
          label="Custo MP R$"
          value={formatFinanceCurrency(s.materialCostTotal)}
        />
        <SummaryKpiCard
          label="R$ Imposto"
          value={formatFinanceCurrency(s.totalTaxesTotal)}
        />
        <SummaryKpiCard
          label="Resultado R$"
          value={formatFinanceCurrency(s.industrialResultTotal)}
          tone={s.industrialResultTotal < 0 ? "risk" : "positive"}
        />
        <SummaryKpiCard
          label="Margem %"
          value={
            s.industrialMarginPercentConsolidated == null
              ? "—"
              : formatFinancePercent(s.industrialMarginPercentConsolidated)
          }
          tone="info"
        />
      </section>

      <p className="sales-orders-industrial-flow-note">
        Cabeçalho na sequência: Total R$ pedidos → Custo HH → Custo HM → Custo MP → Imposto →
        Resultado → Margem %. Resultado = pedidos − (HH + HM + MP + outros) − imposto
        {` · ${formatFinanceInteger(s.completeOrdersCount)}/${formatFinanceInteger(s.ordersCount)} consolidados`}
        {incompleteNote}.
      </p>

      <table className="sales-orders-print-table sales-orders-industrial-print-table">
        <colgroup>
          <col className="sales-orders-industrial-col-order" />
          <col className="sales-orders-industrial-col-date" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money" />
          <col className="sales-orders-industrial-col-money-strong" />
          <col className="sales-orders-industrial-col-money-strong" />
          <col className="sales-orders-industrial-col-money-strong" />
          <col className="sales-orders-industrial-col-margin" />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>Pedido</th>
            <th>Receita</th>
            <th colSpan={5}>Custos industriais</th>
            <th>Impostos</th>
            <th colSpan={2}>Quanto sobra</th>
          </tr>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Valor</th>
            <th>MP</th>
            <th>HH</th>
            <th>HM</th>
            <th>Outros</th>
            <th>Custo</th>
            <th>Custo impostos</th>
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
