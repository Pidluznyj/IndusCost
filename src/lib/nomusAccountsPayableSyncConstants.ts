export const NOMUS_AP_SYNC_SCRIPT_NAME = "runNomusAccountsPayableSync.sh";
export const NOMUS_AP_SYNC_MODE = "apply" as const;
export const NOMUS_AP_SYNC_CONFIRM_PHRASE = "RODAR CONTAS A PAGAR NOMUS";
export const NOMUS_AP_SYNC_TARGET = "accounts-payable" as const;

/** Lock dedicado — não compete com rotina diária/pedidos, apenas com outra execução AP. */
export const NOMUS_AP_SYNC_LOCK_FILE =
  process.env.NOMUS_AP_SYNC_LOCK_FILE || "/tmp/induscost-nomus-accounts-payable.lock";

/** Após 3h sem FINISHED_AT e sem processo, considerar STALE (rotina a cada 2h). */
export const NOMUS_AP_LOG_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

export const NOMUS_AP_RUNNER_LOG_RE =
  /^runner-accounts-payable_(apply|dry)_.+\.log$/i;
