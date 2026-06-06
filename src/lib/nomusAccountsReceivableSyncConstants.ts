export const NOMUS_AR_SYNC_SCRIPT_NAME = "runNomusAccountsReceivableSync.sh";
export const NOMUS_AR_SYNC_MODE = "apply" as const;
export const NOMUS_AR_SYNC_CONFIRM_PHRASE = "RODAR CONTAS A RECEBER NOMUS";
export const NOMUS_AR_SYNC_TARGET = "accounts-receivable" as const;

/** Lock dedicado — não compete com rotina diária/pedidos, apenas com outra execução AR. */
export const NOMUS_AR_SYNC_LOCK_FILE =
  process.env.NOMUS_AR_SYNC_LOCK_FILE || "/tmp/induscost-nomus-accounts-receivable.lock";

/** Após 3h sem FINISHED_AT e sem processo, considerar STALE (rotina a cada 2h). */
export const NOMUS_AR_LOG_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

export const NOMUS_AR_RUNNER_LOG_RE =
  /^runner-accounts-receivable_(apply|dry)_.+\.log$/i;
