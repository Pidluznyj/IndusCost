import {
  BCB_HTTP_TIMEOUT_MS,
  KnownHostFetchError,
  fetchKnownHostJson,
} from "@/src/lib/company-intelligence/http.js";

export const BCB_SGS_BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

/** Meta Selic definida pelo Copom — SGS 432, % a.a., série diária. */
export const BCB_SGS_SELIC_TARGET = {
  code: 432,
  name: "Meta Selic definida pelo Copom",
  unit: "% a.a.",
} as const;

/** IPCA — variação acumulada em 12 meses — SGS 13522, %, série mensal. */
export const BCB_SGS_IPCA_12M = {
  code: 13522,
  name: "IPCA — variação acumulada em 12 meses",
  unit: "%",
} as const;

type SgsPoint = { data?: unknown; valor?: unknown };

export function parseBcbDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseBcbSgsDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseBcbSgsSeries(json: unknown): { value: number; referenceDate: string } | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  for (let i = json.length - 1; i >= 0; i -= 1) {
    const row = json[i] as SgsPoint;
    const value = parseBcbDecimal(row.valor);
    const referenceDate = parseBcbSgsDate(row.data);
    if (value != null && referenceDate) {
      return { value, referenceDate };
    }
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatBrDate(date: Date): string {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function addDaysUtc(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildBcbSgsUltimosUrl(seriesCode: number, lastN: number): string {
  return `${BCB_SGS_BASE}.${seriesCode}/dados/ultimos/${lastN}?formato=json`;
}

export function buildBcbSgsRangeUrl(
  seriesCode: number,
  startIso: string,
  endIso: string
): string {
  const start = new Date(`${startIso}T12:00:00.000Z`);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  return (
    `${BCB_SGS_BASE}.${seriesCode}/dados?formato=json` +
    `&dataInicial=${encodeURIComponent(formatBrDate(start))}` +
    `&dataFinal=${encodeURIComponent(formatBrDate(end))}`
  );
}

export async function fetchBcbSgsLatest(
  seriesCode: number,
  options: {
    fetchImpl?: typeof fetch;
    todayIso: string;
    lastN?: number;
    rangeDays?: number;
  }
): Promise<{ value: number; referenceDate: string } | null> {
  const lastN = options.lastN ?? 10;
  try {
    const first = await fetchKnownHostJson(buildBcbSgsUltimosUrl(seriesCode, lastN), {
      timeoutMs: BCB_HTTP_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
    });
    if (first.status >= 200 && first.status < 300) {
      const parsed = parseBcbSgsSeries(first.json);
      if (parsed) return parsed;
    }
  } catch (error) {
    if (error instanceof KnownHostFetchError && error.kind === "timeout") {
      return null;
    }
  }

  const rangeDays = options.rangeDays ?? 40;
  const startIso = addDaysUtc(options.todayIso, -rangeDays);
  try {
    const second = await fetchKnownHostJson(
      buildBcbSgsRangeUrl(seriesCode, startIso, options.todayIso),
      {
        timeoutMs: BCB_HTTP_TIMEOUT_MS,
        fetchImpl: options.fetchImpl,
      }
    );
    if (second.status >= 200 && second.status < 300) {
      return parseBcbSgsSeries(second.json);
    }
  } catch {
    return null;
  }
  return null;
}
