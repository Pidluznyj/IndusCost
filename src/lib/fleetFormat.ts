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
