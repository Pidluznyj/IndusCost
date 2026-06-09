export const NOMUS_NFE_SYNC_SCRIPT_NAME = "runNomusNfesSync.sh";
export const NOMUS_NFE_SYNC_MODE = "apply" as const;
export const NOMUS_NFE_SYNC_CONFIRM_PHRASE = "RODAR NFES NOMUS";
export const NOMUS_NFE_SYNC_TARGET = "nfes" as const;

/** Lock dedicado — não compete com AR/AP/pedidos. */
export const NOMUS_NFE_SYNC_LOCK_FILE =
  process.env.NOMUS_NFE_SYNC_LOCK_FILE || "/tmp/induscost-nomus-nfes.lock";

/** Após 3h sem FINISHED_AT e sem processo, considerar STALE (rotina a cada 2h). */
export const NOMUS_NFE_LOG_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

export const NOMUS_NFE_RUNNER_LOG_RE = /^runner-nfes_(apply|dry)_.+\.log$/i;
