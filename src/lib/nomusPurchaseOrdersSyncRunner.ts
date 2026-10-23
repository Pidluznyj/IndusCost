/**
 * Painel "Pedidos de Compra Nomus" (Configurações › Sincronização Nomus).
 *
 * Status vem de NomusSourceSyncRun (entityType PURCHASE_ORDER), não de parse de log.
 * Disparos do painel executam o mesmo shell oficial (scripts/runNomusPurchaseOrdersSync.sh) →
 * CLI → serviço canônico runNomusPurchaseOrdersSync (lock de entidade, run, completude, presença).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { resolveCanonicalEntityLockFile } from "./nomus/nomusCanonicalSync.server.js";
import {
  computeNextPurchaseOrderRuns,
  computePurchaseOrderSyncHealth,
  isCountableSuccess,
  resolvePurchaseOrderStaleHours,
  sanitizePurchaseOrderRunSummary,
  type PurchaseOrderSyncRunLite,
} from "./nomus/nomusPurchaseOrderSyncHealth.js";
import { resolvePurchaseOrderSyncFlags } from "./nomus/nomusPurchaseOrderSyncService.server.js";
import { isNomusOpsExcludeMissingPurchaseOrdersEnabled } from "./nomus/nomusSourcePresencePolicy.js";

export const NOMUS_PO_SYNC_SCRIPT_NAME = "runNomusPurchaseOrdersSync.sh";
export const NOMUS_PO_CRON_FILE_DEFAULT = "/etc/cron.d/induscost-nomus-purchase-orders";

let trackedChild: ChildProcess | null = null;

export class NomusPurchaseOrdersSyncConflictError extends Error {
  constructor(message = "Já existe uma sincronização de Pedidos de Compra em andamento.") {
    super(message);
    this.name = "NomusPurchaseOrdersSyncConflictError";
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Lock canônico de entidade ocupado por processo vivo (mesmo arquivo usado pelo serviço). */
export function isPurchaseOrderCanonicalLockHeld(env: NodeJS.ProcessEnv = process.env): boolean {
  const lockFile = resolveCanonicalEntityLockFile("nomus-purchase-orders", env);
  if (!existsSync(lockFile)) return false;
  try {
    const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: number };
    return typeof parsed.pid === "number" && isPidAlive(parsed.pid);
  } catch {
    return false;
  }
}

export function isPurchaseOrderSyncChildRunning(): boolean {
  return !!trackedChild && trackedChild.exitCode === null && !trackedChild.killed;
}

const RUN_SELECT = {
  id: true,
  status: true,
  strategy: true,
  startedAt: true,
  finishedAt: true,
  payloadComplete: true,
  pagesRead: true,
  rowsRead: true,
  createdCount: true,
  updatedCount: true,
  unchangedCount: true,
  missingCandidateCount: true,
  missingConfirmedCount: true,
  reactivatedCount: true,
  http429Count: true,
  errors: true,
  errorMessage: true,
  summaryJson: true,
} as const;

type RunRow = {
  id: string;
  status: string;
  strategy: string;
  startedAt: Date;
  finishedAt: Date | null;
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
  errorMessage: string | null;
  summaryJson: unknown;
};

export function serializePurchaseOrderSyncRun(run: RunRow) {
  return {
    id: run.id,
    status: run.status,
    strategy: run.strategy,
    preview: run.strategy.endsWith("_PREVIEW"),
    countsAsSuccess: isCountableSuccess(run),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    payloadComplete: run.payloadComplete,
    pagesRead: run.pagesRead,
    rowsRead: run.rowsRead,
    created: run.createdCount,
    updated: run.updatedCount,
    unchanged: run.unchangedCount,
    missingCandidates: run.missingCandidateCount,
    missingConfirmed: run.missingConfirmedCount,
    reactivated: run.reactivatedCount,
    http429: run.http429Count,
    errors: run.errors,
    errorMessage: run.errorMessage,
    summary: sanitizePurchaseOrderRunSummary(run.summaryJson),
  };
}

