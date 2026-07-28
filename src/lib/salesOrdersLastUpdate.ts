export const SALES_ORDERS_LAST_UPDATE_PATH = "/api/sales-orders/last-update";

export type SalesOrdersLastUpdateResponse = {
  lastUpdatedAt: string | null;
};

export function isSalesOrdersLastUpdatePath(pathname: string): boolean {
  return pathname === SALES_ORDERS_LAST_UPDATE_PATH;
}

export function resolveSalesOrdersLastUpdatedAt(
  candidates: Array<Date | string | null | undefined>,
): string | null {
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const ms =
      candidate instanceof Date
        ? candidate.getTime()
        : new Date(candidate).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms > maxMs) maxMs = ms;
  }
  if (!Number.isFinite(maxMs)) return null;
  return new Date(maxMs).toISOString();
}

export function formatSalesOrdersLastUpdatedAtLabel(
  value: string | Date | null | undefined,
): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(date);
  return `Última atualização: ${formatted}`;
}
