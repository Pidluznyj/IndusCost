/** Paginação e filtros padronizados para listagens da frota. */

export const FLEET_LIST_DEFAULT_LIMIT = 50;
export const FLEET_LIST_MAX_LIMIT = 200;

export type FleetListSortOrder = "asc" | "desc";

export type FleetListQuery = {
  page: number;
  limit: number;
  skip: number;
  search: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  vehicleId: string;
  driverId: string;
  unit: string;
  costCenter: string;
  origin: string;
  sortBy: string;
  sortOrder: FleetListSortOrder;
};

export type FleetListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function parseFleetListLimit(
  raw: unknown,
  fallback = FLEET_LIST_DEFAULT_LIMIT
): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), FLEET_LIST_MAX_LIMIT);
}

export function parseFleetListPage(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function parseFleetListDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFleetListDateRange(query: Record<string, unknown>): {
  startDate: Date | null;
  endDate: Date | null;
} {
  const startDate =
    parseFleetListDate(query.startDate) ??
    parseFleetListDate(query.start) ??
    null;
  let endDate =
    parseFleetListDate(query.endDate) ?? parseFleetListDate(query.end) ?? null;
  if (endDate) {
    const endRaw = String(query.endDate ?? query.end ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
      endDate = new Date(endDate);
      endDate.setHours(23, 59, 59, 999);
    }
  }
  return { startDate, endDate };
}

export function parseFleetListQuery(query: Record<string, unknown>): FleetListQuery {
  const page = parseFleetListPage(query.page);
  const limit = parseFleetListLimit(query.limit);
  const { startDate, endDate } = parseFleetListDateRange(query);
  const sortOrderRaw = String(query.sortOrder ?? query.order ?? "desc").trim().toLowerCase();
  const sortOrder: FleetListSortOrder = sortOrderRaw === "asc" ? "asc" : "desc";

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    search: String(query.search ?? "").trim(),
    status: String(query.status ?? "").trim(),
    startDate,
    endDate,
    vehicleId: String(query.vehicleId ?? "").trim(),
    driverId: String(query.driverId ?? "").trim(),
    unit: String(query.unit ?? "").trim(),
    costCenter: String(query.costCenter ?? "").trim(),
    origin: String(query.origin ?? "").trim(),
    sortBy: String(query.sortBy ?? query.sort ?? "").trim(),
    sortOrder,
  };
}

export function fleetListMeta(total: number, page: number, limit: number): FleetListMeta {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return { page, limit, total, totalPages };
}

/** Resposta paginada com chave legada (vehicles, drivers, …) + items. */
export function buildFleetListResponse<T>(
  legacyKey: string,
  items: T[],
  meta: FleetListMeta
): Record<string, unknown> {
  return {
    [legacyKey]: items,
    items,
    page: meta.page,
    limit: meta.limit,
    total: meta.total,
    totalPages: meta.totalPages,
  };
}

export function applyDateRangeToField(
  field: "costDate" | "openedAt" | "infractionDate" | "incidentDate" | "fuelingDate" | "startDateTime",
  startDate: Date | null,
  endDate: Date | null
): Record<string, Date> | undefined {
  if (!startDate && !endDate) return undefined;
  const range: Record<string, Date> = {};
  if (startDate) range.gte = startDate;
  if (endDate) range.lte = endDate;
  return Object.keys(range).length ? range : undefined;
}

export function paginateInMemory<T>(rows: T[], page: number, limit: number): {
  items: T[];
  meta: FleetListMeta;
} {
  const total = rows.length;
  const meta = fleetListMeta(total, page, limit);
  const skip = (page - 1) * limit;
  return { items: rows.slice(skip, skip + limit), meta };
}
