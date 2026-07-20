/**
 * SYNC-08 — CLI compartilhado de reconciliação histórica (puro).
 *
 * Preview não escreve. Apply só lifecycle (+ campos oficiais já recebidos no syncer).
 * Sem delete físico. Para se completude for inconclusiva.
 */

import type { NomusSourceSyncEntityType } from "./nomusSourceLifecycleContract.js";
import type { NomusSourceReconciliationPlan } from "./nomusSourceReconciliationEngine.js";
import { assertNoPhysicalDeletes } from "./nomusSourceReconciliationEngine.js";
import {
  NOMUS_LIFECYCLE_ONLY_FIELDS,
  NOMUS_OFFICIAL_BUSINESS_FIELD_GROUPS,
  chunkLifecycleBackfillItems,
} from "./nomusLifecycleBackfill.js";

export type NomusSourceReconcileEntityCli =
  | "sales-orders"
  | "accounts-receivable"
  | "accounts-payable";

export type NomusSourceReconcileMode = "preview" | "apply";

export type NomusSourceReconcileCliOptions = {
  mode: NomusSourceReconcileMode;
  entity: NomusSourceReconcileEntityCli;
  externalId: number | null;
  orderCode: string | null;
  from: string | null;
  to: string | null;
  batchSize: number;
  confirmCandidates: boolean;
  explain: boolean;
  json: boolean;
  csv: boolean;
  resumeCursor: string | null;
};

export type NomusSourceReconcileCompletenessGate = {
  payloadComplete: boolean;
  runStatus: "SUCCESS" | "FAILED" | "INCONCLUSIVE" | string;
  reasons?: string[];
};

export type NomusSourceReconcilePreviewReport = {
  mode: NomusSourceReconcileMode;
  entity: NomusSourceReconcileEntityCli;
  entityType: NomusSourceSyncEntityType;
  writes: false | "lifecycle_only";
  localUniverseCount: number;
  nomusUniverseCount: number;
  scope: unknown;
  completeness: NomusSourceReconcileCompletenessGate & Record<string, unknown>;
  present: number;
  creates: number;
  updates: number;
  unchanged: number;
  missingCandidates: number;
  missingConfirmed: number;
  reactivated: number;
  ignoredOutsideScope: number;
  inconclusive: number;
  absencesEvaluated: boolean;
  operationalImpact: {
    openBalanceAffected: number;
    historicalSettledProtected: number;
    confirmedMissingWouldLeaveOps: number;
  };
  pilots: Record<string, unknown>;
  reasons: string[];
  explainItems?: Array<{
    action: string;
    externalId: string;
    localId: string | null;
    reason: string;
    before?: unknown;
    after?: unknown;
  }>;
  physicalDeletes: 0;
  applyAllowed: boolean;
  applyBlockedReason: string | null;
};

function readFlag(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

function readOpt(argv: string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3) || null;
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!;
  }
  return null;
}

export function entityCliToSyncType(
  entity: NomusSourceReconcileEntityCli
): NomusSourceSyncEntityType {
  switch (entity) {
    case "sales-orders":
      return "SALES_ORDER";
    case "accounts-receivable":
      return "ACCOUNTS_RECEIVABLE";
    case "accounts-payable":
      return "ACCOUNTS_PAYABLE";
    default: {
      const _e: never = entity;
      void _e;
      return "SALES_ORDER";
    }
  }
}

export function parseNomusSourceReconcileCli(
  argv: string[],
  entity: NomusSourceReconcileEntityCli
): NomusSourceReconcileCliOptions {
  const modeRaw = (argv[0] ?? "preview").toLowerCase();
  if (modeRaw !== "preview" && modeRaw !== "apply") {
    throw new Error('Modo inválido. Use "preview" ou "apply".');
  }
  const batchRaw = readOpt(argv, "batch-size");
  const batchSize = batchRaw ? Number(batchRaw) : 100;
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("--batch-size deve ser >= 1.");
  }
  const externalRaw = readOpt(argv, "externalId");
  const externalId =
    externalRaw != null && externalRaw !== "" ? Number(externalRaw) : null;
  if (externalRaw != null && externalRaw !== "" && !Number.isFinite(externalId)) {
    throw new Error("--externalId inválido.");
  }
  const orderCode = readOpt(argv, "orderCode");
  if (entity !== "sales-orders" && orderCode) {
    throw new Error("--orderCode é exclusivo de Pedidos.");
  }

  return {
    mode: modeRaw,
    entity,
    externalId,
    orderCode,
    from: readOpt(argv, "from"),
    to: readOpt(argv, "to"),
    batchSize,
    confirmCandidates: readFlag(argv, "confirm-candidates"),
    explain: readFlag(argv, "explain"),
    json: readFlag(argv, "json") || !readFlag(argv, "csv"),
    csv: readFlag(argv, "csv"),
    resumeCursor: readOpt(argv, "resume-cursor"),
  };
}

