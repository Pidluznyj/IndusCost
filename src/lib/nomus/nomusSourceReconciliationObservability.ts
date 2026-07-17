/**
 * SYNC-09 — Observabilidade da reconciliação de presença Nomus (puro).
 *
 * Métricas e alertas a partir de NomusSourceSyncRun oficiais.
 * Alertas NÃO confirmam ausências. Sem rawPayload / payloads sensíveis.
 */

import type { NomusSourceSyncEntityType } from "./nomusSourceLifecycleContract.js";

export const NOMUS_SOURCE_RECONCILIATION_OBSERVABILITY_ENTITIES = [
  "SALES_ORDER",
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
] as const;

export type NomusSourceObservabilityEntityType =
  (typeof NOMUS_SOURCE_RECONCILIATION_OBSERVABILITY_ENTITIES)[number];

export type NomusSourceSyncRunObservabilityRow = {
  id: string;
  entityType: NomusSourceObservabilityEntityType | string;
  strategy: string;
  scope: unknown;
  startedAt: Date | string;
  finishedAt?: Date | string | null;
  status: string;
  payloadComplete: boolean;
  pagesRead: number;
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCandidateCount: number;
  missingConfirmedCount: number;
  reactivatedCount: number;
  http429Count: number;
  errors: number;
  coveredFrom?: Date | string | null;
  coveredTo?: Date | string | null;
  errorMessage?: string | null;
  summaryJson?: unknown;
};

export type NomusSourceEntityRunMetrics = {
  entityType: NomusSourceObservabilityEntityType;
  lastRunId: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  strategy: string | null;
  scope: unknown;
  status: string | null;
  payloadComplete: boolean | null;
  pagesRead: number;
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCandidateCount: number;
  missingConfirmedCount: number;
  reactivatedCount: number;
  errors: number;
  http429Count: number;
  durationMs: number | null;
  previousRowsRead: number | null;
  previousMissingCandidateCount: number | null;
};

export type NomusSourceReconciliationAlertCode =
  | "RUN_FAILED"
  | "PAYLOAD_INCONCLUSIVE"
  | "MAX_PAGES_REACHED"
  | "ROWS_DROP_ABNORMAL"
  | "CANDIDATES_SPIKE"
  | "ABSENCE_CONFIRMED"
  | "RECORD_REACTIVATED"
  | "SYNC_STALE";

export type NomusSourceReconciliationAlert = {
  code: NomusSourceReconciliationAlertCode;
  entityType: NomusSourceObservabilityEntityType | "ALL";
  severity: "info" | "warning" | "critical";
  message: string;
  /** Alertas nunca autorizam MISSING_CONFIRMED. */
  confirmsAbsence: false;
  runId?: string | null;
  metrics?: Record<string, number | string | boolean | null>;
};

export type NomusSourceReconciliationObservabilityThresholds = {
  /** Queda relativa de rowsRead vs execução anterior (0–1). Default 0.4 = −40%. */
  rowsDropRatio: number;
  /** Aumento absoluto mínimo de candidatos para alerta. */
  candidatesSpikeMin: number;
  /** Multiplicador vs candidatos anteriores. */
  candidatesSpikeRatio: number;
  /** Frequência máxima esperada entre runs SUCCESS (ms). */
  expectedMaxGapMs: number;
  /** Heurística de max pages: pagesRead >= este valor e !payloadComplete. */
  maxPagesHeuristic: number;
};

export const DEFAULT_OBSERVABILITY_THRESHOLDS: NomusSourceReconciliationObservabilityThresholds =
  {
    rowsDropRatio: 0.4,
    candidatesSpikeMin: 10,
    candidatesSpikeRatio: 3,
    expectedMaxGapMs: 36 * 60 * 60 * 1000,
    maxPagesHeuristic: 100,
  };

