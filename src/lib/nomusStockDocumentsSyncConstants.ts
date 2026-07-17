/** Constantes do sync Nomus documentosEstoque (Documentos de Saída). */

export const NOMUS_STOCK_DOCUMENTS_SYNC_TARGET = "stock-documents" as const;
/** Alias legado em IntegrationRun (DS-03.5). */
export const NOMUS_STOCK_DOCUMENTS_SYNC_TARGET_LEGACY = "stock_documents" as const;

export const NOMUS_STOCK_DOCUMENTS_LOG_PREFIX = "[nomus-stock-documents]";

export const NOMUS_STOCK_DOCUMENTS_SYNC_SCRIPT_NAME = "runNomusStockDocumentsSync.sh";
export const NOMUS_STOCK_DOCUMENTS_SYNC_MODE = "apply" as const;

/** Cadência oficial alinhada a NF-e/AR (2h), com offset próprio. */
export const NOMUS_STOCK_DOCUMENTS_SCHEDULE_HINT =
  "cron: 23 */2 * * * (a cada 2 horas; offset dos syncs NF-e/AR)";

/** Overlap da janela incremental (dias) — não é backfill. */
export const NOMUS_STOCK_DOCUMENTS_INCREMENTAL_OVERLAP_DAYS = 7;
/** Lookback inicial quando não há checkpoint. */
export const NOMUS_STOCK_DOCUMENTS_INCREMENTAL_LOOKBACK_DAYS = 14;

export const NOMUS_STOCK_DOCUMENTS_LOG_STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

export const NOMUS_STOCK_DOCUMENTS_RUNNER_LOG_RE =
  /^runner-stock-documents_(preview|apply|dry)_.+\.log$/i;

export const NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE_DEFAULT =
  process.env.NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE ||
  "/tmp/induscost-nomus-stock-documents.lock";

export const NOMUS_STOCK_DOCUMENTS_SYNC_CHECKPOINT_FILE_DEFAULT =
  process.env.NOMUS_STOCK_DOCUMENTS_SYNC_CHECKPOINT_FILE ||
  "/tmp/induscost-nomus-stock-documents.checkpoint.json";

export function resolveStockDocumentsSyncLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromEnv = (env.NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE ?? "").trim();
  return fromEnv || NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE_DEFAULT;
}

export function resolveStockDocumentsSyncCheckpointFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromEnv = (env.NOMUS_STOCK_DOCUMENTS_SYNC_CHECKPOINT_FILE ?? "").trim();
  return fromEnv || NOMUS_STOCK_DOCUMENTS_SYNC_CHECKPOINT_FILE_DEFAULT;
}

export function isStockDocumentsIncrementalEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (env.NOMUS_STOCK_DOCUMENTS_INCREMENTAL ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
