/** Helpers de URL para exportação Comercial > Clientes (frontend-safe). */

export const CUSTOMER_LIST_EXPORT_XLSX_PATH = "/api/customers/export-report.xlsx";
export const CUSTOMER_LIST_EXPORT_PDF_PATH = "/api/customers/export-report.pdf";

export function buildCustomerListExportQuery(input: {
  search?: string;
  commercialOwner?: string;
}): string {
  const params = new URLSearchParams();
  const search = input.search?.trim() ?? "";
  const owner = input.commercialOwner?.trim() ?? "";
  if (search) params.set("search", search);
  if (owner) params.set("commercialOwner", owner);
  return params.toString();
}

export function getCustomerListReportExportXlsxUrl(query = ""): string {
  return query ? `${CUSTOMER_LIST_EXPORT_XLSX_PATH}?${query}` : CUSTOMER_LIST_EXPORT_XLSX_PATH;
}

export function getCustomerListReportExportPdfUrl(query = ""): string {
  return query ? `${CUSTOMER_LIST_EXPORT_PDF_PATH}?${query}` : CUSTOMER_LIST_EXPORT_PDF_PATH;
}

export async function downloadCustomerListReportExport(
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
