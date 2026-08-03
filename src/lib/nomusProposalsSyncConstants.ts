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
