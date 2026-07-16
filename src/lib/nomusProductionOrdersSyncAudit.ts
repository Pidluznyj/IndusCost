/**
 * Auditoria / métricas finais de execução do sync de OP (OP-11).
 * Sem tokens, Authorization ou cabeçalhos secretos.
 */

import {
  NOMUS_PRODUCTION_ORDERS_LOG_PREFIX,
  type ProductionOrdersSyncRunMode,
  type ProductionOrdersSyncRunStatus,
  type ProductionOrdersSyncRunType,
} from "@/src/lib/nomusProductionOrdersSyncConstants.js";

export function maskProductionOrdersSensitiveText(value: string): string {
  return value
    .replace(/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1***")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1***")
    .replace(/(token\s*[:=]\s*)([^\s]+)/gi, "$1***")
    .replace(/(NOMUS_TOKEN\s*[:=]\s*)([^\s]+)/gi, "$1***");
}

export type ProductionOrdersSyncAuditRecord = {
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  startedAt: string;
  finishedAt: string;
  status: ProductionOrdersSyncRunStatus;
  cutoff: string | null;
  pages: number;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  links: number;
  resolved: number;
  pending: number;
  deactivated: number;
  errors: number;
  rateLimit429: number;
  durationMs: number;
  finalMessage: string;
  exitCode: number;
  lockFile: string | null;
  blockedCode: string | null;
};

export type ProductionOrdersSyncAuditInput = {
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  startedAt: Date;
  finishedAt: Date;
  status: ProductionOrdersSyncRunStatus;
  cutoff?: string | null;
  pages?: number;
  received?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  invalid?: number;
  links?: number;
  resolved?: number;
  pending?: number;
  deactivated?: number;
  errors?: number;
  rateLimit429?: number;
  finalMessage: string;
  exitCode: number;
  lockFile?: string | null;
  blockedCode?: string | null;
};

function n(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value!)) : 0;
}

export function buildProductionOrdersSyncAuditRecord(
  input: ProductionOrdersSyncAuditInput
): ProductionOrdersSyncAuditRecord {
  const durationMs = Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
  return {
    type: input.type,
    mode: input.mode,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    status: input.status,
    cutoff: input.cutoff ?? null,
    pages: n(input.pages),
    received: n(input.received),
    created: n(input.created),
    updated: n(input.updated),
    unchanged: n(input.unchanged),
    invalid: n(input.invalid),
    links: n(input.links),
    resolved: n(input.resolved),
    pending: n(input.pending),
    deactivated: n(input.deactivated),
    errors: n(input.errors),
    rateLimit429: n(input.rateLimit429),
    durationMs,
    finalMessage: maskProductionOrdersSensitiveText(input.finalMessage).slice(0, 2000),
    exitCode: input.exitCode,
    lockFile: input.lockFile ?? null,
    blockedCode: input.blockedCode ?? null,
  };
}

export function formatProductionOrdersSyncAuditLog(
  audit: ProductionOrdersSyncAuditRecord
): string {
  return [
    `${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} execution`,
    `type=${audit.type}`,
    `mode=${audit.mode}`,
    `status=${audit.status}`,
    `startedAt=${audit.startedAt}`,
    `finishedAt=${audit.finishedAt}`,
    `cutoff=${audit.cutoff ?? "-"}`,
    `pages=${audit.pages}`,
    `received=${audit.received}`,
    `created=${audit.created}`,
    `updated=${audit.updated}`,
    `unchanged=${audit.unchanged}`,
    `invalid=${audit.invalid}`,
    `links=${audit.links}`,
    `resolved=${audit.resolved}`,
    `pending=${audit.pending}`,
    `deactivated=${audit.deactivated}`,
    `errors=${audit.errors}`,
    `429=${audit.rateLimit429}`,
    `durationMs=${audit.durationMs}`,
    `exitCode=${audit.exitCode}`,
    `message=${audit.finalMessage}`,
  ].join(" ");
}

export function resolveProductionOrdersSyncStatus(args: {
  blocked?: boolean;
  interrupted?: boolean;
  errors: number;
}): ProductionOrdersSyncRunStatus {
  if (args.blocked) return "BLOCKED";
  if (args.interrupted) return "INTERRUPTED";
  if (args.errors > 0) return "FAILED";
  return "SUCCESS";
}

