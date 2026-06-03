/** Valores seguros para células de tabela (sem NaN/undefined). */
export function fleetSafeCell(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  return String(value);
}

export function formatFleetDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

export function formatFleetDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatFleetMoney(
  value: number | null | undefined,
  options?: { masked?: boolean; canView?: boolean }
): string {
  if (options?.masked || options?.canView === false) return "••••••";
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatFleetKm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} km`;
}

export function normalizeFleetList<T>(data: T[] | null | undefined): T[] {
  return Array.isArray(data) ? data : [];
}

export type FleetPaginatedMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** Lê items da resposta paginada ou chave legada (vehicles, drivers, …). */
export function pickFleetListItems<T>(
  data: Record<string, unknown> | null | undefined,
  legacyKey: string
): T[] {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items as T[];
  const legacy = data[legacyKey];
  if (Array.isArray(legacy)) return legacy as T[];
  return [];
}

export function pickFleetPagination(
  data: Record<string, unknown> | null | undefined
): FleetPaginatedMeta | null {
  if (!data || typeof data.total !== "number" || typeof data.page !== "number") return null;
  return {
    page: Number(data.page),
    limit: Number(data.limit ?? 50),
    total: Number(data.total),
    totalPages: Number(data.totalPages ?? 1),
  };
}
