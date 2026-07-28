/**
 * Configuração do espelho via env — sem hardcode de secrets.
 */

export type MaterialStockSpreadsheetMirrorConfig = {
  enabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  allowedHosts: string[];
  httpTimeoutMs: number;
  maxAttempts: number;
  workerIntervalMs: number;
  workerBatchSize: number;
};

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(v)) return true;
  if (["false", "0", "off", "no"].includes(v)) return false;
  return defaultValue;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return ["logic.azure.com", "api.powerautomate.com"];
  }
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function readMaterialStockSpreadsheetMirrorConfig(
  env: NodeJS.ProcessEnv = process.env
): MaterialStockSpreadsheetMirrorConfig {
  const webhookUrl = env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_URL?.trim() || null;
  const webhookSecret =
    env.MATERIAL_STOCK_SPREADSHEET_WEBHOOK_SECRET?.trim() || null;
  return {
    enabled: parseBool(env.MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED, false),
    webhookUrl,
    webhookSecret,
    allowedHosts: parseAllowedHosts(
      env.MATERIAL_STOCK_SPREADSHEET_ALLOWED_HOSTS
    ),
    httpTimeoutMs: parsePositiveInt(
      env.MATERIAL_STOCK_SPREADSHEET_HTTP_TIMEOUT_MS,
      15_000
    ),
    maxAttempts: parsePositiveInt(
      env.MATERIAL_STOCK_SPREADSHEET_MAX_ATTEMPTS,
      5
    ),
    workerIntervalMs: parsePositiveInt(
      env.MATERIAL_STOCK_SPREADSHEET_WORKER_INTERVAL_MS,
      5_000
    ),
    workerBatchSize: parsePositiveInt(
      env.MATERIAL_STOCK_SPREADSHEET_WORKER_BATCH_SIZE,
      5
    ),
  };
}
