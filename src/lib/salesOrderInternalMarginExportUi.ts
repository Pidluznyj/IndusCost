/** Helpers de URL para exportação interna de margem (frontend-safe). */

export function getSalesOrderListInternalMarginExportUrl(query = ""): string {
  const qs = query ? `${query}&scope=list` : "scope=list";
  return `/api/sales-orders/export-internal.xlsx?${qs}`;
}

export function getSalesOrderManagementInternalMarginExportUrl(query = ""): string {
  return query
    ? `/api/sales-orders/management/export-internal.xlsx?${query}`
    : "/api/sales-orders/management/export-internal.xlsx";
}

export async function downloadInternalMarginExport(url: string, fallbackFilename: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("export failed");
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
