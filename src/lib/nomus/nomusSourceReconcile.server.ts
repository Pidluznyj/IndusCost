/**
 * SYNC-08 — Runners de reconciliação histórica (preview/apply).
 * Preview não escreve. Apply: lock, lotes, run, retomada, só lifecycle.
 */

import type { PrismaClient } from "@prisma/client";
import {
  fetchNomusPedidosForAudit,
  lookupNomusPedidoByExternalId,
  lookupNomusPedidoByOrderCode,
  type DirectedPedidoLookupResult,
} from "../nomusSalesOrdersClient.js";
import { buildNomusUrl, fetchNomusJson } from "../nomusRestClient.js";
import {
  buildAccountsReceivablePageParams,
  computePaginationPlan,
  hasNextAccountsReceivablePage,
  pickAccountsReceivableArray,
  resolveAccountsReceivablePageSize,
  type JsonObject,
} from "../nomusAccountsReceivableSyncLogic.js";
import { mapNomusAccountsReceivablePayload } from "../nomusAccountsReceivableMapper.js";
import {
  buildAccountsPayablePageParams,
  computePaginationPlan as computeApPaginationPlan,
  hasNextAccountsPayablePage,
  pickAccountsPayableArray,
  resolveAccountsPayablePageSize,
} from "../nomusAccountsPayableSyncLogic.js";
import { mapNomusAccountsPayablePayload } from "../nomusAccountsPayableMapper.js";
import {
  SALES_ORDER_PILOT_ABSENCE,
  assessSalesOrderSyncPayloadCompleteness,
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  type SalesOrderFetchCompletenessAssessment,
  type SalesOrderLifecycleLocalSnapshot,
} from "./nomusSalesOrderSourceReconciliation.js";
import {
  assessTargetedSalesOrderLookupCompleteness,
  assertTargetedNomusIdentityConsistent,
  buildSalesOrderTargetedLookupScope,
  hasSalesOrderReconcileTarget,
  resolveSalesOrderReconcileTargetIdentity,
} from "./nomusSalesOrderTargetedReconcile.js";
import {
  ACCOUNTS_RECEIVABLE_PILOT,
  assessAccountsReceivableSyncPayloadCompleteness,
  buildAccountsReceivableSourceReconciliationPlan,
  buildAccountsReceivableSyncReconciliationScope,
  parseNomusFinancialOnlyPending,
  summarizeAccountsReceivableReconciliationPreview,
} from "./nomusAccountsReceivableSourceReconciliation.js";
import {
  assessAccountsPayableSyncPayloadCompleteness,
  buildAccountsPayableSourceReconciliationPlan,
  buildAccountsPayableSyncReconciliationScope,
  summarizeAccountsPayableReconciliationPreview,
} from "./nomusAccountsPayableSourceReconciliation.js";
import {
  acquireSalesOrderReconcileLock,
  applySalesOrderLifecyclePatches,
  createSalesOrderSourceSyncRun,
  finishSalesOrderSourceSyncRun,
  isSalesOrderAbsenceReconcileEnabled,
  loadSalesOrderLifecycleLocals,
} from "./nomusSalesOrderSourceReconciliation.server.js";
import {
  acquireAccountsReceivableReconcileLock,
  applyAccountsReceivableLifecyclePatches,
  createAccountsReceivableSourceSyncRun,
  finishAccountsReceivableSourceSyncRun,
  isAccountsReceivableAbsenceReconcileEnabled,
  loadAccountsReceivableLifecycleLocals,
  lookupNomusAccountsReceivableByExternalId,
} from "./nomusAccountsReceivableSourceReconciliation.server.js";
import {
  acquireAccountsPayableReconcileLock,
  applyAccountsPayableLifecyclePatches,
  createAccountsPayableSourceSyncRun,
  finishAccountsPayableSourceSyncRun,
  isAccountsPayableAbsenceReconcileEnabled,
  loadAccountsPayableLifecycleLocals,
  lookupNomusAccountsPayableByExternalId,
} from "./nomusAccountsPayableSourceReconciliation.server.js";
import type { NomusSourceLifecyclePatch } from "./nomusSourceReconciliationEngine.js";
import {
  assertLifecyclePatchOnly,
  buildNomusSourceReconcilePreviewReport,
  collectLifecyclePatchesFromPlan,
  formatReconcileReportCsv,
  parseNomusSourceReconcileCli,
  parseReconcileResumeCursor,
  planReconcileApplyBatches,
  serializeReconcileResumeCursor,
  type NomusSourceReconcileEntityCli,
} from "./nomusSourceReconcileCli.js";

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function parseDay(value: string | null, fallback: string): Date {
  const raw = (value ?? fallback).trim();
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${raw}`);
  return d;
}

async function applyPatchBatches(input: {
  entity: NomusSourceReconcileEntityCli;
  prisma: PrismaClient;
  patches: Array<{ localId: string; patch: NomusSourceLifecyclePatch }>;
  batchSize: number;
  resumeFromBatchIndex: number;
}): Promise<{ applied: number; nextBatchIndex: number; resumeCursor: string }> {
  for (const p of input.patches) {
    assertLifecyclePatchOnly(p.patch as unknown as Record<string, unknown>);
  }
  const { batches, startBatchIndex } = planReconcileApplyBatches(
    input.patches,
    input.batchSize,
    input.resumeFromBatchIndex
  );
  let applied = 0;
  let batchIndex = startBatchIndex;
  for (const batch of batches) {
    if (input.entity === "sales-orders") {
      applied += (
        await applySalesOrderLifecyclePatches({
          prisma: input.prisma,
          patches: batch,
        })
      ).applied;
    } else if (input.entity === "accounts-receivable") {
      applied += (
        await applyAccountsReceivableLifecyclePatches({
          prisma: input.prisma,
          patches: batch,
        })
      ).applied;
    } else {
      applied += (
        await applyAccountsPayableLifecyclePatches({
          prisma: input.prisma,
          patches: batch,
        })
      ).applied;
    }
    batchIndex += 1;
  }
  return {
    applied,
    nextBatchIndex: batchIndex,
    resumeCursor: serializeReconcileResumeCursor({
      version: 1,
      entity: input.entity,
      nextBatchIndex: batchIndex,
      applied,
      updatedAt: new Date().toISOString(),
    }),
  };
}

async function resolveTargetedNomusLookup(input: {
  baseUrl: string;
  from: Date;
  to: Date;
  env: NodeJS.ProcessEnv;
  externalId: number | null;
  orderCode: string | null;
}): Promise<DirectedPedidoLookupResult> {
  const byCode = input.orderCode?.trim()
    ? await lookupNomusPedidoByOrderCode({
        baseUrl: input.baseUrl,
        orderCode: input.orderCode,
        from: input.from,
        to: input.to,
        env: input.env,
      })
    : null;
  const byId =
    input.externalId != null
      ? await lookupNomusPedidoByExternalId({
          baseUrl: input.baseUrl,
          externalId: input.externalId,
          from: input.from,
          to: input.to,
          env: input.env,
        })
      : null;

  if (byCode?.status === "inconclusive") return byCode;
  if (byId?.status === "inconclusive") return byId;

  if (byCode?.status === "found" && byId?.status === "found") {
    if (
      byCode.pedido.externalSalesOrderId !== byId.pedido.externalSalesOrderId
    ) {
      throw new Error(
        `TARGET_IDENTITY_DIVERGENCE: lookup por orderCode=${input.orderCode} retornou id=${byCode.pedido.externalSalesOrderId}, por externalId=${input.externalId} retornou id=${byId.pedido.externalSalesOrderId}.`
      );
    }
    assertTargetedNomusIdentityConsistent({
      expectedExternalId: input.externalId,
      expectedOrderCode: input.orderCode,
      foundExternalId: byCode.pedido.externalSalesOrderId,
      foundOrderCode: byCode.pedido.orderCode,
    });
    return byCode;
  }

  if (byCode?.status === "found") {
    assertTargetedNomusIdentityConsistent({
      expectedExternalId: input.externalId,
      expectedOrderCode: input.orderCode,
      foundExternalId: byCode.pedido.externalSalesOrderId,
      foundOrderCode: byCode.pedido.orderCode,
    });
    return byCode;
  }

  if (byId?.status === "found") {
    assertTargetedNomusIdentityConsistent({
      expectedExternalId: input.externalId,
      expectedOrderCode: input.orderCode,
      foundExternalId: byId.pedido.externalSalesOrderId,
      foundOrderCode: byId.pedido.orderCode,
    });
    return byId;
  }

  return { status: "not_found" };
}

export async function runNomusSalesOrdersHistoricalReconcile(input: {
  prisma: PrismaClient;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  const env = input.env ?? process.env;
  const options = parseNomusSourceReconcileCli(input.argv, "sales-orders");
  const lock = acquireSalesOrderReconcileLock({ mode: options.mode, env });
  if (!lock.ok) {
    return { ok: false, lockBlocked: true, message: lock.message, writes: false };
  }

  try {
    const from = parseDay(options.from, "2020-01-01");
    const to = parseDay(options.to, "2030-12-31");
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    const baseUrl = requireEnv("NOMUS_BASE_URL", env);
    const targeted = hasSalesOrderReconcileTarget({
      externalId: options.externalId,
      orderCode: options.orderCode,
    });
    const reconcileEnabled = isSalesOrderAbsenceReconcileEnabled(env);

    let completeness: SalesOrderFetchCompletenessAssessment;
    let locals: SalesOrderLifecycleLocalSnapshot[];
    let foundPedidos: Array<{ externalSalesOrderId: number; payloadHash: string }>;
    let directedLookups: Array<{ externalSalesOrderId: number; found: boolean }> =
      [];
    let scope: ReturnType<typeof buildSalesOrderSyncReconciliationScope>;

    if (targeted) {
      // Datas apoiam a busca; não expandem o universo comparado.
      const candidateLocals = await loadSalesOrderLifecycleLocals({
        prisma: input.prisma,
        issueDateFrom: from,
        issueDateTo: to,
        orderCode: options.orderCode,
        externalSalesOrderIds:
          options.externalId != null ? [options.externalId] : undefined,
        ignoreIssueDateWindow: true,
      });
      const identity = resolveSalesOrderReconcileTargetIdentity({
        externalId: options.externalId,
        orderCode: options.orderCode,
        locals: candidateLocals,
      });
      if (!identity.ok) {
        return {
          ok: false,
          mode: options.mode,
          writes: false,
          errorCode: identity.code,
          message: identity.message,
          physicalDeletes: 0,
        };
      }

      locals = identity.local ? [identity.local] : [];
      scope = buildSalesOrderTargetedLookupScope({
        fromIso,
        toIso,
        externalId: identity.externalId,
        orderCode: identity.orderCode,
      }) as ReturnType<typeof buildSalesOrderSyncReconciliationScope>;

      const lookup = await resolveTargetedNomusLookup({
        baseUrl,
        from,
        to,
        env,
        externalId: identity.externalId,
        orderCode: identity.orderCode,
      });
      completeness = assessTargetedSalesOrderLookupCompleteness({
        lookupStatus: lookup.status,
        reason: lookup.status === "inconclusive" ? lookup.reason : null,
      });

      if (lookup.status === "found" && lookup.pedido.externalSalesOrderId != null) {
        const id = lookup.pedido.externalSalesOrderId;
        const hash =
          locals.find((l) => l.externalSalesOrderId === id)?.payloadHash ||
          `reconcile-presence:${id}`;
        foundPedidos = [{ externalSalesOrderId: id, payloadHash: hash }];
      } else {
        foundPedidos = [];
      }

      if (identity.externalId != null && completeness.payloadComplete) {
        directedLookups = [
          {
            externalSalesOrderId: identity.externalId,
            found: foundPedidos.some(
              (f) => f.externalSalesOrderId === identity.externalId
            ),
          },
        ];
      }
    } else {
      const fetched = await fetchNomusPedidosForAudit({
        baseUrl,
        from,
        to,
        env,
        strategyLabel: "full-reconciliation",
      });
      completeness = assessSalesOrderSyncPayloadCompleteness({
        strategy: "full-reconciliation",
        startPage: fetched.completeness.startPage,
        completedWindow: fetched.completeness.stoppedBecauseMaxPages,
        stoppedBecauseEmpty: fetched.completeness.stoppedBecauseEmpty,
        stoppedBecauseNoNext: fetched.completeness.stoppedBecauseNoNext,
        http429Count: fetched.completeness.http429Count,
        errors: fetched.completeness.errors,
        fetchFailed: fetched.completeness.stopReason === "http_error",
      });
      locals = await loadSalesOrderLifecycleLocals({
        prisma: input.prisma,
        issueDateFrom: from,
        issueDateTo: to,
      });
      const localHash = new Map(
        locals.map((l) => [l.externalSalesOrderId, l.payloadHash ?? ""] as const)
      );
      foundPedidos = fetched.pedidos
        .filter((p) => p.externalSalesOrderId != null)
        .map((p) => {
          const id = p.externalSalesOrderId as number;
          const hash = localHash.get(id);
          return {
            externalSalesOrderId: id,
            payloadHash:
              hash && hash.length > 0 ? hash : `reconcile-presence:${id}`,
          };
        });

      if (options.confirmCandidates && completeness.payloadComplete) {
        const candidates = locals.filter(
          (l) => l.sourcePresenceStatus === "MISSING_CANDIDATE"
        );
        for (const c of candidates.slice(0, 50)) {
          directedLookups.push({
            externalSalesOrderId: c.externalSalesOrderId,
            found: foundPedidos.some(
              (f) => f.externalSalesOrderId === c.externalSalesOrderId
            ),
          });
        }
      }

      scope = buildSalesOrderSyncReconciliationScope({
        strategy: "full-reconciliation",
        fromIso,
        toIso,
      });
    }

    let runId: string | null = null;
    if (options.mode === "apply") {
      if (!reconcileEnabled) {
        return {
          ok: false,
          mode: "apply",
          writes: false,
          applyBlockedReason: "RECONCILE_FLAG_DISABLED",
          physicalDeletes: 0,
        };
      }
      if (!completeness.payloadComplete) {
        return {
          ok: false,
          mode: "apply",
          writes: false,
          applyBlockedReason: "PAYLOAD_INCOMPLETE",
          completeness,
          physicalDeletes: 0,
        };
      }
      runId = (
        await createSalesOrderSourceSyncRun({
          prisma: input.prisma,
          strategy: targeted ? "historical-targeted-lookup" : "historical-reconcile",
          scope: scope as unknown as Record<string, unknown>,
          startedAt: new Date(),
          coveredFrom: from,
          coveredTo: to,
        })
      ).id;
    }

    const plan = buildSalesOrderSourceReconciliationPlan({
      strategy: targeted ? "targeted-lookup" : "full-reconciliation",
      scope,
      completeness,
      reconciliationEnabled: reconcileEnabled,
      evaluateAbsencesInPreview: true,
      foundPedidos,
      localRecords: locals,
      directedLookups,
      executedAt: new Date(),
      runId,
      runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      mode: options.mode,
    });

    const report = buildNomusSourceReconcilePreviewReport({
      mode: options.mode,
      entity: "sales-orders",
      plan,
      completeness: {
        ...completeness,
        runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      },
      scope,
      localUniverseCount: locals.length,
      nomusUniverseCount: foundPedidos.length,
      reconciliationEnabled: reconcileEnabled,
      pilots: {
        PD_02739: SALES_ORDER_PILOT_ABSENCE,
        inLocalUniverse: locals.some(
          (l) =>
            l.orderCode === SALES_ORDER_PILOT_ABSENCE.orderCode ||
            l.externalSalesOrderId ===
              SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId
        ),
        inNomusUniverse: foundPedidos.some(
          (p) =>
            p.externalSalesOrderId ===
            SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId
        ),
      },
    });

    if (options.mode === "preview") {
      return {
        ok: true,
        strategy: targeted ? "TARGETED_LOOKUP" : "FULL_RECONCILIATION",
        ...report,
        csv: options.csv ? formatReconcileReportCsv(report) : undefined,
        physicalDeletes: 0,
      };
    }

    const resume = parseReconcileResumeCursor(options.resumeCursor);
    const patches = collectLifecyclePatchesFromPlan(plan).map((p) => ({
      localId: p.localId,
      patch: p.patch,
    }));
    const applied = await applyPatchBatches({
      entity: "sales-orders",
      prisma: input.prisma,
      patches,
      batchSize: options.batchSize,
      resumeFromBatchIndex: resume?.nextBatchIndex ?? 0,
    });
    if (runId) {
      await finishSalesOrderSourceSyncRun({
        prisma: input.prisma,
        runId,
        status: "SUCCESS",
        payloadComplete: true,
        finishedAt: new Date(),
        counters: {
          rowsRead: foundPedidos.length,
          missingCandidateCount: plan.counters.missingCandidates,
          missingConfirmedCount: plan.counters.missingConfirmed,
          reactivatedCount: plan.counters.reactivated,
        },
        summaryJson: { applied: applied.applied },
      });
    }
    return {
      ok: true,
      strategy: targeted ? "TARGETED_LOOKUP" : "FULL_RECONCILIATION",
      ...report,
      applied: applied.applied,
      resumeCursor: applied.resumeCursor,
      physicalDeletes: 0,
    };
  } finally {
    lock.release();
  }
}

async function collectFinancialMapped(
  entity: "accounts-receivable" | "accounts-payable",
  env: NodeJS.ProcessEnv
): Promise<{
  rows: Array<{ externalId: number; payloadHash: string }>;
  pagesRead: number;
  errors: string[];
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  http429Count: number;
  startPage: number;
  maxPages: number;
  fetchFailed: boolean;
}> {
  const baseUrl = requireEnv("NOMUS_BASE_URL", env);
  const maxPages = Math.max(
    1,
    Number.parseInt(env.NOMUS_RECONCILE_MAX_PAGES ?? "500", 10) || 500 // fallback 500
  );
  const pageSize =
    entity === "accounts-receivable"
      ? resolveAccountsReceivablePageSize(env)
      : resolveAccountsPayablePageSize(env);
  const { firstPage, lastPage } =
    entity === "accounts-receivable"
      ? computePaginationPlan({
          mode: "preview",
          startPage: 1,
          maxPages,
          singlePage: null,
        })
      : computeApPaginationPlan({
          mode: "preview",
          startPage: 1,
          maxPages,
          singlePage: null,
        });

  const rows: Array<{ externalId: number; payloadHash: string }> = [];
  const errors: string[] = [];
  let pagesRead = 0;
  let stoppedBecauseEmpty = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseMaxPages = false;
  let fetchFailed = false;
  const path = entity === "accounts-receivable" ? "contasReceber" : "contasPagar";

  for (let page = firstPage; page <= lastPage; page += 1) {
    pagesRead += 1;
    const params =
      entity === "accounts-receivable"
        ? buildAccountsReceivablePageParams(page, pageSize, env)
        : buildAccountsPayablePageParams(page, pageSize, env);
    const url = buildNomusUrl(baseUrl, path, params);
    let payload: unknown;
    try {
      payload = await fetchNomusJson(url, {
        logPrefix: `[nomus-reconcile-${entity}]`,
      });
    } catch (error) {
      fetchFailed = true;
      errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
    const items =
      entity === "accounts-receivable"
        ? pickAccountsReceivableArray(payload).filter(
            (item): item is JsonObject =>
              !!item && typeof item === "object" && !Array.isArray(item)
          )
        : pickAccountsPayableArray(payload).filter(
            (item): item is JsonObject =>
              !!item && typeof item === "object" && !Array.isArray(item)
          );

    if (items.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }

    for (const item of items) {
      if (entity === "accounts-receivable") {
        const mapped = mapNomusAccountsReceivablePayload(item);
        if (mapped.ok) {
          rows.push({
            externalId: mapped.row.externalId,
            payloadHash: mapped.row.payloadHash,
          });
        }
      } else {
        const mapped = mapNomusAccountsPayablePayload(item);
        if (mapped.ok) {
          rows.push({
            externalId: mapped.row.externalId,
            payloadHash: mapped.row.payloadHash,
          });
        }
      }
    }

    const hasNext =
      entity === "accounts-receivable"
        ? hasNextAccountsReceivablePage(payload, page, items.length, pageSize)
        : hasNextAccountsPayablePage(payload, page, items.length, pageSize);
    if (!hasNext) {
      stoppedBecauseNoNext = true;
      break;
    }
    if (page === lastPage) {
      stoppedBecauseMaxPages = true;
    }
  }

  return {
    rows,
    pagesRead,
    errors,
    stoppedBecauseEmpty,
    stoppedBecauseNoNext,
    stoppedBecauseMaxPages,
    http429Count: 0,
    startPage: firstPage,
    maxPages,
    fetchFailed,
  };
}

export async function runNomusAccountsReceivableHistoricalReconcile(input: {
  prisma: PrismaClient;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  const env = input.env ?? process.env;
  const options = parseNomusSourceReconcileCli(input.argv, "accounts-receivable");
  const lock = acquireAccountsReceivableReconcileLock({ mode: options.mode, env });
  if (!lock.ok) {
    return { ok: false, lockBlocked: true, message: lock.message, writes: false };
  }

  try {
    const from = parseDay(options.from, "2020-01-01");
    const to = parseDay(options.to, "2030-12-31");
    const collected = await collectFinancialMapped("accounts-receivable", env);
    const onlyPending = parseNomusFinancialOnlyPending(env);
    const completeness = assessAccountsReceivableSyncPayloadCompleteness({
      syncStrategy: "full_refresh_upsert",
      startPage: collected.startPage,
      maxPages: collected.maxPages,
      pagesRead: collected.pagesRead,
      stoppedBecauseEmpty: collected.stoppedBecauseEmpty,
      stoppedBecauseNoNext: collected.stoppedBecauseNoNext,
      stoppedBecauseMaxPages: collected.stoppedBecauseMaxPages,
      onlyPending,
      errors: collected.errors,
      http429Count: collected.http429Count,
      fetchFailed: collected.fetchFailed,
    });
    const locals = await loadAccountsReceivableLifecycleLocals({
      prisma: input.prisma,
      dueDateFrom: from,
      dueDateTo: to,
      externalIds: options.externalId != null ? [options.externalId] : undefined,
    });
    const reconcileEnabled = isAccountsReceivableAbsenceReconcileEnabled(env);
    const scope = buildAccountsReceivableSyncReconciliationScope({
      syncStrategy: "full_refresh_upsert",
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      onlyPending,
    });

    const directedLookups: Array<{ externalId: number; found: boolean }> = [];
    if (options.confirmCandidates && completeness.payloadComplete) {
      const baseUrl = requireEnv("NOMUS_BASE_URL", env);
      const candidates = locals.filter(
        (l) => l.sourcePresenceStatus === "MISSING_CANDIDATE"
      );
      for (const c of candidates.slice(0, 20)) {
        const lookup = await lookupNomusAccountsReceivableByExternalId({
          baseUrl,
          externalId: c.externalId,
          env,
        });
        directedLookups.push({
          externalId: c.externalId,
          found: lookup.status === "found",
        });
      }
    }

    let runId: string | null = null;
    if (options.mode === "apply") {
      if (!reconcileEnabled || !completeness.payloadComplete) {
        return {
          ok: false,
          mode: "apply",
          writes: false,
          applyBlockedReason: !reconcileEnabled
            ? "RECONCILE_FLAG_DISABLED"
            : "PAYLOAD_INCOMPLETE",
          completeness,
        };
      }
      runId = (
        await createAccountsReceivableSourceSyncRun({
          prisma: input.prisma,
          strategy: "historical-reconcile",
          scope: scope as unknown as Record<string, unknown>,
          startedAt: new Date(),
          coveredFrom: from,
          coveredTo: to,
        })
      ).id;
    }

    const plan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope,
      completeness,
      reconciliationEnabled: reconcileEnabled,
      foundRows: collected.rows,
      localRecords: locals,
      directedLookups,
      executedAt: new Date(),
      runId,
      runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      mode: options.mode,
    });

    const localsById = new Map(locals.map((l) => [String(l.externalId), l] as const));
    const summary = summarizeAccountsReceivableReconciliationPreview(
      plan,
      completeness,
      scope,
      localsById
    );

    const report = buildNomusSourceReconcilePreviewReport({
      mode: options.mode,
      entity: "accounts-receivable",
      plan,
      completeness: {
        ...completeness,
        runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      },
      scope,
      localUniverseCount: locals.length,
      nomusUniverseCount: collected.rows.length,
      reconciliationEnabled: reconcileEnabled,
      openBalanceAffected: summary.totalOpenAffected,
      historicalSettledProtected: summary.totalReceivedHistoricalProtected,
      pilots: {
        CR_17748: ACCOUNTS_RECEIVABLE_PILOT,
        note: "Consulta independente — não inferir do Pedido PD 02739",
        inLocalUniverse: locals.some(
          (l) => l.externalId === ACCOUNTS_RECEIVABLE_PILOT.externalId
        ),
        inNomusUniverse: collected.rows.some(
          (r) => r.externalId === ACCOUNTS_RECEIVABLE_PILOT.externalId
        ),
      },
    });

    if (options.mode === "preview") {
      return {
        ok: true,
        ...report,
        csv: options.csv ? formatReconcileReportCsv(report) : undefined,
      };
    }

    const resume = parseReconcileResumeCursor(options.resumeCursor);
    const patches = collectLifecyclePatchesFromPlan(plan).map((p) => ({
      localId: p.localId,
      patch: p.patch,
    }));
    const applied = await applyPatchBatches({
      entity: "accounts-receivable",
      prisma: input.prisma,
      patches,
      batchSize: options.batchSize,
      resumeFromBatchIndex: resume?.nextBatchIndex ?? 0,
    });
    if (runId) {
      await finishAccountsReceivableSourceSyncRun({
        prisma: input.prisma,
        runId,
        status: "SUCCESS",
        payloadComplete: true,
        finishedAt: new Date(),
        counters: {
          rowsRead: collected.rows.length,
          missingCandidateCount: plan.counters.missingCandidates,
          missingConfirmedCount: plan.counters.missingConfirmed,
          reactivatedCount: plan.counters.reactivated,
        },
        summaryJson: { applied: applied.applied },
      });
    }
    return {
      ok: true,
      ...report,
      applied: applied.applied,
      resumeCursor: applied.resumeCursor,
    };
  } finally {
    lock.release();
  }
}

export async function runNomusAccountsPayableHistoricalReconcile(input: {
  prisma: PrismaClient;
  argv: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  const env = input.env ?? process.env;
  const options = parseNomusSourceReconcileCli(input.argv, "accounts-payable");
  const lock = acquireAccountsPayableReconcileLock({ mode: options.mode, env });
  if (!lock.ok) {
    return { ok: false, lockBlocked: true, message: lock.message, writes: false };
  }

  try {
    const from = parseDay(options.from, "2020-01-01");
    const to = parseDay(options.to, "2030-12-31");
    const collected = await collectFinancialMapped("accounts-payable", env);
    const onlyPending = parseNomusFinancialOnlyPending(env);
    const completeness = assessAccountsPayableSyncPayloadCompleteness({
      syncStrategy: "full_refresh_upsert",
      startPage: collected.startPage,
      maxPages: collected.maxPages,
      pagesRead: collected.pagesRead,
      stoppedBecauseEmpty: collected.stoppedBecauseEmpty,
      stoppedBecauseNoNext: collected.stoppedBecauseNoNext,
      stoppedBecauseMaxPages: collected.stoppedBecauseMaxPages,
      onlyPending,
      errors: collected.errors,
      http429Count: collected.http429Count,
      fetchFailed: collected.fetchFailed,
    });
    const locals = await loadAccountsPayableLifecycleLocals({
      prisma: input.prisma,
      dueDateFrom: from,
      dueDateTo: to,
      externalIds: options.externalId != null ? [options.externalId] : undefined,
    });
    const reconcileEnabled = isAccountsPayableAbsenceReconcileEnabled(env);
    const scope = buildAccountsPayableSyncReconciliationScope({
      syncStrategy: "full_refresh_upsert",
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      onlyPending,
    });

    const directedLookups: Array<{ externalId: number; found: boolean }> = [];
    if (options.confirmCandidates && completeness.payloadComplete) {
      const baseUrl = requireEnv("NOMUS_BASE_URL", env);
      const candidates = locals.filter(
        (l) => l.sourcePresenceStatus === "MISSING_CANDIDATE"
      );
      for (const c of candidates.slice(0, 20)) {
        const lookup = await lookupNomusAccountsPayableByExternalId({
          baseUrl,
          externalId: c.externalId,
          env,
        });
        directedLookups.push({
          externalId: c.externalId,
          found: lookup.status === "found",
        });
      }
    }

    let runId: string | null = null;
    if (options.mode === "apply") {
      if (!reconcileEnabled || !completeness.payloadComplete) {
        return {
          ok: false,
          mode: "apply",
          writes: false,
          applyBlockedReason: !reconcileEnabled
            ? "RECONCILE_FLAG_DISABLED"
            : "PAYLOAD_INCOMPLETE",
          completeness,
        };
      }
      runId = (
        await createAccountsPayableSourceSyncRun({
          prisma: input.prisma,
          strategy: "historical-reconcile",
          scope: scope as unknown as Record<string, unknown>,
          startedAt: new Date(),
          coveredFrom: from,
          coveredTo: to,
        })
      ).id;
    }

    const plan = buildAccountsPayableSourceReconciliationPlan({
      syncStrategy: "full_refresh_upsert",
      scope,
      completeness,
      reconciliationEnabled: reconcileEnabled,
      foundRows: collected.rows,
      localRecords: locals,
      directedLookups,
      executedAt: new Date(),
      runId,
      runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      mode: options.mode,
    });

    const localsById = new Map(locals.map((l) => [String(l.externalId), l] as const));
    const summary = summarizeAccountsPayableReconciliationPreview(
      plan,
      completeness,
      scope,
      localsById
    );

    const safePilot =
      locals.find(
        (l) => (l.balancePayable ?? 0) > 0 && l.sourcePresenceStatus === "PRESENT"
      ) ?? null;

    const report = buildNomusSourceReconcilePreviewReport({
      mode: options.mode,
      entity: "accounts-payable",
      plan,
      completeness: {
        ...completeness,
        runStatus: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
      },
      scope,
      localUniverseCount: locals.length,
      nomusUniverseCount: collected.rows.length,
      reconciliationEnabled: reconcileEnabled,
      openBalanceAffected: summary.totalOpenAffected,
      historicalSettledProtected: summary.totalPaidHistoricalProtected,
      pilots: {
        CP_SAFE_PREVIEW: safePilot
          ? {
              externalId: safePilot.externalId,
              note: "Escolhido no preview — sem presumir ausência",
            }
          : { note: "Nenhum título PRESENT aberto no escopo local do preview" },
      },
    });

    if (options.mode === "preview") {
      return {
        ok: true,
        ...report,
        csv: options.csv ? formatReconcileReportCsv(report) : undefined,
      };
    }

    const resume = parseReconcileResumeCursor(options.resumeCursor);
    const patches = collectLifecyclePatchesFromPlan(plan).map((p) => ({
      localId: p.localId,
      patch: p.patch,
    }));
    const applied = await applyPatchBatches({
      entity: "accounts-payable",
      prisma: input.prisma,
      patches,
      batchSize: options.batchSize,
      resumeFromBatchIndex: resume?.nextBatchIndex ?? 0,
    });
    if (runId) {
      await finishAccountsPayableSourceSyncRun({
        prisma: input.prisma,
        runId,
        status: "SUCCESS",
        payloadComplete: true,
        finishedAt: new Date(),
        counters: {
          rowsRead: collected.rows.length,
          missingCandidateCount: plan.counters.missingCandidates,
          missingConfirmedCount: plan.counters.missingConfirmed,
          reactivatedCount: plan.counters.reactivated,
        },
        summaryJson: { applied: applied.applied },
      });
    }
    return {
      ok: true,
      ...report,
      applied: applied.applied,
      resumeCursor: applied.resumeCursor,
    };
  } finally {
    lock.release();
  }
}
