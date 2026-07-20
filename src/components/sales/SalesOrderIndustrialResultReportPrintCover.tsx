import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import {
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DATA_SOURCE,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DOCUMENT_HIGHLIGHT,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DOCUMENT_TITLE,
  SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_SUBTITLE,
} from "@/src/lib/sales/salesOrderIndustrialResultReportPrintMeta";
import type { SalesOrderIndustrialResultReportPayload } from "@/src/lib/sales/salesOrderIndustrialResultReport";

export function SalesOrderIndustrialResultReportPrintCover({
  payload,
  branding,
}: {
  payload: SalesOrderIndustrialResultReportPayload;
  branding: BrandingSettingsDTO;
}) {
  const customerLabel = payload.filters.customerName?.trim() || null;
  const emitterName = payload.emitterName?.trim() || "—";
  const filterLines = payload.filterLabels
    .map((line) => `${line.label}: ${line.value}`)
    .join(" · ");

  const metaLines = useMemo(() => {
    const lines = [
      { label: "Emitido em", value: formatFinanceDateTime(payload.generatedAt) },
      { label: "Emitido por", value: emitterName },
      {
        label: "Pedidos",
        value: formatFinanceInteger(payload.summary.ordersCount),
      },
      {
        label: "Completos",
        value: formatFinanceInteger(payload.summary.completeOrdersCount),
      },
      { label: "Origem", value: SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DATA_SOURCE },
    ];
    lines.unshift({
      label: "Cliente",
      value: customerLabel || "Todos",
    });
    return lines;
  }, [
    customerLabel,
    emitterName,
    payload.generatedAt,
    payload.summary.ordersCount,
    payload.summary.completeOrdersCount,
  ]);

  return (
    <div className="sales-orders-print-cover">
      <PrintHeader
        branding={branding}
        documentTitle={SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DOCUMENT_TITLE}
        documentHighlight={SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_DOCUMENT_HIGHLIGHT}
        metaLines={metaLines}
        subtitle={SALES_ORDER_INDUSTRIAL_RESULT_REPORT_PRINT_SUBTITLE}
        className="sales-orders-print-doc-header"
      />

      {filterLines ? (
        <div className="sales-orders-print-filter-band">
          <p className="sales-orders-print-filter-band-label">Filtros aplicados</p>
          <p className="sales-orders-print-filter-band-value">{filterLines}</p>
        </div>
      ) : null}
    </div>
  );
}
