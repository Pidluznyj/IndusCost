export type CnpjWeeklyRefreshConfig = {
  enabled: boolean;
  minIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  circuitFailureThreshold: number;
  circuitPauseMs: number;
  heartbeatStaleMs: number;
  maxItems: number | null;
};

function flag(value: string | undefined): boolean {
  const raw = value?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function readCnpjWeeklyRefreshConfig(
  env: NodeJS.ProcessEnv = process.env
): CnpjWeeklyRefreshConfig {
  const maxRaw = env.CNPJ_WEEKLY_REFRESH_MAX_ITEMS?.trim();
  const maxParsed = maxRaw ? Number(maxRaw) : null;
  return {
    enabled: flag(env.CNPJ_WEEKLY_REFRESH_ENABLED),
    minIntervalMs: positiveInt(env.CNPJ_WEEKLY_REFRESH_MIN_INTERVAL_MS, 3_000),
    timeoutMs: Math.max(1_000, positiveInt(env.CNPJ_WEEKLY_REFRESH_TIMEOUT_MS, 15_000)),
    maxRetries: positiveInt(env.CNPJ_WEEKLY_REFRESH_MAX_RETRIES, 3),
    backoffBaseMs: Math.max(100, positiveInt(env.CNPJ_WEEKLY_REFRESH_BACKOFF_MS, 1_000)),
    backoffCapMs: Math.max(1_000, positiveInt(env.CNPJ_WEEKLY_REFRESH_BACKOFF_CAP_MS, 60_000)),
    circuitFailureThreshold: Math.max(1, positiveInt(env.CNPJ_WEEKLY_REFRESH_CIRCUIT_THRESHOLD, 5)),
    circuitPauseMs: Math.max(1_000, positiveInt(env.CNPJ_WEEKLY_REFRESH_CIRCUIT_PAUSE_MS, 60_000)),
    heartbeatStaleMs: Math.max(30_000, positiveInt(env.CNPJ_WEEKLY_REFRESH_HEARTBEAT_STALE_MS, 180_000)),
    maxItems: maxParsed != null && Number.isFinite(maxParsed) && maxParsed > 0 ? Math.floor(maxParsed) : null,
  };
}

export function sanitizeCnpjRefreshError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Falha na consulta cadastral.";
  return message.replace(/\d{11,14}/g, "[documento]").slice(0, 300);
}