export async function listNomusPurchaseOrderSyncRuns(
  prisma: PrismaClient,
  options: { limit?: number; status?: string | null } = {}
) {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const rows = await prisma.nomusSourceSyncRun.findMany({
    where: {
      entityType: "PURCHASE_ORDER",
      ...(options.status ? { status: options.status as never } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: RUN_SELECT,
  });
  return rows.map((r) => serializePurchaseOrderSyncRun(r as RunRow));
}

export async function getNomusPurchaseOrderSyncRun(prisma: PrismaClient, id: string) {
  const row = await prisma.nomusSourceSyncRun.findFirst({
    where: { id, entityType: "PURCHASE_ORDER" },
    select: RUN_SELECT,
  });
  if (!row) return null;
  const events = await prisma.nomusPurchaseOrderPresenceEvent.findMany({
    where: { syncRunId: id },
    orderBy: { occurredAt: "asc" },
    take: 500,
    select: {
      id: true,
      externalId: true,
      action: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      missingConsecutiveRuns: true,
      occurredAt: true,
      purchaseOrder: { select: { id: true, orderNumber: true } },
    },
  });
  return {
    run: serializePurchaseOrderSyncRun(row as RunRow),
    events: events.map((e) => ({
      id: e.id,
      externalId: e.externalId,
      purchaseOrderId: e.purchaseOrder?.id ?? null,
      orderNumber: e.purchaseOrder?.orderNumber ?? null,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      reason: e.reason,
      missingConsecutiveRuns: e.missingConsecutiveRuns,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
}

/** Pedidos ausentes no Nomus (em verificação e confirmados). Sem valores financeiros. */
export async function listNomusPurchaseOrdersMissing(
  prisma: PrismaClient,
  options: { status?: "MISSING_CANDIDATE" | "MISSING_CONFIRMED" | null; limit?: number } = {}
) {
  const rows = await prisma.nomusPurchaseOrder.findMany({
    where: {
      sourcePresenceStatus: options.status ? options.status : { in: ["MISSING_CANDIDATE", "MISSING_CONFIRMED"] },
    },
    orderBy: [{ missingSince: "asc" }, { externalId: "asc" }],
    take: Math.min(500, Math.max(1, options.limit ?? 200)),
    select: {
      id: true,
      externalId: true,
      orderNumber: true,
      supplierName: true,
      stage: true,
      issuedAt: true,
      sourcePresenceStatus: true,
      missingSince: true,
      missingConsecutiveRuns: true,
      sourceRemovedAt: true,
      lastSeenAt: true,
      lastSyncRunId: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    externalId: r.externalId,
    orderNumber: r.orderNumber,
    supplierName: r.supplierName,
    stage: r.stage,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    sourcePresenceStatus: r.sourcePresenceStatus,
    missingSince: r.missingSince?.toISOString() ?? null,
    missingConsecutiveRuns: r.missingConsecutiveRuns,
    sourceRemovedAt: r.sourceRemovedAt?.toISOString() ?? null,
    lastSeenAt: r.lastSeenAt.toISOString(),
    lastSyncRunId: r.lastSyncRunId,
  }));
}

export async function getNomusPurchaseOrdersSyncStatus(
  prisma: PrismaClient,
  options: { env?: NodeJS.ProcessEnv; now?: Date; cronFile?: string } = {}
) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const flags = resolvePurchaseOrderSyncFlags(env);
  const runs = await prisma.nomusSourceSyncRun.findMany({
    where: { entityType: "PURCHASE_ORDER" },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: RUN_SELECT,
  });
  const lite: PurchaseOrderSyncRunLite[] = runs.map((r) => ({
    id: r.id,
    status: r.status,
    strategy: r.strategy,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    payloadComplete: r.payloadComplete,
    summaryJson: r.summaryJson,
  }));
  // Último sucesso pode ser mais antigo que os 200 últimos (muitos pulos): busca dedicada.
  if (!lite.some(isCountableSuccess)) {
    const older = await prisma.nomusSourceSyncRun.findFirst({
      where: { entityType: "PURCHASE_ORDER", status: "SUCCESS", NOT: { strategy: { endsWith: "_PREVIEW" } } },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      select: RUN_SELECT,
    });
    if (older) lite.push({ ...older, summaryJson: older.summaryJson });
  }
  const staleHours = resolvePurchaseOrderStaleHours(flags.scheduleSource, env);
  const health = computePurchaseOrderSyncHealth({ runs: lite, now, staleHours });
  const byId = new Map(runs.map((r) => [r.id, r as RunRow]));
  const pick = (run: PurchaseOrderSyncRunLite | null) => {
    if (!run) return null;
    const full = byId.get(run.id);
    return full ? serializePurchaseOrderSyncRun(full) : { id: run.id, status: run.status, strategy: run.strategy, startedAt: run.startedAt.toISOString() };
  };

  const presenceGroups = await prisma.nomusPurchaseOrder.groupBy({
    by: ["sourcePresenceStatus"],
    _count: { _all: true },
  });
  const presence = { PRESENT: 0, MISSING_CANDIDATE: 0, MISSING_CONFIRMED: 0 } as Record<string, number>;
  for (const g of presenceGroups) presence[g.sourcePresenceStatus] = g._count._all;

  const cronFile = options.cronFile ?? env.NOMUS_PO_CRON_FILE ?? NOMUS_PO_CRON_FILE_DEFAULT;
  const cronInstalled = existsSync(cronFile);
  const next = computeNextPurchaseOrderRuns(now);
  const last24h = runs.filter((r) => now.getTime() - r.startedAt.getTime() <= 86_400_000);
  const lastFullSummary = sanitizePurchaseOrderRunSummary(health.lastFullReconciliation?.summaryJson);

  return {
    overallStatus: health.overallStatus,
    staleReason: health.staleReason,
    staleHours,
    hoursSinceLastSuccess: health.hoursSinceLastSuccess,
    isRunning: isPurchaseOrderSyncChildRunning() || isPurchaseOrderCanonicalLockHeld(env) || health.overallStatus === "RUNNING",
    schedule: {
      activeSource: flags.scheduleSource,
      cronFile,
      cronInstalled,
      hourly: "37 * * * *",
      daily: "03:37 America/Sao_Paulo",
      nextHourlyAt: flags.scheduleSource === "independent" && cronInstalled ? next.nextHourlyAt.toISOString() : null,
      nextDailyAt: flags.scheduleSource === "independent" && cronInstalled ? next.nextDailyAt.toISOString() : null,
      chainAfterArEnabled: (env.NOMUS_PO_CHAIN_AFTER_AR ?? "1").trim() === "1",
    },
    flags: {
      absenceReconciliationEnabled: flags.absenceReconciliationEnabled,
      previewOnly: flags.previewOnly,
      applyConfirmedEnabled: flags.applyConfirmedEnabled,
      operationalExclusionEnabled: isNomusOpsExcludeMissingPurchaseOrdersEnabled(env),
      directedLookupEnabled: flags.directedLookupEnabled,
      directedLookupTrust404: flags.directedLookupTrust404,
      reconcileScope: flags.reconcileScope,
    },
    presence,
    metrics24h: {
      runs: last24h.length,
      success: last24h.filter((r) => isCountableSuccess(r)).length,
      skipped: last24h.filter((r) => r.status === "SKIPPED").length,
      failed: last24h.filter((r) => r.status === "FAILED").length,
      inconclusive: last24h.filter((r) => r.status === "INCONCLUSIVE").length,
      http429: last24h.reduce((acc, r) => acc + r.http429Count, 0),
    },
    lastRun: pick(health.lastRun),
    lastSuccess: pick(health.lastSuccess),
    lastFailure: pick(health.lastFailure),
    lastSkipped: pick(health.lastSkipped),
    lastFullReconciliation: pick(health.lastFullReconciliation),
    alerts: Array.isArray(lastFullSummary?.alerts) ? lastFullSummary?.alerts : [],
  };
}

export type NomusPurchaseOrdersSyncStartKind = "incremental" | "reconcile-preview" | "reconcile-apply";

export async function startNomusPurchaseOrdersSync(
  projectRoot: string,
  input: { kind: NomusPurchaseOrdersSyncStartKind; requestedBy: string | null }
) {
  if (isPurchaseOrderSyncChildRunning() || isPurchaseOrderCanonicalLockHeld()) {
    throw new NomusPurchaseOrdersSyncConflictError();
  }
  const scriptPath = path.join(projectRoot, "scripts", NOMUS_PO_SYNC_SCRIPT_NAME);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Script da rotina de Pedidos de Compra Nomus não encontrado no servidor.");
  }
  const logDir = path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
  await fs.mkdir(logDir, { recursive: true });

  const args =
    input.kind === "incremental"
      ? [scriptPath, "apply", "incremental"]
      : input.kind === "reconcile-preview"
        ? [scriptPath, "preview", "reconcile"]
        : [scriptPath, "apply", "reconcile"];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NOMUS_SYNC_LOG_DIR: logDir,
    INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
    NOMUS_PO_TRIGGER: "ADMIN_PANEL",
    NOMUS_PO_REQUESTED_BY: input.requestedBy ?? "",
  };
  if (input.kind === "reconcile-apply") {
    // Autorização explícita: grava as ausências desta execução mesmo com o modo só-prévia
    // global ligado. Chave mestra, confirmação e guardas (intervalo, volume) continuam valendo.
    env.NOMUS_PO_RECONCILE_PREVIEW_ONLY = "0";
  }

  const child = spawn("bash", args, { cwd: projectRoot, detached: true, stdio: "ignore", env });
  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  return {
    started: true as const,
    kind: input.kind,
    message:
      input.kind === "reconcile-preview"
        ? "Prévia de reconciliação iniciada (nenhum pedido é alterado). Acompanhe o resultado nesta tela."
        : input.kind === "reconcile-apply"
          ? "Reconciliação autorizada iniciada. Acompanhe o resultado nesta tela."
          : "Sincronização incremental de Pedidos de Compra iniciada. Acompanhe o status nesta tela.",
    startedAt: new Date().toISOString(),
    pid: child.pid ?? null,
  };
}
