export type DjenSearchQuery = {
  nomeParte?: string;
  numeroProcesso?: string;
  pagina?: number;
  itensPorPagina?: number;
};

export const DJEN_EMPTY_QUERY_MESSAGE = "DJEN exige nomeParte ou numeroProcesso.";
export const DJEN_DEFAULT_PAGE_SIZE = 20;
export const DJEN_DEFAULT_MAX_PAGES = 5;
export const DJEN_MAX_PAGES_CEILING = 20;
export const DJEN_DEFAULT_MIN_REQUEST_INTERVAL_MS = 1500;
export const DJEN_MIN_REQUEST_INTERVAL_FLOOR_MS = 500;
export const DJEN_MIN_REQUEST_INTERVAL_CEILING_MS = 10_000;

export function hasDjenSearchFilter(query: {
  nomeParte?: string;
  numeroProcesso?: string;
}): boolean {
  return Boolean(query.nomeParte?.trim() || query.numeroProcesso?.trim());
}

export function clampDjenMaxPages(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DJEN_DEFAULT_MAX_PAGES), 10);
  if (!Number.isFinite(parsed)) return DJEN_DEFAULT_MAX_PAGES;
  return Math.min(DJEN_MAX_PAGES_CEILING, Math.max(1, parsed));
}

export function clampDjenMinRequestIntervalMs(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DJEN_DEFAULT_MIN_REQUEST_INTERVAL_MS), 10);
  if (!Number.isFinite(parsed)) return DJEN_DEFAULT_MIN_REQUEST_INTERVAL_MS;
  return Math.min(
    DJEN_MIN_REQUEST_INTERVAL_CEILING_MS,
    Math.max(DJEN_MIN_REQUEST_INTERVAL_FLOOR_MS, parsed)
  );
}

export function djenRateLimitWaitMs(
  retryAfterSeconds: number | null | undefined,
  intervalMs: number
): number {
  const retryMs = Math.max(0, Number(retryAfterSeconds ?? 0) * 1000);
  return Math.max(retryMs, intervalMs);
}

/** Próxima página só com metadados reais: `count` do payload ou página cheia de `items`. */
export function djenHasNextPage(input: {
  pagina: number;
  itensPorPagina: number;
  itemCount: number;
  totalCount: number | null;
}): boolean {
  if (input.itemCount <= 0) return false;
  if (input.totalCount != null && Number.isFinite(input.totalCount)) {
    return input.pagina * input.itensPorPagina < input.totalCount;
  }
  return input.itemCount >= input.itensPorPagina;
}
