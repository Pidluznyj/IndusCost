/** Consulta DataJud por processo conhecido. Descoberta por CNPJ permanece bloqueada. */

export const DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON = "DATAJUD_CNPJ_DISCOVERY_PENDING_PROBE";

export const DATAJUD_DEFAULT_MIN_REQUEST_INTERVAL_MS = 1500;
export const DATAJUD_MIN_REQUEST_INTERVAL_FLOOR_MS = 500;
export const DATAJUD_MIN_REQUEST_INTERVAL_CEILING_MS = 10_000;

export function clampDatajudMinRequestIntervalMs(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DATAJUD_DEFAULT_MIN_REQUEST_INTERVAL_MS), 10);
  if (!Number.isFinite(parsed)) return DATAJUD_DEFAULT_MIN_REQUEST_INTERVAL_MS;
  return Math.min(
    DATAJUD_MIN_REQUEST_INTERVAL_CEILING_MS,
    Math.max(DATAJUD_MIN_REQUEST_INTERVAL_FLOOR_MS, parsed)
  );
}

export function datajudRateLimitWaitMs(
  retryAfterSeconds: number | null | undefined,
  intervalMs: number
): number {
  const retryMs = Math.max(0, Number(retryAfterSeconds ?? 0) * 1000);
  return Math.max(retryMs, intervalMs);
}

/** Timeout só do DataJud. DJEN, Domicílio e o restante do Exposure continuam em 15s. */
export const DATAJUD_HTTP_TIMEOUT_MS = 90_000;

export function assertDatajudCnpjDiscoveryBlocked(): never {
  throw new Error(DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON);
}

export function datajudProbeConfirmation(
  argv: readonly string[]
): { ok: true } | { ok: false; reason: string } {
  if (!argv.includes("--confirm-probe=DATAJUD_PROBE")) {
    return { ok: false, reason: "COMANDO DO PROBE DATAJUD NAO EXECUTADO" };
  }
  return { ok: true };
}

export function buildDatajudProcessQuery(processNumberNormalized: string): {
  size: number;
  track_total_hits: false;
  query: { match: { numeroProcesso: string } };
} {
  return {
    size: 20,
    track_total_hits: false,
    query: { match: { numeroProcesso: processNumberNormalized } },
  };
}
