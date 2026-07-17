/** Constantes do sync Nomus documentosEstoque (Documentos de Saída). */

export const NOMUS_STOCK_DOCUMENTS_SYNC_TARGET = "stock_documents" as const;
export const NOMUS_STOCK_DOCUMENTS_LOG_PREFIX = "[nomus-stock-documents]";

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
