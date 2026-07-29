export function getSalesOrderCommercialDiscountReportUrl(query?: string): string {
  return query
    ? `/api/sales-orders/reports/commercial-discounts?${query}`
    : "/api/sales-orders/reports/commercial-discounts";
}

export function getSalesOrderCommercialDiscountCsvUrl(query?: string): string {
  return query
    ? `/api/sales-orders/reports/commercial-discounts/export.csv?${query}`
    : "/api/sales-orders/reports/commercial-discounts/export.csv";
}

export function getSalesOrderCommercialDiscountXlsxUrl(query?: string): string {
  return query
    ? `/api/sales-orders/reports/commercial-discounts/export.xlsx?${query}`
    : "/api/sales-orders/reports/commercial-discounts/export.xlsx";
}
