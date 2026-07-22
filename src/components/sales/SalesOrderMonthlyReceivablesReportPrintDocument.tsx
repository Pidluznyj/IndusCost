import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE,
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE,
  type SalesOrderMonthlyReceivablesReportPayload,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReport";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.005) return "—";
  return formatFinanceCurrency(value);
}

export function SalesOrderMonthlyReceivablesReportPrintDocument({
  payload,
  branding,
}: {
  payload: SalesOrderMonthlyReceivablesReportPayload;
  branding: BrandingSettingsDTO | null;
}) {
  const monthKeys = useMemo(
    () => payload.period.months.map((m) => m.key),
    [payload.period.months]
  );

  return (
    <div
      id="sales-orders-print-root"
      className="sales-orders-print-root sales-orders-receivables-print-route"
    >
      <PrintHeader
        branding={branding}
        title={SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE}
        subtitle={SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE}
      />

      <p className="sales-orders-print-meta">
        Gerado em {formatFinanceDateTime(payload.generatedAt)}
        {payload.emitterName ? ` · ${payload.emitterName}` : ""}
        {" · "}
        Vencimento {payload.period.startMonth} — {payload.period.endMonth}
      </p>

      {payload.filterLabels.length > 0 ? (
        <p className="sales-orders-print-filters">
          {payload.filterLabels.map((f) => `${f.label}: ${f.value}`).join(" · ")}
        </p>
      ) : null}

      <table className="sales-orders-print-table sales-orders-receivables-print-table">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente</th>
            <th>Valor pedido</th>
            <th>Agenda efetiva</th>
            <th>Diferença</th>
            <th>Qualidade</th>
            {payload.period.months.map((m) => (
              <th key={m.key} className="sales-orders-receivables-col-month">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((row) => (
            <tr key={row.salesOrderId}>
              <td className="sales-orders-receivables-col-order">
                {displayFinanceText(row.orderCode)}
              </td>
              <td className="sales-orders-receivables-col-customer">
                {displayFinanceText(row.customerName)}
              </td>
              <td className="sales-orders-print-money">{money(row.orderCommercialTotal)}</td>
              <td className="sales-orders-print-money">{money(row.effectiveScheduleTotal)}</td>
              <td className="sales-orders-print-money">{money(row.difference)}</td>
              <td className="sales-orders-receivables-col-quality">{row.qualityStatusLabel}</td>
              {monthKeys.map((key) => (
                <td
                  key={key}
                  className="sales-orders-print-money sales-orders-receivables-col-month"
                >
                  {money(row.months[key]?.amount ?? 0)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="sales-orders-receivables-print-totals-row">
            <td colSpan={2}>Totais ({formatFinanceInteger(payload.totals.orderCount)} pedidos)</td>
            <td className="sales-orders-print-money">{money(payload.totals.orderCommercialTotal)}</td>
            <td className="sales-orders-print-money">{money(payload.totals.effectiveScheduleTotal)}</td>
            <td className="sales-orders-print-money">{money(payload.totals.difference)}</td>
            <td />
            {monthKeys.map((key) => (
              <td key={key} className="sales-orders-print-money sales-orders-receivables-col-month">
                {money(payload.totals.monthly[key]?.amount ?? 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {payload.truncated ? (
        <p className="sales-orders-print-disclaimer">
          Exibindo {payload.rows.length} de {payload.totalOrdersInScope} pedidos (limite{" "}
          {payload.rowsLimit}).
        </p>
      ) : null}

      {payload.warnings.length > 0 ? (
        <p className="sales-orders-print-disclaimer">{payload.warnings.join(" · ")}</p>
      ) : null}

      <footer className="sales-orders-print-footer">
        <span>Agenda financeira efetiva (FIN-05/FIN-08) — somente leitura</span>
        <span>{formatFinanceDateTime(payload.generatedAt)}</span>
      </footer>
    </div>
  );
}
