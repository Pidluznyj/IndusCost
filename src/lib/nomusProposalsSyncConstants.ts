/**
 * Constantes do sync horário de Propostas Nomus.
 *
 * Propostas já sincroniza diariamente (02:00) via `runNomusDailySync.sh` →
 * `nomusSyncOrchestrator.ts` → `sync:nomus:proposals:apply`. Esta rotina
 * horária reutiliza o mesmo serviço oficial (`scripts/nomusProposalsSyncV1.ts`);
 * não é um segundo motor de sincronização.
 */

export const NOMUS_PROPOSALS_LOG_PREFIX = "[nomus-proposals]";

export const NOMUS_PROPOSALS_SYNC_TARGET = "proposals" as const;

export const NOMUS_PROPOSALS_SYNC_LOCK_ENV = "NOMUS_PROPOSALS_SYNC_LOCK_FILE";

/** Lock dedicado: serializa qualquer execução do sync de propostas (CLI, orquestrador diário, cron horário). */
export const NOMUS_PROPOSALS_SYNC_LOCK_FILE_DEFAULT = "/tmp/induscost-nomus-proposals.lock";

export const NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK_ENV = "NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK";

export const NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS_ENV =
  "NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS";

/** 45 min — tempo máximo que o cron horário espera o lock global Nomus liberar antes de desistir (WAIT_TIMEOUT). */
export const NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS_DEFAULT = 2700;

export const NOMUS_PROPOSALS_HOURLY_WAITER_LOCK_ENV =
  "NOMUS_PROPOSALS_HOURLY_WAITER_LOCK_FILE";

/**
 * Lock EXCLUSIVO do runner horário — só impede dois "waiters" simultâneos
 * (dois crons de minuto 37 disparando em horas adjacentes enquanto o
 * primeiro ainda aguarda o global). Não protege dados, não é usado pelo
 * sync diário nem pelo CLI direto fora do fluxo de espera.
 */
export const NOMUS_PROPOSALS_HOURLY_WAITER_LOCK_FILE_DEFAULT =
  "/tmp/induscost-nomus-proposals-hourly-waiter.lock";

/**
 * Cadência oficial: a cada hora, minuto 37 — livre no inventário atual de
 * crons Nomus (NF-e=0, AR/CP=17, Documentos de Saída=23, diário=02:00).
 * O sync diário das 02:00 é preservado; o lock global evita sobreposição.
 */
export const NOMUS_PROPOSALS_HOURLY_SCHEDULE_HINT =
  "cron: 37 * * * * (a cada hora; sync diário 02:00 preservado via lock global)";

export type ProposalsSyncRunMode = "dry" | "apply";

export type ProposalsSyncRunStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export function resolveProposalsSyncLockFile(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (env[NOMUS_PROPOSALS_SYNC_LOCK_ENV] ?? "").trim();
  return fromEnv || NOMUS_PROPOSALS_SYNC_LOCK_FILE_DEFAULT;
}

/** Por padrão respeita o lock global diário/pedidos — evita rodar propostas durante o pipeline das 02:00. */
export function shouldRespectGlobalNomusLock(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK_ENV] ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

/**
 * Timeout de espera pelo lock global (segundos). `0` = comportamento legado
 * (GLOBAL_LOCK_HELD imediato, sem esperar). Valor inválido/negativo cai no
 * default de 45 min.
 */
export function resolveProposalsGlobalLockWaitSeconds(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = (env[NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS_ENV] ?? "").trim();
  if (!raw) return NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return NOMUS_PROPOSALS_GLOBAL_LOCK_WAIT_SECONDS_DEFAULT;
  }
  return parsed;
}

export function resolveProposalsHourlyWaiterLockFile(
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromEnv = (env[NOMUS_PROPOSALS_HOURLY_WAITER_LOCK_ENV] ?? "").trim();
  return fromEnv || NOMUS_PROPOSALS_HOURLY_WAITER_LOCK_FILE_DEFAULT;
}
