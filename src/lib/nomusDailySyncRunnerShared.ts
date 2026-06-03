/** Helpers compartilhados runner + testes (sem I/O). */

export const DAILY_LOG_RE = /^runner-daily-(apply|dry)_.+\.log$/i;

/** Idade máxima (legado) — inferência por log isolado não marca mais "rodando". */
export const DAILY_LOG_STALE_RUNNING_MS = 12 * 60 * 60 * 1000;

export function isDailyRunnerLogFileName(fileName: string): boolean {
  return DAILY_LOG_RE.test(fileName);
}

export function isProcessActiveFromPgrepStatus(status: number | null | undefined): boolean {
  return status === 0;
}

export function isGlobalNomusSyncLockHeldFromFlockProbe(
  flockExitStatus: number | null | undefined
): boolean {
  if (flockExitStatus == null) return false;
  return flockExitStatus !== 0;
}

export function shouldInferDailyRunningFromLog(
  parsed: { status: string },
  logAgeMs: number,
  maxAgeMs: number = DAILY_LOG_STALE_RUNNING_MS
): boolean {
  if (logAgeMs > maxAgeMs) return false;
  return parsed.status === "running";
}