/** Preview nunca escreve. */
export function reconcilePreviewWrites(): false {
  return false;
}

export function assessReconcileApplyGate(input: {
  mode: NomusSourceReconcileMode;
  completeness: NomusSourceReconcileCompletenessGate;
  reconciliationEnabled: boolean;
}): { applyAllowed: boolean; applyBlockedReason: string | null } {
  // HOTFIX-02: flag desligada bloqueia apply mesmo em preview (motivo visível).
  if (!input.reconciliationEnabled) {
    return {
      applyAllowed: false,
      applyBlockedReason: "RECONCILE_FLAG_DISABLED",
    };
  }
  if (input.mode === "preview") {
    return { applyAllowed: false, applyBlockedReason: "PREVIEW_NO_WRITE" };
  }
  if (!input.completeness.payloadComplete) {
    return {
      applyAllowed: false,
      applyBlockedReason: "PAYLOAD_INCOMPLETE",
    };
  }
  if (input.completeness.runStatus !== "SUCCESS") {
    return {
      applyAllowed: false,
      applyBlockedReason: `RUN_${input.completeness.runStatus}`,
    };
  }
  return { applyAllowed: true, applyBlockedReason: null };
}

export function collectLifecyclePatchesFromPlan(
  plan: NomusSourceReconciliationPlan
): Array<{
  localId: string;
  externalId: string;
  action: string;
  patch: NonNullable<(typeof plan.creates)[number]["lifecyclePatch"]>;
  beforeStatus?: string | null;
}> {
  assertNoPhysicalDeletes(plan);
  const out: Array<{
    localId: string;
    externalId: string;
    action: string;
    patch: NonNullable<(typeof plan.creates)[number]["lifecyclePatch"]>;
    beforeStatus?: string | null;
  }> = [];

  const buckets: Array<[string, typeof plan.creates]> = [
    ["CREATE", plan.creates],
    ["UPDATE", plan.updates],
    ["UNCHANGED", plan.unchanged],
    ["MISSING_CANDIDATE", plan.missingCandidates],
    ["MISSING_CONFIRMED", plan.missingConfirmed],
    ["REACTIVATE", plan.reactivated],
  ];

  for (const [action, items] of buckets) {
    for (const item of items) {
      if (!item.lifecyclePatch || !item.localId) continue;
      out.push({
        localId: item.localId,
        externalId: item.externalId,
        action,
        patch: item.lifecyclePatch,
        beforeStatus: item.previousPresenceStatus,
      });
    }
  }
  return out;
}

