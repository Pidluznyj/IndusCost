/**
 * Helpers frontend-safe do PDF Resultado Industrial.
 */
export function getSalesOrderIndustrialResultReportPayloadUrl(query = ""): string {
  return query
    ? `/api/sales-orders/industrial-result-report?${query}`
    : "/api/sales-orders/industrial-result-report";
}
