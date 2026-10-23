/**
 * Pedidos de Compra Nomus — implementação do serviço canônico (`runNomusPurchaseOrdersSync`).
 *
 * Fluxo (sempre dentro do lock de entidade adquirido por runCanonicalEntitySync):
 *   1. fonte de agendamento ativa (chain | independent) — disparo da fonte inativa = SKIPPED;
 *   2. espera pelo lock global Nomus (sonda, não adquire) — timeout = SKIPPED;
 *   3. NomusSourceSyncRun RUNNING;
 *   4. paginação completa com métricas de completude (página 1 → fim);
 *   5. upsert do espelho (apply) + presença dos encontrados (PRESENT / REACTIVATE);
 *   6. ausência só em FULL_RECONCILIATION + flag + varredura completa + sem modo só-prévia;
 *   7. run finalizado com contadores e resumo sanitizado (sem token, sem payload financeiro).
 *
 * Nunca apaga pedido, item, avaliação, vínculo de CP ou pagamento. Ausência ≠ cancelamento.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { buildNomusUrl, fetchNomusJson, type FetchNomusJsonOptions } from "../nomusRestClient.js";
import {
  probeGlobalNomusSyncLockHeld,
  waitForGlobalNomusSyncLockToFree,
} from "../nomusProductionOrdersSyncLock.js";
import type { NomusCanonicalSyncExecution } from "./nomusCanonicalSyncContract.js";
import type { NomusCanonicalSyncDelegateResult } from "./nomusCanonicalSync.server.js";
import type { NomusSourceLifecyclePatch } from "./nomusSourceReconciliationEngine.js";
import { isNomusPurchaseOrderAbsenceReconciliationEnabled } from "./nomusSourceReconciliationFlags.js";
import { mapNomusPurchaseOrderPayload } from "./nomusPurchaseOrderMapper.js";
import { applyNomusPurchaseOrderRows } from "./nomusPurchaseOrderPersist.js";
import {
  NOMUS_PURCHASE_ORDER_RESOURCE,
  buildPurchaseOrderPageParams,
  hasNextPurchaseOrderPage,
  isRecognizedPurchaseOrderPagePayload,
  pickPurchaseOrderPageItems,
  resolvePurchaseOrderPageSize,
  resolvePurchaseOrderWindow,
} from "./nomusPurchaseOrderSyncLogic.js";
import type { MapNomusPurchaseOrderResult, MappedNomusPurchaseOrder } from "./nomusPurchaseOrderTypes.js";

type MapFailure = Extract<MapNomusPurchaseOrderResult, { ok: false }>;
type MapSuccess = Extract<MapNomusPurchaseOrderResult, { ok: true }>;
import {
  assessPurchaseOrderFetchCompleteness,
  buildPurchaseOrderPresenceEvents,
  buildPurchaseOrderRunScope,
  buildPurchaseOrderSourceReconciliationPlan,
  resolvePurchaseOrderReconciliationPolicy,
  type PurchaseOrderFetchCompleteness,
  type PurchaseOrderFetchMeta,
  type PurchaseOrderLifecycleLocal,
  type PurchaseOrderSyncStrategy,
} from "./nomusPurchaseOrderSourceReconciliation.js";

const LOG_PREFIX = "[nomus-purchase-orders]";

// ---------------------------------------------------------------------------
// Configuração (flags de rollout — todas fail-closed)
// ---------------------------------------------------------------------------

export const NOMUS_PO_SCHEDULE_SOURCE_ENV = "NOMUS_PO_SCHEDULE_SOURCE";
export const NOMUS_PO_RECONCILE_PREVIEW_ONLY_ENV = "NOMUS_PO_RECONCILE_PREVIEW_ONLY";
export const NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENV = "NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED";
export const NOMUS_PO_DIRECTED_LOOKUP_ENV = "NOMUS_PO_DIRECTED_LOOKUP_ENABLED";
export const NOMUS_PO_DIRECTED_LOOKUP_TRUST_404_ENV = "NOMUS_PO_DIRECTED_LOOKUP_TRUST_404";

export type PurchaseOrderScheduleSource = "chain" | "independent";

/** Fonte única de agendamento ativa. Padrão `chain` (comportamento legado) até a transição. */
export function resolvePurchaseOrderScheduleSource(env: NodeJS.ProcessEnv = process.env): PurchaseOrderScheduleSource {
  return (env[NOMUS_PO_SCHEDULE_SOURCE_ENV] ?? "").trim().toLowerCase() === "independent" ? "independent" : "chain";
}

/** Disparos agendados só rodam se forem da fonte ativa; painel/CLI/auditoria sempre rodam. */
export function isPurchaseOrderTriggerAllowed(
  trigger: string,
  source: PurchaseOrderScheduleSource
): { allowed: boolean; reason: string | null } {
  if (trigger === "SCHEDULED_HOURLY" || trigger === "SCHEDULED_DAILY") {
    return source === "independent"
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "INDEPENDENT_SCHEDULE_INACTIVE_SOURCE_IS_CHAIN" };
  }
  if (trigger === "CHAIN_AFTER_AR") {
    return source === "chain"
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "CHAIN_AFTER_AR_INACTIVE_SOURCE_IS_INDEPENDENT" };
  }
  return { allowed: true, reason: null };
}