export function assertLifecyclePatchOnly(
  patch: Record<string, unknown>
): void {
  const allowed = new Set<string>([
    ...NOMUS_LIFECYCLE_ONLY_FIELDS,
    "payloadHash",
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Patch de reconcile contém campo não-lifecycle: ${key}`
      );
    }
  }
}

export function buildNomusSourceReconcilePreviewReport(input: {
  mode: NomusSourceReconcileMode;
  entity: NomusSourceReconcileEntityCli;
  plan: NomusSourceReconciliationPlan;
  completeness: NomusSourceReconcileCompletenessGate & Record<string, unknown>;
  scope: unknown;
  localUniverseCount: number;
  nomusUniverseCount: number;
  reconciliationEnabled: boolean;
  openBalanceAffected?: number;
  historicalSettledProtected?: number;
  pilots?: Record<string, unknown>;
}): NomusSourceReconcilePreviewReport {
  assertNoPhysicalDeletes(input.plan);
  const gate = assessReconcileApplyGate({
    mode: input.mode,
    completeness: input.completeness,
    reconciliationEnabled: input.reconciliationEnabled,
  });

  const explainItems =
    input.mode === "preview" || true
      ? [
          ...input.plan.creates,
          ...input.plan.updates,
          ...input.plan.missingCandidates,
          ...input.plan.missingConfirmed,
          ...input.plan.reactivated,
        ].map((i) => ({
          action: i.action,
          externalId: i.externalId,
          localId: i.localId,
          reason: i.reason,
          before: i.previousPresenceStatus,
          after: i.nextPresenceStatus,
        }))
      : undefined;

  return {
    mode: input.mode,
    entity: input.entity,
    entityType: entityCliToSyncType(input.entity),
    writes: input.mode === "preview" ? false : "lifecycle_only",
    localUniverseCount: input.localUniverseCount,
    nomusUniverseCount: input.nomusUniverseCount,
    scope: input.scope,
    completeness: input.completeness,
    present:
      input.plan.counters.unchanged +
      input.plan.counters.updates +
      input.plan.counters.creates,
    creates: input.plan.counters.creates,
    updates: input.plan.counters.updates,
    unchanged: input.plan.counters.unchanged,
    missingCandidates: input.plan.counters.missingCandidates,
    missingConfirmed: input.plan.counters.missingConfirmed,
    reactivated: input.plan.counters.reactivated,
    ignoredOutsideScope: input.plan.counters.ignoredOutsideScope,
    inconclusive: input.plan.counters.inconclusive,
    absencesEvaluated: input.plan.absencesEvaluated,
    operationalImpact: {
      openBalanceAffected: input.openBalanceAffected ?? 0,
      historicalSettledProtected: input.historicalSettledProtected ?? 0,
      confirmedMissingWouldLeaveOps: input.plan.counters.missingConfirmed,
    },
    pilots: input.pilots ?? {},
    reasons: input.plan.reasons,
    explainItems,
    physicalDeletes: 0,
    applyAllowed: gate.applyAllowed,
    applyBlockedReason: gate.applyBlockedReason,
  };
}

export function formatReconcileReportCsv(
  report: NomusSourceReconcilePreviewReport
): string {
  const lines = [
    "section,key,value",
    `summary,entity,${report.entity}`,
    `summary,mode,${report.mode}`,
    `summary,localUniverse,${report.localUniverseCount}`,
    `summary,nomusUniverse,${report.nomusUniverseCount}`,
    `summary,creates,${report.creates}`,
    `summary,updates,${report.updates}`,
    `summary,missingCandidates,${report.missingCandidates}`,
    `summary,missingConfirmed,${report.missingConfirmed}`,
    `summary,reactivated,${report.reactivated}`,
    `summary,applyAllowed,${report.applyAllowed}`,
    `summary,physicalDeletes,${report.physicalDeletes}`,
  ];
  for (const item of report.explainItems ?? []) {
    lines.push(
      `item,${item.action},${item.externalId}|${item.localId ?? ""}|${item.reason}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export type NomusSourceReconcileResumeCursor = {
  version: 1;
  entity: NomusSourceReconcileEntityCli;
  nextBatchIndex: number;
  applied: number;
  updatedAt: string;
};

export function serializeReconcileResumeCursor(
  cursor: NomusSourceReconcileResumeCursor
): string {
  return JSON.stringify(cursor);
}

export function parseReconcileResumeCursor(
  raw: string | null | undefined
): NomusSourceReconcileResumeCursor | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NomusSourceReconcileResumeCursor>;
    if (
      parsed.version === 1 &&
      typeof parsed.nextBatchIndex === "number" &&
      parsed.nextBatchIndex >= 0
    ) {
      return {
        version: 1,
        entity: (parsed.entity as NomusSourceReconcileEntityCli) ?? "sales-orders",
        nextBatchIndex: parsed.nextBatchIndex,
        applied: parsed.applied ?? 0,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function planReconcileApplyBatches<T>(
  patches: T[],
  batchSize: number,
  resumeFromBatchIndex = 0
): { batches: T[][]; startBatchIndex: number } {
  const batches = chunkLifecycleBackfillItems(patches, batchSize);
  const start = Math.min(Math.max(0, resumeFromBatchIndex), batches.length);
  return { batches: batches.slice(start), startBatchIndex: start };
}

export function officialVsLifecycleFieldGuide(entity: NomusSourceReconcileEntityCli) {
  const entityType = entityCliToSyncType(entity);
  const officialKey =
    entityType === "SALES_ORDER"
      ? "SALES_ORDER"
      : entityType === "ACCOUNTS_RECEIVABLE"
        ? "ACCOUNTS_RECEIVABLE"
        : "ACCOUNTS_PAYABLE";
  return {
    official: NOMUS_OFFICIAL_BUSINESS_FIELD_GROUPS[officialKey],
    lifecycleOnly: NOMUS_LIFECYCLE_ONLY_FIELDS,
  };
}

/** Entidades são independentes — Pedido ausente não decide CR/CP. */
export function assertEntityIndependenceGuard(input: {
  decidingEntity: NomusSourceReconcileEntityCli;
  targetEntity: NomusSourceReconcileEntityCli;
}): void {
  if (input.decidingEntity !== input.targetEntity) {
    throw new Error(
      `Independência violada: não usar estado de ${input.decidingEntity} para decidir ${input.targetEntity}.`
    );
  }
}