export function resolveProductionOrdersSyncExitCode(
  status: ProductionOrdersSyncRunStatus
): number {
  if (status === "BLOCKED") return 0; // cron-safe / não mata execução válida
  if (status === "FAILED" || status === "INTERRUPTED") return 2;
  return 0;
}

export function auditFromBackfillSummary(args: {
  mode: ProductionOrdersSyncRunMode;
  startedAt: Date;
  finishedAt: Date;
  summary: {
    pagesRead: number;
    recordsReceived: number;
    created: number;
    updated: number;
    unchanged: number;
    invalid: number;
    linkedRows: number;
    linksMarkedAbsent: number;
    locallyResolved: number;
    unresolved: number;
    pendingLinksReconciled: number;
    rateLimitCount: number;
    errors: number;
    interrupted: boolean;
    duration: number;
  };
  lockFile?: string | null;
}): ProductionOrdersSyncAuditRecord {
  const status = resolveProductionOrdersSyncStatus({
    interrupted: args.summary.interrupted,
    errors: args.summary.errors,
  });
  const exitCode = resolveProductionOrdersSyncExitCode(status);
  const finalMessage =
    status === "SUCCESS"
      ? "backfill concluído"
      : status === "INTERRUPTED"
        ? "backfill interrompido com segurança"
        : `backfill com erros=${args.summary.errors}`;
  return buildProductionOrdersSyncAuditRecord({
    type: "backfill",
    mode: args.mode,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status,
    pages: args.summary.pagesRead,
    received: args.summary.recordsReceived,
    created: args.summary.created,
    updated: args.summary.updated,
    unchanged: args.summary.unchanged,
    invalid: args.summary.invalid,
    links: args.summary.linkedRows,
    resolved: args.summary.locallyResolved + args.summary.pendingLinksReconciled,
    pending: args.summary.unresolved,
    deactivated: args.summary.linksMarkedAbsent,
    errors: args.summary.errors,
    rateLimit429: args.summary.rateLimitCount,
    finalMessage,
    exitCode,
    lockFile: args.lockFile,
  });
}

export function auditFromIncrementalSummary(args: {
  mode: ProductionOrdersSyncRunMode;
  startedAt: Date;
  finishedAt: Date;
  summary: {
    pagesRead: number;
    recordsReceived: number;
    created: number;
    updated: number;
    unchanged: number;
    invalid: number;
    linkedRows: number;
    linksMarkedAbsent: number;
    errors: number;
    cutoffUsed: string;
    duration: number;
    rateLimitCount?: number;
  };
  lockFile?: string | null;
}): ProductionOrdersSyncAuditRecord {
  const status = resolveProductionOrdersSyncStatus({ errors: args.summary.errors });
  const exitCode = resolveProductionOrdersSyncExitCode(status);
  const finalMessage =
    status === "SUCCESS"
      ? "incremental concluído"
      : `incremental com erros=${args.summary.errors}`;
  return buildProductionOrdersSyncAuditRecord({
    type: "incremental",
    mode: args.mode,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status,
    cutoff: args.summary.cutoffUsed,
    pages: args.summary.pagesRead,
    received: args.summary.recordsReceived,
    created: args.summary.created,
    updated: args.summary.updated,
    unchanged: args.summary.unchanged,
    invalid: args.summary.invalid,
    links: args.summary.linkedRows,
    resolved: 0,
    pending: 0,
    deactivated: args.summary.linksMarkedAbsent,
    errors: args.summary.errors,
    rateLimit429: args.summary.rateLimitCount ?? 0,
    finalMessage,
    exitCode,
    lockFile: args.lockFile,
  });
}

export function buildBlockedProductionOrdersAudit(args: {
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  startedAt: Date;
  finishedAt: Date;
  message: string;
  lockFile: string;
  blockedCode: string;
}): ProductionOrdersSyncAuditRecord {
  return buildProductionOrdersSyncAuditRecord({
    type: args.type,
    mode: args.mode,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status: "BLOCKED",
    finalMessage: args.message,
    exitCode: 0,
    lockFile: args.lockFile,
    blockedCode: args.blockedCode,
  });
}