function flagOn(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = (env[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt((env[key] ?? "").trim(), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export type PurchaseOrderSyncFlags = {
  scheduleSource: PurchaseOrderScheduleSource;
  absenceReconciliationEnabled: boolean;
  /** Padrão true: ausências só calculadas e registradas no run, nunca gravadas no pedido. */
  previewOnly: boolean;
  applyConfirmedEnabled: boolean;
  directedLookupEnabled: boolean;
  directedLookupTrust404: boolean;
  respectGlobalLock: boolean;
  globalLockWaitSeconds: number;
  reconcileScope: "full" | "window";
  incrementalMaxPages: number;
  reconcileMaxPages: number;
  directedLookupMax: number;
};

export function resolvePurchaseOrderSyncFlags(env: NodeJS.ProcessEnv = process.env): PurchaseOrderSyncFlags {
  return {
    scheduleSource: resolvePurchaseOrderScheduleSource(env),
    absenceReconciliationEnabled: isNomusPurchaseOrderAbsenceReconciliationEnabled(env),
    previewOnly: flagOn(env, NOMUS_PO_RECONCILE_PREVIEW_ONLY_ENV, true),
    applyConfirmedEnabled: flagOn(env, NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENV, false),
    directedLookupEnabled: flagOn(env, NOMUS_PO_DIRECTED_LOOKUP_ENV, false),
    directedLookupTrust404: flagOn(env, NOMUS_PO_DIRECTED_LOOKUP_TRUST_404_ENV, false),
    respectGlobalLock: flagOn(env, "NOMUS_PO_RESPECT_GLOBAL_LOCK", true),
    globalLockWaitSeconds: intEnv(env, "NOMUS_PO_GLOBAL_LOCK_WAIT_SECONDS", 1800, 1, 7200),
    reconcileScope: (env.NOMUS_PO_RECONCILE_SCOPE ?? "").trim().toLowerCase() === "window" ? "window" : "full",
    incrementalMaxPages: intEnv(env, "NOMUS_PO_INCREMENTAL_MAX_PAGES", 80, 1, 2000),
    reconcileMaxPages: intEnv(env, "NOMUS_PO_RECONCILE_MAX_PAGES", 200, 1, 5000),
    directedLookupMax: intEnv(env, "NOMUS_PO_DIRECTED_LOOKUP_MAX", 20, 1, 500),
  };
}

// ---------------------------------------------------------------------------
// Dependências injetáveis (testes PG17 usam fetch falso; nunca o Nomus real)
// ---------------------------------------------------------------------------

export type PurchaseOrderSyncDeps = {
  prisma: PrismaClient;
  fetchJson: (url: URL, options?: FetchNomusJsonOptions) => Promise<unknown>;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  probeGlobalLockHeld: () => boolean;
  waitForGlobalLockToFree: (timeoutSeconds: number) => boolean;
  log: (line: string) => void;
};

let sharedPrisma: PrismaClient | null = null;

async function defaultDeps(): Promise<PurchaseOrderSyncDeps> {
  if (!sharedPrisma) {
    const { PrismaClient: Client } = await import("@prisma/client");
    sharedPrisma = new Client();
  }
  return {
    prisma: sharedPrisma,
    fetchJson: fetchNomusJson,
    env: process.env,
    now: () => new Date(),
    probeGlobalLockHeld: () => probeGlobalNomusSyncLockHeld(),
    waitForGlobalLockToFree: (s) => waitForGlobalNomusSyncLockToFree(s),
    log: (line) => console.warn(line),
  };
}

export async function disconnectPurchaseOrderSyncPrisma(): Promise<void> {
  if (sharedPrisma) {
    await sharedPrisma.$disconnect();
    sharedPrisma = null;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Mensagem de erro sem URL, corpo de resposta ou cabeçalhos. */
export function sanitizePurchaseOrderSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const http = /^Falha HTTP (\d{3})/.exec(message);
  if (http) return `Falha HTTP ${http[1]} no Nomus (${NOMUS_PURCHASE_ORDER_RESOURCE})`;
  return message
    .replace(/https?:\/\/\S+/gi, "<url>")
    // Palavra-chave + esquema opcional (Basic/Bearer) + o valor que vem depois.
    .replace(/(authorization|bearer|basic|token|senha|password)\S*([:=\s]+(basic|bearer)\b)?[:=\s]*\S*/gi, "<redacted>")
    .slice(0, 300);
}

export function extractNomusHttpStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const http = /^Falha HTTP (\d{3})/.exec(message);
  return http ? Number(http[1]) : null;
}

function parseBrDate(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

/** Atraso em relação ao horário oficial do disparo agendado (diagnóstico de execução atrasada). */
export function computePurchaseOrderScheduleDelaySeconds(trigger: string, startedAt: Date): number | null {
  if (trigger === "SCHEDULED_HOURLY") {
    const slot = new Date(startedAt);
    slot.setUTCMinutes(37, 0, 0);
    if (slot.getTime() > startedAt.getTime()) slot.setUTCHours(slot.getUTCHours() - 1);
    return Math.round((startedAt.getTime() - slot.getTime()) / 1000);
  }
  if (trigger === "SCHEDULED_DAILY") {
    // 03:37 America/Sao_Paulo = 06:37 UTC (sem horário de verão desde 2019).
    const slot = new Date(startedAt);
    slot.setUTCHours(6, 37, 0, 0);
    if (slot.getTime() > startedAt.getTime()) slot.setUTCDate(slot.getUTCDate() - 1);
    return Math.round((startedAt.getTime() - slot.getTime()) / 1000);
  }
  return null;
}

type FetchOutcome = {
  meta: PurchaseOrderFetchMeta;
  rows: MappedNomusPurchaseOrder[];
  /** IDs oficiais retornados que não mapearam — presença comprovada mesmo sem conteúdo. */
  unmappedIds: number[];
  issuedAtMissing: number;
};

async function fetchPurchaseOrderUniverse(args: {
  deps: PurchaseOrderSyncDeps;
  baseUrl: string;
  strategy: PurchaseOrderSyncStrategy;
  window: { startDate: string; endDate: string } | null;
  maxPages: number;
  dateFilterValidated: boolean;
}): Promise<FetchOutcome> {
  const { deps } = args;
  const pageSize = resolvePurchaseOrderPageSize(deps.env);
  const windowFrom = args.window ? parseBrDate(args.window.startDate) : null;
  const windowTo = args.window ? parseBrDate(args.window.endDate) : null;
  const meta: PurchaseOrderFetchMeta = {
    strategy: args.strategy,
    requestedWindow: windowFrom && windowTo ? { from: windowFrom, to: windowTo } : null,
    startPage: 1,
    pagesRead: 0,
    recordsRead: 0,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: false,
    stoppedBecauseMaxPages: false,
    fetchFailed: false,
    fetchError: null,
    http429Count: 0,
    mapErrorsIdentified: 0,
    unidentifiedRecords: 0,
    duplicateRecords: 0,
    returnedOutsideWindow: 0,
    dateFilterValidated: args.dateFilterValidated,
    malformedPages: 0,
  };
  const byId = new Map<number, MappedNomusPurchaseOrder>();
  const unmapped = new Set<number>();
  let issuedAtMissing = 0;
  const dayMs = 86_400_000;

  try {
    for (let page = 1; page <= args.maxPages; page += 1) {
      const url = buildNomusUrl(
        args.baseUrl,
        NOMUS_PURCHASE_ORDER_RESOURCE,
        buildPurchaseOrderPageParams(page, pageSize, args.window ?? undefined)
      );
      const payload = await deps.fetchJson(url, {
        logPrefix: LOG_PREFIX,
        logContext: { resource: NOMUS_PURCHASE_ORDER_RESOURCE, page },
        onRetryableStatus: ({ status }) => {
          if (status === 429) meta.http429Count += 1;
        },
      });
      if (!isRecognizedPurchaseOrderPagePayload(payload)) {
        // Corpo inesperado: nunca tratar como fim da paginação.
        meta.pagesRead += 1;
        meta.malformedPages = (meta.malformedPages ?? 0) + 1;
        break;
      }
      const items = pickPurchaseOrderPageItems(payload);
      meta.pagesRead += 1;
      meta.recordsRead += items.length;

      for (const item of items) {
        const mapped = mapNomusPurchaseOrderPayload(item);
        if (!mapped.ok) {
          const failedId = (mapped as MapFailure).externalId;
          if (failedId == null) meta.unidentifiedRecords += 1;
          else {
            meta.mapErrorsIdentified += 1;
            unmapped.add(failedId);
          }
          continue;
        }
        const row = (mapped as MapSuccess).row;
        if (byId.has(row.externalId)) meta.duplicateRecords += 1;
        byId.set(row.externalId, row);
        if (windowFrom && windowTo) {
          if (!row.issuedAt) issuedAtMissing += 1;
          else if (
            row.issuedAt.getTime() < windowFrom.getTime() - dayMs ||
            row.issuedAt.getTime() > windowTo.getTime() + 2 * dayMs
          ) {
            meta.returnedOutsideWindow += 1;
          }
        }
      }

      if (items.length === 0) {
        meta.stoppedBecauseEmpty = true;
        break;
      }
      if (!hasNextPurchaseOrderPage(payload, page, items.length, pageSize)) {
        meta.stoppedBecauseNoNext = true;
        break;
      }
      if (page >= args.maxPages) {
        meta.stoppedBecauseMaxPages = true;
        break;
      }
    }
  } catch (error) {
    meta.fetchFailed = true;
    meta.fetchError = sanitizePurchaseOrderSyncError(error);
  }

  return { meta, rows: [...byId.values()], unmappedIds: [...unmapped].filter((id) => !byId.has(id)), issuedAtMissing };
}

export type PurchaseOrderDirectedLookupOutcome =
  | { status: "found"; row: MappedNomusPurchaseOrder | null }
  | { status: "not_found"; httpStatus: number }
  | { status: "inconclusive"; reason: string };

/**
 * GET pedidoscompra/{id}. 200 com o mesmo ID = encontrado (protege o registro).
 * 404 só vira "not_found" com NOMUS_PO_DIRECTED_LOOKUP_TRUST_404=1 (semântica validada em homologação);
 * qualquer outra resposta é inconclusiva.
 */
export async function lookupNomusPurchaseOrderById(args: {
  deps: Pick<PurchaseOrderSyncDeps, "fetchJson">;
  baseUrl: string;
  externalId: number;
  trust404: boolean;
}): Promise<PurchaseOrderDirectedLookupOutcome> {
  const url = buildNomusUrl(args.baseUrl, `${NOMUS_PURCHASE_ORDER_RESOURCE}/${args.externalId}`, {});
  try {
    const payload = await args.deps.fetchJson(url, {
      logPrefix: `${LOG_PREFIX}[lookup]`,
      logContext: { resource: NOMUS_PURCHASE_ORDER_RESOURCE, id: args.externalId },
      maxRetries: 3,
    });
    const candidates = Array.isArray(payload) ? payload : [payload];
    for (const raw of candidates) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const mapped = mapNomusPurchaseOrderPayload(raw as Record<string, unknown>);
      if (mapped.ok) {
        const row = (mapped as MapSuccess).row;
        if (row.externalId === args.externalId) return { status: "found", row };
      } else if ((mapped as MapFailure).externalId === args.externalId) {
        return { status: "found", row: null };
      }
    }
    return { status: "inconclusive", reason: "LOOKUP_200_WITHOUT_MATCHING_ID" };
  } catch (error) {
    const status = extractNomusHttpStatus(error);
    if (status === 404 && args.trust404) return { status: "not_found", httpStatus: 404 };
    return {
      status: "inconclusive",
      reason: status === 404 ? "LOOKUP_404_SEMANTICS_NOT_VALIDATED" : sanitizePurchaseOrderSyncError(error),
    };
  }
}

async function loadPurchaseOrderLifecycleLocals(prisma: PrismaClient): Promise<PurchaseOrderLifecycleLocal[]> {
  const rows = await prisma.nomusPurchaseOrder.findMany({
    select: {
      id: true,
      externalId: true,
      orderNumber: true,
      payloadHash: true,
      issuedAt: true,
      sourcePresenceStatus: true,
      presentInLastPayload: true,
      missingConsecutiveRuns: true,
      missingSince: true,
      sourceRemovedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      lastSyncRunId: true,
    },
    orderBy: { externalId: "asc" },
  });
  return rows.map((r) => ({
    localId: r.id,
    externalId: r.externalId,
    orderNumber: r.orderNumber,
    payloadHash: r.payloadHash,
    issuedAt: r.issuedAt,
    sourcePresenceStatus: r.sourcePresenceStatus,
    presentInLastPayload: r.presentInLastPayload,
    missingConsecutiveRuns: r.missingConsecutiveRuns,
    missingSince: r.missingSince,
    sourceRemovedAt: r.sourceRemovedAt,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    lastSyncRunId: r.lastSyncRunId,
  }));
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function patchToPurchaseOrderData(patch: NomusSourceLifecyclePatch): Prisma.NomusPurchaseOrderUncheckedUpdateInput {
  const data: Prisma.NomusPurchaseOrderUncheckedUpdateInput = {
    sourcePresenceStatus: patch.sourcePresenceStatus,
    presentInLastPayload: patch.presentInLastPayload,
    missingConsecutiveRuns: patch.missingConsecutiveRuns,
    missingSince: toDateOrNull(patch.missingSince),
    sourceRemovedAt: toDateOrNull(patch.sourceRemovedAt),
    lastSyncRunId: patch.lastSyncRunId,
  };
  const lastSeen = toDateOrNull(patch.lastSeenAt);
  if (lastSeen) data.lastSeenAt = lastSeen;
  return data;
}

async function createRun(args: {
  prisma: PrismaClient;
  strategy: string;
  scope: Record<string, unknown>;
  startedAt: Date;
  status?: "RUNNING" | "SKIPPED";
  summaryJson?: Record<string, unknown>;
  coveredFrom?: Date | null;
  coveredTo?: Date | null;
}): Promise<string> {
  const run = await args.prisma.nomusSourceSyncRun.create({
    data: {
      entityType: "PURCHASE_ORDER",
      strategy: args.strategy,
      scope: args.scope as Prisma.InputJsonValue,
      startedAt: args.startedAt,
      status: args.status ?? "RUNNING",
      payloadComplete: false,
      coveredFrom: args.coveredFrom ?? null,
      coveredTo: args.coveredTo ?? null,
      finishedAt: args.status === "SKIPPED" ? args.startedAt : null,
      summaryJson: (args.summaryJson ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true },
  });
  return run.id;
}

/** Registra um disparo pulado (lock ocupado, fonte inativa, espera do lock global esgotada). */
export async function recordPurchaseOrderSkippedRun(args: {
  prisma: PrismaClient;
  strategy: string;
  trigger: string;
  reason: string;
  startedAt: Date;
  correlationId?: string | null;
  extra?: Record<string, unknown>;
}): Promise<string> {
  return createRun({
    prisma: args.prisma,
    strategy: args.strategy,
    scope: { kind: "purchase_orders_skipped", strategy: args.strategy },
    startedAt: args.startedAt,
    status: "SKIPPED",
    summaryJson: {
      trigger: args.trigger,
      skipReason: args.reason,
      correlationId: args.correlationId ?? null,
      ...(args.extra ?? {}),
    },
  });
}

const SAMPLE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export async function executeNomusPurchaseOrdersSync(
  execution: NomusCanonicalSyncExecution,
  injected?: Partial<PurchaseOrderSyncDeps>
): Promise<NomusCanonicalSyncDelegateResult> {
  const base = injected?.prisma ? null : await defaultDeps();
  const deps: PurchaseOrderSyncDeps = {
    fetchJson: fetchNomusJson,
    env: process.env,
    now: () => new Date(),
    probeGlobalLockHeld: () => probeGlobalNomusSyncLockHeld(),
    waitForGlobalLockToFree: (s) => waitForGlobalNomusSyncLockToFree(s),
    log: (line) => console.warn(line),
    ...base,
    ...injected,
  } as PurchaseOrderSyncDeps;

  const { prisma, env, log } = deps;
  const flags = resolvePurchaseOrderSyncFlags(env);
  const strategy = execution.strategy as PurchaseOrderSyncStrategy;
  const isPreview = execution.mode === "preview";
  const strategyLabel = isPreview ? `${strategy}_PREVIEW` : strategy;
  const trigger = execution.sourceTrigger;
  const startedAt = deps.now();

  // 1. Fonte única de agendamento.
  const gate = isPurchaseOrderTriggerAllowed(trigger, flags.scheduleSource);
  if (!gate.allowed) {
    const runId = await recordPurchaseOrderSkippedRun({
      prisma,
      strategy: strategyLabel,
      trigger,
      reason: gate.reason ?? "SCHEDULE_SOURCE_INACTIVE",
      startedAt,
      correlationId: execution.correlationId,
      extra: { scheduleSource: flags.scheduleSource },
    });
    log(`${LOG_PREFIX} SKIPPED reason=${gate.reason} trigger=${trigger} source=${flags.scheduleSource} runId=${runId}`);
    return {
      status: "SKIPPED_SCHEDULE_SOURCE",
      runId,
      payloadComplete: null,
      hasRelevantChanges: false,
      message: `Disparo ${trigger} ignorado: fonte de agendamento ativa = ${flags.scheduleSource}.`,
    };
  }

  // 2. Lock global (orquestrador/Pedidos de Venda): sonda e espera, nunca adquire.
  if (flags.respectGlobalLock && deps.probeGlobalLockHeld()) {
    log(`${LOG_PREFIX} lock global ocupado; aguardando até ${flags.globalLockWaitSeconds}s`);
    const freed = deps.waitForGlobalLockToFree(flags.globalLockWaitSeconds);
    if (!freed) {
      const runId = await recordPurchaseOrderSkippedRun({
        prisma,
        strategy: strategyLabel,
        trigger,
        reason: "GLOBAL_LOCK_WAIT_TIMEOUT",
        startedAt,
        correlationId: execution.correlationId,
        extra: { waitedSeconds: flags.globalLockWaitSeconds },
      });
      log(`${LOG_PREFIX} SKIPPED reason=GLOBAL_LOCK_WAIT_TIMEOUT runId=${runId}`);
      return {
        status: "SKIPPED_LOCKED",
        runId,
        payloadComplete: null,
        hasRelevantChanges: false,
        message: "Lock global Nomus ocupado além do tempo de espera; execução pulada (não é sucesso).",
      };
    }
  }

  const baseUrl = (env.NOMUS_BASE_URL ?? "").trim();
  const windowInput =
    strategy === "RECENT_WINDOW"
      ? resolvePurchaseOrderWindow({ now: startedAt, incremental: true, backfill: false })
      : strategy === "FULL_RECONCILIATION" && flags.reconcileScope === "window"
        ? resolvePurchaseOrderWindow({ now: startedAt, incremental: false, backfill: true })
        : null;
  const window = windowInput ? { startDate: windowInput.startDate, endDate: windowInput.endDate } : null;
  const windowDates = window
    ? { from: parseBrDate(window.startDate) as Date, to: parseBrDate(window.endDate) as Date }
    : null;
  const targetExternalIdRaw = Number.parseInt(String(execution.targetExternalId ?? ""), 10);
  const scope = buildPurchaseOrderRunScope({
    strategy,
    window: windowDates,
    targetExternalId: Number.isFinite(targetExternalIdRaw) ? targetExternalIdRaw : null,
  });
  const scheduleDelaySeconds = computePurchaseOrderScheduleDelaySeconds(trigger, startedAt);

  // 3. Run RUNNING.
  const runId = await createRun({
    prisma,
    strategy: strategyLabel,
    scope: { ...scope, trigger, correlationId: execution.correlationId },
    startedAt,
    coveredFrom: windowDates?.from ?? null,
    coveredTo: windowDates?.to ?? null,
  });
  log(
    `${LOG_PREFIX} RUN_STARTED runId=${runId} trigger=${trigger} strategy=${strategyLabel} scope=${scope.kind} window=${window ? `${window.startDate}..${window.endDate}` : "sem filtro"}`
  );

  const summary: Record<string, unknown> = {
    trigger,
    correlationId: execution.correlationId,
    requestedBy: execution.requestedBy,
    scheduleSource: flags.scheduleSource,
    scheduleDelaySeconds,
    mode: execution.mode,
    strategy,
    scopeKind: scope.kind,
    window,
    flags: {
      absenceReconciliationEnabled: flags.absenceReconciliationEnabled,
      previewOnly: flags.previewOnly,
      applyConfirmedEnabled: flags.applyConfirmedEnabled,
      directedLookupEnabled: flags.directedLookupEnabled,
      directedLookupTrust404: flags.directedLookupTrust404,
    },
  };

  try {
    if (!baseUrl) throw new Error("Variável obrigatória ausente: NOMUS_BASE_URL");

    // 4. Busca.
    let fetched: FetchOutcome;
    if (strategy === "TARGETED_LOOKUP") {
      const target = Number.parseInt(String(execution.targetExternalId ?? ""), 10);
      if (!Number.isFinite(target) || target <= 0) throw new Error("TARGETED_LOOKUP exige targetExternalId numérico.");
      const lookup = await lookupNomusPurchaseOrderById({
        deps,
        baseUrl,
        externalId: target,
        trust404: flags.directedLookupTrust404,
      });
      summary.targetedLookup = { externalId: target, status: lookup.status, reason: lookup.status === "inconclusive" ? lookup.reason : null };
      fetched = {
        meta: {
          strategy,
          requestedWindow: null,
          startPage: 1,
          pagesRead: 1,
          recordsRead: lookup.status === "found" ? 1 : 0,
          stoppedBecauseEmpty: false,
          stoppedBecauseNoNext: true,
          stoppedBecauseMaxPages: false,
          fetchFailed: lookup.status === "inconclusive",
          fetchError: lookup.status === "inconclusive" ? lookup.reason : null,
          http429Count: 0,
          mapErrorsIdentified: lookup.status === "found" && !lookup.row ? 1 : 0,
          unidentifiedRecords: 0,
          duplicateRecords: 0,
          returnedOutsideWindow: 0,
        },
        rows: lookup.status === "found" && lookup.row ? [lookup.row] : [],
        unmappedIds: lookup.status === "found" && !lookup.row ? [target] : [],
        issuedAtMissing: 0,
      };
    } else {
      fetched = await fetchPurchaseOrderUniverse({
        deps,
        baseUrl,
        strategy,
        window,
        maxPages: strategy === "RECENT_WINDOW" ? flags.incrementalMaxPages : flags.reconcileMaxPages,
        dateFilterValidated: flagOn(env, "NOMUS_PO_DATE_FILTER_VALIDATED", false),
      });
    }

    let completeness: PurchaseOrderFetchCompleteness = assessPurchaseOrderFetchCompleteness(fetched.meta);
    if (strategy === "TARGETED_LOOKUP") {
      // Consulta pontual nunca prova universo: só atualiza/reativa o próprio pedido.
      completeness = { ...completeness, payloadComplete: false, reasons: [...completeness.reasons, "TARGETED_LOOKUP_NOT_A_UNIVERSE"] };
    }

    // 5. Upsert + presença dos encontrados.
    let applied = { created: 0, updated: 0, unchanged: 0, errors: 0 };
    if (!isPreview && fetched.rows.length > 0) {
      applied = await applyNomusPurchaseOrderRows(prisma, fetched.rows, deps.now());
    }
    if (applied.errors > 0) {
      completeness = {
        ...completeness,
        payloadComplete: false,
        runStatus: completeness.runStatus === "FAILED" ? "FAILED" : "INCONCLUSIVE",
        reasons: [...new Set([...completeness.reasons, "APPLY_ERRORS_PARTIAL_PERSIST", "ABSENCE_CONFIRMATION_BLOCKED"])],
      };
    }

    const locals = await loadPurchaseOrderLifecycleLocals(prisma);
    const localsById = new Map(locals.map((l) => [l.localId, l]));
    if (strategy === "FULL_RECONCILIATION" && fetched.meta.recordsRead === 0 && locals.length > 0 && completeness.payloadComplete) {
      // Universo vazio com pedidos locais: resposta anômala, nunca evidência de exclusão.
      completeness = {
        ...completeness,
        payloadComplete: false,
        runStatus: "INCONCLUSIVE",
        reasons: [...new Set([...completeness.reasons, "EMPTY_UNIVERSE_WITH_LOCAL_RECORDS", "ABSENCE_CONFIRMATION_BLOCKED"])],
      };
    }
    const foundRecords = [
      ...fetched.rows.map((r) => ({ externalId: r.externalId, payloadHash: r.payloadHash })),
      // Sem conteúdo mapeável: hash vazio (nunca "inalterado"), presença comprovada.
      ...fetched.unmappedIds.map((externalId) => ({ externalId, payloadHash: "" })),
    ];
    const foundSet = new Set(foundRecords.map((r) => r.externalId));

    // Prévia (mode=preview) só lê: mostra o que uma aplicação autorizada faria, mesmo com a
    // reconciliação desligada. Aplicação exige flag da entidade + permissão canônica.
    const absenceDetectionAllowed =
      strategy === "FULL_RECONCILIATION" &&
      (isPreview || (flags.absenceReconciliationEnabled && execution.allowMissingDetection === true));
    const absenceConfirmationAllowed = absenceDetectionAllowed && flags.applyConfirmedEnabled;

    // Consulta direcionada para quem não apareceu na varredura (só leitura no Nomus).
    const directedLookups: Array<{ externalId: number; found: boolean }> = [];
    const directedSummary = { attempted: 0, found: 0, notFound: 0, inconclusive: 0 };
    if (absenceDetectionAllowed && completeness.payloadComplete && flags.directedLookupEnabled) {
      const pending = locals.filter(
        (l) => !foundSet.has(l.externalId) && l.lastSyncRunId !== runId && l.sourcePresenceStatus !== "MISSING_CONFIRMED"
      );
      for (const local of pending.slice(0, flags.directedLookupMax)) {
        directedSummary.attempted += 1;
        const outcome = await lookupNomusPurchaseOrderById({
          deps,
          baseUrl,
          externalId: local.externalId,
          trust404: flags.directedLookupTrust404,
        });
        if (outcome.status === "found") {
          directedSummary.found += 1;
          directedLookups.push({ externalId: local.externalId, found: true });
        } else if (outcome.status === "not_found") {
          directedSummary.notFound += 1;
          directedLookups.push({ externalId: local.externalId, found: false });
        } else {
          directedSummary.inconclusive += 1;
        }
      }
      if (directedSummary.found > 0) {
        // A listagem omitiu pedido que existe por ID → a listagem não é o universo completo.
        completeness = {
          ...completeness,
          reasons: [...new Set([...completeness.reasons, "LIST_OMITTED_EXISTING_ORDER"])],
        };
      }
    }
    summary.directedLookup = directedSummary;

    const policy = resolvePurchaseOrderReconciliationPolicy(env);
    const reconciliation = buildPurchaseOrderSourceReconciliationPlan({
      strategy,
      scope,
      completeness,
      absenceDetectionAllowed,
      absenceConfirmationAllowed,
      found: foundRecords,
      locals,
      directedLookups,
      executedAt: startedAt,
      runId,
      mode: isPreview ? "preview" : "apply",
      policy,
    });
    const { plan, guards, alerts } = reconciliation;

    // 6. Escritas de presença.
    let absenceWritesApplied = false;
    let eventsWritten = 0;
    if (!isPreview) {
      const presentIds = [...plan.updates, ...plan.unchanged]
        .map((item) => item.localId)
        .filter((id): id is string => !!id);
      for (let i = 0; i < presentIds.length; i += 500) {
        await prisma.nomusPurchaseOrder.updateMany({
          where: { id: { in: presentIds.slice(i, i + 500) } },
          data: {
            sourcePresenceStatus: "PRESENT",
            presentInLastPayload: true,
            missingSince: null,
            missingConsecutiveRuns: 0,
            sourceRemovedAt: null,
            lastSyncRunId: runId,
          },
        });
      }

      const absenceItems = [...plan.missingCandidates, ...plan.missingConfirmed];
      const writeAbsences = absenceItems.length > 0 && !flags.previewOnly;
      absenceWritesApplied = writeAbsences;
      const toWrite = [...plan.reactivated, ...(writeAbsences ? absenceItems : [])].filter(
        (item) => item.localId && item.lifecyclePatch
      );
      const eventPlan = { ...plan, missingCandidates: writeAbsences ? plan.missingCandidates : [], missingConfirmed: writeAbsences ? plan.missingConfirmed : [] };
      const events = buildPurchaseOrderPresenceEvents(eventPlan, localsById);
      const eventsByLocal = new Map(events.map((e) => [e.purchaseOrderId, e]));
      for (let i = 0; i < toWrite.length; i += 50) {
        const batch = toWrite.slice(i, i + 50);
        await prisma.$transaction(async (tx) => {
          for (const item of batch) {
            await tx.nomusPurchaseOrder.update({
              where: { id: item.localId as string },
              data: patchToPurchaseOrderData(item.lifecyclePatch as NomusSourceLifecyclePatch),
            });
            const event = eventsByLocal.get(item.localId as string);
            if (event) {
              await tx.nomusPurchaseOrderPresenceEvent.create({
                data: {
                  purchaseOrderId: event.purchaseOrderId,
                  externalId: event.externalId,
                  syncRunId: runId,
                  action: event.action,
                  fromStatus: event.fromStatus,
                  toStatus: event.toStatus,
                  reason: event.reason,
                  missingConsecutiveRuns: event.missingConsecutiveRuns,
                  occurredAt: startedAt,
                  evidenceJson: {
                    strategy,
                    scopeKind: scope.kind,
                    trigger,
                    pagesRead: fetched.meta.pagesRead,
                    recordsRead: fetched.meta.recordsRead,
                    payloadComplete: completeness.payloadComplete,
                    directedLookup: directedLookups.find((d) => d.externalId === event.externalId) ?? null,
                  } as Prisma.InputJsonValue,
                },
              });
              eventsWritten += 1;
            }
          }
        });
      }
    }

    for (const alert of alerts) {
      log(`${LOG_PREFIX} ALERT code=${alert.code} severity=${alert.severity} runId=${runId} ${alert.message}`);
    }

    const sample = (items: typeof plan.missingCandidates) =>
      items.slice(0, SAMPLE_LIMIT).map((item) => {
        const local = item.localId ? localsById.get(item.localId) : undefined;
        return {
          externalId: Number(item.externalId),
          orderNumber: local?.orderNumber ?? null,
          reason: item.reason,
          from: item.previousPresenceStatus,
          to: item.nextPresenceStatus,
        };
      });

    const finalStatus = completeness.runStatus;
    const errorsCount = (fetched.meta.fetchFailed ? 1 : 0) + applied.errors + fetched.meta.unidentifiedRecords;
    Object.assign(summary, {
      fetch: {
        pagesRead: fetched.meta.pagesRead,
        recordsRead: fetched.meta.recordsRead,
        mapped: fetched.rows.length,
        stoppedBecauseEmpty: fetched.meta.stoppedBecauseEmpty,
        stoppedBecauseNoNext: fetched.meta.stoppedBecauseNoNext,
        stoppedBecauseMaxPages: fetched.meta.stoppedBecauseMaxPages,
        fetchFailed: fetched.meta.fetchFailed,
        http429Count: fetched.meta.http429Count,
        unidentifiedRecords: fetched.meta.unidentifiedRecords,
        mapErrorsIdentified: fetched.meta.mapErrorsIdentified,
        duplicateRecords: fetched.meta.duplicateRecords,
        returnedOutsideWindow: fetched.meta.returnedOutsideWindow,
        issuedAtMissing: fetched.issuedAtMissing,
      },
      completeness,
      applied,
      canceledInPayload: fetched.rows.filter((r) => r.stage === "CANCELED").length,
      plan: {
        absencesEvaluated: plan.absencesEvaluated,
        counters: plan.counters,
        reasons: plan.reasons,
      },
      guards,
      alerts,
      previewOnly: flags.previewOnly,
      absenceWritesApplied,
      eventsWritten,
      missingCandidatesSample: sample(plan.missingCandidates),
      missingConfirmedSample: sample(plan.missingConfirmed),
      reactivatedSample: sample(plan.reactivated),
      partial: finalStatus !== "SUCCESS",
      durationMs: deps.now().getTime() - startedAt.getTime(),
    });

    const absenceCountsApplied = absenceWritesApplied || isPreview;
    await prisma.nomusSourceSyncRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        payloadComplete: completeness.payloadComplete,
        finishedAt: deps.now(),
        pagesRead: fetched.meta.pagesRead,
        rowsRead: fetched.meta.recordsRead,
        createdCount: applied.created,
        updatedCount: applied.updated,
        unchangedCount: applied.unchanged,
        // Em só-prévia, contagens ficam no resumo; o run não afirma ausência gravada.
        missingCandidateCount: absenceCountsApplied ? plan.counters.missingCandidates : 0,
        missingConfirmedCount: absenceCountsApplied ? plan.counters.missingConfirmed : 0,
        reactivatedCount: plan.counters.reactivated,
        http429Count: fetched.meta.http429Count,
        errors: errorsCount,
        errorMessage: fetched.meta.fetchError ?? (applied.errors > 0 ? `${applied.errors} pedido(s) não persistido(s)` : null),
        summaryJson: summary as Prisma.InputJsonValue,
      },
    });

    log(
      `${LOG_PREFIX} ${finalStatus} runId=${runId} pages=${fetched.meta.pagesRead} records=${fetched.meta.recordsRead} created=${applied.created} updated=${applied.updated} unchanged=${applied.unchanged} candidates=${plan.counters.missingCandidates} confirmed=${plan.counters.missingConfirmed} reactivated=${plan.counters.reactivated} payloadComplete=${completeness.payloadComplete} previewOnly=${flags.previewOnly} reasons=${completeness.reasons.join(",")}`
    );

    return {
      status: finalStatus,
      runId,
      payloadComplete: completeness.payloadComplete,
      hasRelevantChanges: applied.created + applied.updated + plan.counters.reactivated > 0 || absenceWritesApplied,
      counters: {
        pagesRead: fetched.meta.pagesRead,
        rowsRead: fetched.meta.recordsRead,
        created: applied.created,
        updated: applied.updated,
        unchanged: applied.unchanged,
        reactivated: plan.counters.reactivated,
        missingCandidates: plan.counters.missingCandidates,
        missingConfirmed: plan.counters.missingConfirmed,
        errors: errorsCount,
        http429: fetched.meta.http429Count,
      },
      message:
        finalStatus === "SUCCESS"
          ? undefined
          : `Execução ${finalStatus}: ${fetched.meta.fetchError ?? completeness.reasons.join(", ")}`,
    };
  } catch (error) {
    const message = sanitizePurchaseOrderSyncError(error);
    log(`${LOG_PREFIX} FAILED runId=${runId} ${message}`);
    await prisma.nomusSourceSyncRun
      .update({
        where: { id: runId },
        data: {
          status: "FAILED",
          payloadComplete: false,
          finishedAt: deps.now(),
          errors: 1,
          errorMessage: message,
          summaryJson: { ...summary, partial: true, error: message } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
    return { status: "FAILED", runId, payloadComplete: false, hasRelevantChanges: false, message };
  }
}

/** Código de saída do CLI: sucesso/pulado 0, inconclusivo 3, falha 1. Lock ocupado nunca é sucesso silencioso. */
export function purchaseOrderSyncExitCode(status: string): number {
  if (status === "SUCCESS" || status === "SUCCESS_WITH_ERRORS") return 0;
  if (status === "SKIPPED_LOCKED" || status === "SKIPPED_SCHEDULE_SOURCE" || status === "SKIPPED_FLAG") return 0;
  if (status === "INCONCLUSIVE") return 3;
  return 1;
}
