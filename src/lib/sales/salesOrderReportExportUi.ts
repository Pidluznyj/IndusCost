/**
 * Helpers frontend-safe do Relatório Comercial > Pedidos de Venda.
 * Espelha o padrão de `salesOrderListReportExportUi.ts`, mas sem duplicar rotas.
 */
import { salesOrderReportExportFilename } from "./salesOrderReport.js";

export function getSalesOrderReportPayloadUrl(query = ""): string {
  return query
    ? `/api/sales-orders/report?${query}`
    : "/api/sales-orders/report";
}

export function getSalesOrderReportXlsxUrl(query = ""): string {
  return query
    ? `/api/sales-orders/report/export.xlsx?${query}`
    : "/api/sales-orders/report/export.xlsx";
}

export async function downloadSalesOrderReportXlsx(
  url: string,
  customerName: string | null | undefined
): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(message || "export failed");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename =
    match?.[1] ??
    salesOrderReportExportFilename({ format: "xlsx", customerName });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
