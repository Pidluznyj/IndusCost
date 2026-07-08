/** Helpers de URL para exportação Comercial de Pedidos de Venda (frontend-safe). */

export function getSalesOrderListReportExportXlsxUrl(query = ""): string {
  return query
    ? `/api/sales-orders/export-report.xlsx?${query}`
    : "/api/sales-orders/export-report.xlsx";
}

export function getSalesOrderListReportExportPdfUrl(query = ""): string {
  return query
    ? `/api/sales-orders/export-report.pdf?${query}`
    : "/api/sales-orders/export-report.pdf";
}

export function getSalesOrderSellerFilterOptionsUrl(query = ""): string {
  return query
    ? `/api/sales-orders/seller-filter-options?${query}`
    : "/api/sales-orders/seller-filter-options";
}

export async function downloadSalesOrderListReportExport(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(message || "export failed");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
