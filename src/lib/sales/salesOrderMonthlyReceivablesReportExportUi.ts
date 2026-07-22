/** Helpers frontend-safe — URLs do relatório de recebíveis mensais. */
export function getSalesOrderMonthlyReceivablesReportUrl(query = ""): string {
  return query
    ? `/api/sales-orders/reports/monthly-receivables?${query}`
    : "/api/sales-orders/reports/monthly-receivables";
}

export function getSalesOrderMonthlyReceivablesDetailUrl(query = ""): string {
  return query
    ? `/api/sales-orders/reports/monthly-receivables/detail?${query}`
    : "/api/sales-orders/reports/monthly-receivables/detail";
}

export function getSalesOrderMonthlyReceivablesXlsxUrl(query = ""): string {
  return query
    ? `/api/sales-orders/reports/monthly-receivables/export.xlsx?${query}`
    : "/api/sales-orders/reports/monthly-receivables/export.xlsx";
}

export function getSalesOrderMonthlyReceivablesPdfPayloadUrl(query = ""): string {
  return query
    ? `/api/sales-orders/reports/monthly-receivables/export.pdf?${query}`
    : "/api/sales-orders/reports/monthly-receivables/export.pdf";
}