export type NomusSourcePresenceDrilldownRow = {
  entityType: NomusSourceObservabilityEntityType;
  localId: string;
  externalId: string;
  code: string | null;
  sourcePresenceStatus: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  missingSince: string | null;
  sourceRemovedAt: string | null;
  lastSyncRunId: string | null;
  reasons: string[];
  operationalImpact: {
    openBalance: number | null;
    isOperationallyPresent: boolean;
    adminAlert: boolean;
  };
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | string | null | undefined): string | null {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function durationMs(
  startedAt: Date | string,
  finishedAt: Date | string | null | undefined
): number | null {
  const start = toDate(startedAt);
  const end = toDate(finishedAt ?? null);
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function entityTypeLabel(entityType: string): string {
  switch (entityType) {
    case "SALES_ORDER":
      return "Pedidos";
    case "ACCOUNTS_RECEIVABLE":
      return "Contas a Receber";
    case "ACCOUNTS_PAYABLE":
      return "Contas a Pagar";
    default:
      return entityType;
  }
}

/** Remove chaves sensíveis de summaryJson antes de expor. */
export function sanitizeObservabilitySummaryJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const banned = new Set([
    "rawPayload",
    "nomusRawResponse",
    "raw",
    "authorization",
    "token",
    "password",
    "secret",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (banned.has(k) || banned.has(key) || key.includes("payload") || key.includes("token")) {
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeObservabilitySummaryJson(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function assertNoSensitiveObservabilityLeak(payload: unknown): void {
  const raw = JSON.stringify(payload ?? null);
  if (/rawPayload|nomusRawResponse|"authorization"|Bearer\s+/i.test(raw)) {
    throw new Error("Observabilidade não pode expor rawPayload/tokens.");
  }
}

function pickLatestPerEntity(
  runs: readonly NomusSourceSyncRunObservabilityRow[]
): Map<NomusSourceObservabilityEntityType, NomusSourceSyncRunObservabilityRow[]> {
  const map = new Map<
    NomusSourceObservabilityEntityType,
    NomusSourceSyncRunObservabilityRow[]
  >();
  for (const entity of NOMUS_SOURCE_RECONCILIATION_OBSERVABILITY_ENTITIES) {
    map.set(entity, []);
  }
  const sorted = [...runs].sort((a, b) => {
    const ta = toDate(a.startedAt)?.getTime() ?? 0;
    const tb = toDate(b.startedAt)?.getTime() ?? 0;
    return tb - ta;
  });
  for (const run of sorted) {
    const entity = run.entityType as NomusSourceObservabilityEntityType;
    if (!map.has(entity)) continue;
    map.get(entity)!.push(run);
  }
  return map;
}

export function buildNomusSourceEntityRunMetrics(
  run: NomusSourceSyncRunObservabilityRow,
  previous: NomusSourceSyncRunObservabilityRow | null
): NomusSourceEntityRunMetrics {
  return {
    entityType: run.entityType as NomusSourceObservabilityEntityType,
    lastRunId: run.id,
    lastStartedAt: toIso(run.startedAt),
    lastFinishedAt: toIso(run.finishedAt),
    strategy: run.strategy,
    scope: run.scope,
    status: run.status,
    payloadComplete: run.payloadComplete,
    pagesRead: run.pagesRead,
    rowsRead: run.rowsRead,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    unchangedCount: run.unchangedCount,
    missingCandidateCount: run.missingCandidateCount,
    missingConfirmedCount: run.missingConfirmedCount,
    reactivatedCount: run.reactivatedCount,
    errors: run.errors,
    http429Count: run.http429Count,
    durationMs: durationMs(run.startedAt, run.finishedAt),
    previousRowsRead: previous?.rowsRead ?? null,
    previousMissingCandidateCount: previous?.missingCandidateCount ?? null,
  };
}

export function buildNomusSourceReconciliationMetrics(
  runs: readonly NomusSourceSyncRunObservabilityRow[]
): {
  generatedAt: string;
  byEntity: NomusSourceEntityRunMetrics[];
  source: "NomusSourceSyncRun";
} {
  const grouped = pickLatestPerEntity(runs);
  const byEntity: NomusSourceEntityRunMetrics[] = [];
  for (const entity of NOMUS_SOURCE_RECONCILIATION_OBSERVABILITY_ENTITIES) {
    const list = grouped.get(entity) ?? [];
    if (list.length === 0) {
      byEntity.push({
        entityType: entity,
        lastRunId: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        strategy: null,
        scope: null,
        status: null,
        payloadComplete: null,
        pagesRead: 0,
        rowsRead: 0,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        missingCandidateCount: 0,
        missingConfirmedCount: 0,
        reactivatedCount: 0,
        errors: 0,
        http429Count: 0,
        durationMs: null,
        previousRowsRead: null,
        previousMissingCandidateCount: null,
      });
      continue;
    }
    byEntity.push(buildNomusSourceEntityRunMetrics(list[0]!, list[1] ?? null));
  }
  return {
    generatedAt: new Date().toISOString(),
    byEntity,
    source: "NomusSourceSyncRun",
  };
}

export function buildNomusSourceReconciliationAlerts(
  metrics: NomusSourceEntityRunMetrics[],
  options?: {
    thresholds?: Partial<NomusSourceReconciliationObservabilityThresholds>;
    now?: Date;
  }
): NomusSourceReconciliationAlert[] {
  const thresholds = {
    ...DEFAULT_OBSERVABILITY_THRESHOLDS,
    ...options?.thresholds,
  };
  const now = options?.now ?? new Date();
  const alerts: NomusSourceReconciliationAlert[] = [];

  for (const m of metrics) {
    if (!m.lastRunId) {
      alerts.push({
        code: "SYNC_STALE",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: nenhuma execução NomusSourceSyncRun registrada.`,
        confirmsAbsence: false,
      });
      continue;
    }

    if (m.status === "FAILED") {
      alerts.push({
        code: "RUN_FAILED",
        entityType: m.entityType,
        severity: "critical",
        message: `${entityTypeLabel(m.entityType)}: última execução falhou.`,
        confirmsAbsence: false,
        runId: m.lastRunId,
      });
    }

    if (
      m.status === "INCONCLUSIVE" ||
      (m.status === "SUCCESS" && m.payloadComplete === false)
    ) {
      alerts.push({
        code: "PAYLOAD_INCONCLUSIVE",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: payload incompleto/inconclusivo — ausência não autorizada.`,
        confirmsAbsence: false,
        runId: m.lastRunId,
        metrics: { payloadComplete: m.payloadComplete },
      });
    }

    if (
      m.payloadComplete === false &&
      m.pagesRead >= thresholds.maxPagesHeuristic
    ) {
      alerts.push({
        code: "MAX_PAGES_REACHED",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: possível limite de páginas (pagesRead=${m.pagesRead}).`,
        confirmsAbsence: false,
        runId: m.lastRunId,
        metrics: { pagesRead: m.pagesRead },
      });
    }

    if (
      m.previousRowsRead != null &&
      m.previousRowsRead > 0 &&
      m.rowsRead < m.previousRowsRead * (1 - thresholds.rowsDropRatio)
    ) {
      alerts.push({
        code: "ROWS_DROP_ABNORMAL",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: queda anormal de registros lidos (${m.previousRowsRead} → ${m.rowsRead}).`,
        confirmsAbsence: false,
        runId: m.lastRunId,
        metrics: {
          previousRowsRead: m.previousRowsRead,
          rowsRead: m.rowsRead,
        },
      });
    }

    if (
      m.previousMissingCandidateCount != null &&
      m.missingCandidateCount >= thresholds.candidatesSpikeMin &&
      m.missingCandidateCount >=
        Math.max(1, m.previousMissingCandidateCount) * thresholds.candidatesSpikeRatio
    ) {
      alerts.push({
        code: "CANDIDATES_SPIKE",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: aumento abrupto de candidatos (${m.previousMissingCandidateCount} → ${m.missingCandidateCount}).`,
        confirmsAbsence: false,
        runId: m.lastRunId,
      });
    }

    if (m.missingConfirmedCount > 0) {
      alerts.push({
        code: "ABSENCE_CONFIRMED",
        entityType: m.entityType,
        severity: "info",
        message: `${entityTypeLabel(m.entityType)}: ${m.missingConfirmedCount} ausência(s) confirmada(s) na última run (alerta informativo — não confirma por si).`,
        confirmsAbsence: false,
        runId: m.lastRunId,
        metrics: { missingConfirmedCount: m.missingConfirmedCount },
      });
    }

    if (m.reactivatedCount > 0) {
      alerts.push({
        code: "RECORD_REACTIVATED",
        entityType: m.entityType,
        severity: "info",
        message: `${entityTypeLabel(m.entityType)}: ${m.reactivatedCount} registro(s) reapareceram (reativados).`,
        confirmsAbsence: false,
        runId: m.lastRunId,
        metrics: { reactivatedCount: m.reactivatedCount },
      });
    }

    const anchor = toDate(m.lastFinishedAt ?? m.lastStartedAt);
    if (
      anchor &&
      now.getTime() - anchor.getTime() > thresholds.expectedMaxGapMs
    ) {
      alerts.push({
        code: "SYNC_STALE",
        entityType: m.entityType,
        severity: "warning",
        message: `${entityTypeLabel(m.entityType)}: sync fora da frequência esperada.`,
        confirmsAbsence: false,
        runId: m.lastRunId,
      });
    }
  }

  return alerts;
}

export type NomusSourceDrilldownQuery = {
  entityType?: NomusSourceObservabilityEntityType | "ALL" | null;
  externalId?: string | null;
  code?: string | null;
  presenceStatus?: string | null;
  page: number;
  pageSize: number;
};

export function parseNomusSourceDrilldownQuery(
  query: Record<string, unknown>
): NomusSourceDrilldownQuery {
  const pageRaw = Number(query.page);
  const sizeRaw = Number(query.pageSize ?? query.limit);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
  const pageSize = Number.isFinite(sizeRaw)
    ? Math.max(1, Math.min(100, Math.trunc(sizeRaw)))
    : 20;
  const entityRaw = String(query.entityType ?? query.entity ?? "ALL").toUpperCase();
  const entityType = (
    ["SALES_ORDER", "ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE", "ALL"] as const
  ).includes(entityRaw as never)
    ? (entityRaw as NomusSourceDrilldownQuery["entityType"])
    : "ALL";

  return {
    entityType,
    externalId:
      query.externalId != null && String(query.externalId).trim() !== ""
        ? String(query.externalId).trim()
        : null,
    code:
      query.code != null && String(query.code).trim() !== ""
        ? String(query.code).trim()
        : query.orderCode != null && String(query.orderCode).trim() !== ""
          ? String(query.orderCode).trim()
          : null,
    presenceStatus:
      query.presenceStatus != null && String(query.presenceStatus).trim() !== ""
        ? String(query.presenceStatus).trim().toUpperCase()
        : null,
    page,
    pageSize,
  };
}

export function paginateDrilldownRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number
): { items: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export function buildPresenceDrilldownRow(input: {
  entityType: NomusSourceObservabilityEntityType;
  localId: string;
  externalId: string | number;
  code?: string | null;
  sourcePresenceStatus: string;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
  missingSince?: Date | string | null;
  sourceRemovedAt?: Date | string | null;
  lastSyncRunId?: string | null;
  openBalance?: number | null;
  reasons?: string[];
}): NomusSourcePresenceDrilldownRow {
  const status = input.sourcePresenceStatus;
  return {
    entityType: input.entityType,
    localId: input.localId,
    externalId: String(input.externalId),
    code: input.code ?? null,
    sourcePresenceStatus: status,
    firstSeenAt: toIso(input.firstSeenAt),
    lastSeenAt: toIso(input.lastSeenAt),
    missingSince: toIso(input.missingSince),
    sourceRemovedAt: toIso(input.sourceRemovedAt),
    lastSyncRunId: input.lastSyncRunId ?? null,
    reasons: input.reasons ?? [],
    operationalImpact: {
      openBalance: input.openBalance ?? null,
      isOperationallyPresent: status !== "MISSING_CONFIRMED",
      adminAlert: status === "MISSING_CANDIDATE",
    },
  };
}

export function buildNomusSourceReconciliationObservabilityPayload(input: {
  runs: readonly NomusSourceSyncRunObservabilityRow[];
  thresholds?: Partial<NomusSourceReconciliationObservabilityThresholds>;
  now?: Date;
}): {
  metrics: ReturnType<typeof buildNomusSourceReconciliationMetrics>;
  alerts: NomusSourceReconciliationAlert[];
  permissions: {
    resourceKey: "admin.settings.nomus_sync";
    action: "view";
  };
  sensitiveFieldsExcluded: true;
  alertsConfirmAbsence: false;
} {
  const metrics = buildNomusSourceReconciliationMetrics(input.runs);
  const alerts = buildNomusSourceReconciliationAlerts(metrics.byEntity, {
    thresholds: input.thresholds,
    now: input.now,
  });
  const payload = {
    metrics,
    alerts,
    permissions: {
      resourceKey: "admin.settings.nomus_sync" as const,
      action: "view" as const,
    },
    sensitiveFieldsExcluded: true as const,
    alertsConfirmAbsence: false as const,
  };
  assertNoSensitiveObservabilityLeak(payload);
  return payload;
}

export function isNomusSourceObservabilityAuthorized(input: {
  hasView: boolean;
  isBootstrap?: boolean;
}): boolean {
  return input.isBootstrap === true || input.hasView === true;
}

/** Contrato: frontend não implementa regras de negócio de presença. */
export const OBSERVABILITY_FRONTEND_MUST_NOT_CONTAIN = [
  "isNomusSourceOperationallyPresent",
  "planNomusSourceReconciliation",
  "buildNomusSourceReconciliationAlerts",
] as const;
