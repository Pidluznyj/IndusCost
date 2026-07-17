import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildNomusSyncMaterializationTrigger } from "../src/lib/commissions/commissionMaterializationAfterNomusSync.ts";
import { runCommissionMaterializationAfterNomusSync } from "../src/lib/commissions/commissionMaterializationAfterNomusSync.server.ts";
import {
  persistAccountsReceivableIntegrationRun,
  disconnectAccountsReceivableIntegrationPrisma,
} from "@/src/lib/nomusAccountsReceivableIntegrationRun.js";
import {
  buildAccountsReceivablePageParams,
  computePaginationPlan,
  hasNextAccountsReceivablePage,
  parseAccountsReceivableSyncCli,
  pickAccountsReceivableArray,
  resolveAccountsReceivablePageSize,
  type JsonObject,
} from "@/src/lib/nomusAccountsReceivableSyncLogic.js";
import {
  mapNomusAccountsReceivablePayload,
  type MappedNomusAccountsReceivable,
} from "@/src/lib/nomusAccountsReceivableMapper.js";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "@/src/lib/nomusRestClient.js";
import {
  NOMUS_FINANCIAL_DEFAULT_END_DATE,
  NOMUS_FINANCIAL_DEFAULT_START_DATE,
} from "@/src/lib/nomusFinancialSyncQueryParams.js";
import {
  ACCOUNTS_RECEIVABLE_PILOT,
  assessAccountsReceivableSyncPayloadCompleteness,
  buildAccountsReceivableSourceReconciliationPlan,
  buildAccountsReceivableSyncReconciliationScope,
  buildPresentAccountsReceivableLifecycleWriteData,
  parseNomusFinancialOnlyPending,
  summarizeAccountsReceivableReconciliationPreview,
} from "@/src/lib/nomus/nomusAccountsReceivableSourceReconciliation.js";
import {
  acquireAccountsReceivableReconcileLock,
  applyAccountsReceivableLifecyclePatches,
  createAccountsReceivableSourceSyncRun,
  finishAccountsReceivableSourceSyncRun,
  isAccountsReceivableAbsenceReconcileEnabled,
  loadAccountsReceivableLifecycleLocals,
} from "@/src/lib/nomus/nomusAccountsReceivableSourceReconciliation.server.js";
import type { NomusCanonicalSyncExecution } from "@/src/lib/nomus/nomusCanonicalSyncContract.js";
import {
  resolveSourceTriggerFromEnv,
  runNomusAccountsReceivableSync,
  type NomusCanonicalSyncDelegateResult,
} from "@/src/lib/nomus/nomusCanonicalSync.server.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-accounts-receivable]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function fetchAccountsReceivablePage(
  baseUrl: string,
  page: number,
  pageSize: number
): Promise<{ payload: unknown; items: JsonObject[] }> {
  const url = buildNomusUrl(
    baseUrl,
    "contasReceber",
    buildAccountsReceivablePageParams(page, pageSize, process.env)
  );
  const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
  const items = pickAccountsReceivableArray(payload).filter(
    (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
  );
  return { payload, items };
}

async function fetchAllPages(
  baseUrl: string,
  options: ReturnType<typeof parseAccountsReceivableSyncCli>
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusAccountsReceivable[];
  errors: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  http429Count: number;
}> {
  const pageSize = resolveAccountsReceivablePageSize(process.env);
  const { firstPage, lastPage } = computePaginationPlan(options);

  const rows: MappedNomusAccountsReceivable[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let errors = 0;
  let stoppedBecauseEmpty = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseMaxPages = false;
  let http429Count = 0;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchAccountsReceivablePage(baseUrl, page, pageSize);
    pagesRead += 1;
    recordsRead += items.length;

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const mapped = mapNomusAccountsReceivablePayload(item);
      if (!mapped.ok) {
        errors += 1;
        continue;
      }
      rows.push(mapped.row);
    }

    if (items.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }

    if (options.singlePage != null) {
      stoppedBecauseMaxPages = true;
      break;
    }

    if (!hasNextAccountsReceivablePage(payload, page, items.length, pageSize)) {
      stoppedBecauseNoNext = true;
      break;
    }

    if (page >= lastPage) {
      stoppedBecauseMaxPages = true;
      break;
    }
  }

  return {
    pagesRead,
    recordsRead,
    rows,
    errors,
    stoppedBecauseEmpty,
    stoppedBecauseNoNext,
    stoppedBecauseMaxPages,
    http429Count,
  };
}

function buildPrismaData(
  row: MappedNomusAccountsReceivable,
  syncedAt: Date,
  lifecycle: Record<string, unknown>
) {
  return {
    externalId: row.externalId,
    classification: row.classification,
    type: row.type,
    status: row.status,
    companyId: row.companyId,
    companyName: row.companyName,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    personPhone: row.personPhone,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankAccountName,
    paymentMethodId: row.paymentMethodId,
    paymentMethodName: row.paymentMethodName,
    dueDate: row.dueDate,
    competenceDate: row.competenceDate,
    scheduleDate: row.scheduleDate,
    createdAtNomus: row.createdAtNomus,
    modifiedAtNomus: row.modifiedAtNomus,
    settlementDate: row.settlementDate,
    amountReceivable: row.amountReceivable,
    amountScheduled: row.amountScheduled,
    amountReceived: row.amountReceived,
    balanceReceivable: row.balanceReceivable,
    description: row.description,
    comments: row.comments,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendCollection: row.suspendCollection,
    lateFeePercent: row.lateFeePercent,
    monthlyInterestRate: row.monthlyInterestRate,
    lateFeeCalculationType: row.lateFeeCalculationType,
    lateInterestType: row.lateInterestType,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
    ...lifecycle,
  };
}

async function runApply(
  rows: MappedNomusAccountsReceivable[],
  syncedAt: Date,
  lifecycleCtx: { runId: string | null }
) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const affectedReceivableIds: number[] = [];
  const reactivatedReceivableIds: number[] = [];

  for (const row of rows) {
    try {
      const existing = await prisma.nomusAccountsReceivable.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true, sourcePresenceStatus: true },
      });

      const lifecycle = buildPresentAccountsReceivableLifecycleWriteData({
        payloadHash: row.payloadHash,
        executedAt: syncedAt,
        runId: lifecycleCtx.runId,
        isCreate: !existing,
      });
      const data = buildPrismaData(row, syncedAt, lifecycle);

      if (!existing) {
        await prisma.nomusAccountsReceivable.create({ data });
        created += 1;
        affectedReceivableIds.push(row.externalId);
        continue;
      }

      if (
        existing.sourcePresenceStatus === "MISSING_CANDIDATE" ||
        existing.sourcePresenceStatus === "MISSING_CONFIRMED"
      ) {
        reactivatedReceivableIds.push(row.externalId);
      }

      if (existing.payloadHash === row.payloadHash) {
        await prisma.nomusAccountsReceivable.update({
          where: { externalId: row.externalId },
          data: {
            syncedAt,
            ...lifecycle,
          },
        });
        unchanged += 1;
        if (reactivatedReceivableIds.includes(row.externalId)) {
          affectedReceivableIds.push(row.externalId);
        }
        continue;
      }

      await prisma.nomusAccountsReceivable.update({
        where: { externalId: row.externalId },
        data,
      });
      updated += 1;
      affectedReceivableIds.push(row.externalId);
    } catch {
      errors += 1;
    }
  }

  return {
    created,
    updated,
    unchanged,
    errors,
    affectedReceivableIds: [...new Set(affectedReceivableIds)],
    reactivatedReceivableIds: [...new Set(reactivatedReceivableIds)],
  };
}

function parseBrDateBound(value: string, endOfDay: boolean): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return new Date();
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (endOfDay) return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
}

/** Implementação canônica CR — somente via runNomusAccountsReceivableSync. */
export async function executeNomusAccountsReceivableSync(
  execution?: NomusCanonicalSyncExecution
): Promise<NomusCanonicalSyncDelegateResult> {
  const runStartedAt = new Date();
  const startedMs = Date.now();
  const options = parseAccountsReceivableSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const runnerLogFile = (process.env.NOMUS_AR_RUNNER_LOG ?? "").trim() || null;

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );
  const pageSize = resolveAccountsReceivablePageSize(process.env);

  console.warn(
    `${LOG_PREFIX} modo=${options.mode} incremental=${options.incremental} strategy=${options.syncStrategy} startPage=${options.startPage} maxPages=${options.maxPages}`
  );
  console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
  console.warn(
    `${LOG_PREFIX} credencial: ${JSON.stringify(describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN))}`
  );

  const sampleUrl = buildNomusUrl(
    baseUrl,
    "contasReceber",
    buildAccountsReceivablePageParams(1, pageSize, process.env)
  );
  console.warn(`${LOG_PREFIX} endpoint=${redactNomusUrlForLog(sampleUrl)}`);

  let exitCode = 0;
  let errorMessage: string | null = null;

  let fetched = {
    pagesRead: 0,
    recordsRead: 0,
    rows: [] as MappedNomusAccountsReceivable[],
    errors: 0,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: false,
    stoppedBecauseMaxPages: false,
    http429Count: 0,
  };
  let applied: Awaited<ReturnType<typeof runApply>> | null = null;
  let sourceLifecycle: Record<string, unknown> | null = null;
  let lifecycleApplied = 0;

  const onlyPending = parseNomusFinancialOnlyPending(process.env);
  const fromRaw =
    (process.env.NOMUS_FINANCIAL_START_DATE ?? "").trim() ||
    NOMUS_FINANCIAL_DEFAULT_START_DATE;
  const toRaw =
    (process.env.NOMUS_FINANCIAL_END_DATE ?? "").trim() || NOMUS_FINANCIAL_DEFAULT_END_DATE;
  const scope = buildAccountsReceivableSyncReconciliationScope({
    from: fromRaw,
    to: toRaw,
    onlyPending,
    syncStrategy: options.syncStrategy,
  });

  const lock = acquireAccountsReceivableReconcileLock({
    mode: options.mode === "apply" ? "apply" : "preview",
  });
  if (!lock.ok) {
    if (lock.code === "LOCK_HELD") {
      return {
        status: "SKIPPED_LOCKED",
        message: lock.message,
        hooksAlreadyRan: [],
      };
    }
    throw new Error("Lock de reconciliação de Contas a Receber indisponível.");
  }

  try {
    try {
      fetched = await fetchAllPages(baseUrl, options);
    } catch (error) {
      exitCode = 1;
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} falha`, errorMessage);
    }

    const completeness = assessAccountsReceivableSyncPayloadCompleteness({
      syncStrategy: options.syncStrategy,
      startPage: options.startPage,
      maxPages: options.maxPages,
      pagesRead: fetched.pagesRead,
      stoppedBecauseEmpty: fetched.stoppedBecauseEmpty,
      stoppedBecauseNoNext: fetched.stoppedBecauseNoNext,
      stoppedBecauseMaxPages: fetched.stoppedBecauseMaxPages,
      onlyPending,
      http429Count: fetched.http429Count,
      errors: errorMessage ? [errorMessage] : [],
      fetchFailed: exitCode !== 0,
    });

    const reconcileEnabled =
      isAccountsReceivableAbsenceReconcileEnabled() &&
      (execution?.allowMissingDetection === true ||
        (process.env.NOMUS_CANONICAL_ALLOW_MISSING_DETECTION ?? "").trim() === "1");
    let sourceSyncRunId: string | null = null;
    const syncedAt = new Date();

    if (options.mode === "apply" && exitCode === 0) {
      const run = await createAccountsReceivableSourceSyncRun({
        prisma,
        strategy: options.syncStrategy,
        scope: scope as unknown as Record<string, unknown>,
        startedAt: runStartedAt,
        coveredFrom: parseBrDateBound(fromRaw, false),
        coveredTo: parseBrDateBound(toRaw, true),
      });
      sourceSyncRunId = run.id;
    }

    const lifecycleLocals = await loadAccountsReceivableLifecycleLocals({
      prisma,
      dueDateFrom: parseBrDateBound(fromRaw, false),
      dueDateTo: parseBrDateBound(toRaw, true),
    });

    const reconciliationPlan = buildAccountsReceivableSourceReconciliationPlan({
      syncStrategy: options.syncStrategy,
      scope,
      completeness,
      reconciliationEnabled: reconcileEnabled,
      foundRows: fetched.rows.map((r) => ({
        externalId: r.externalId,
        payloadHash: r.payloadHash,
      })),
      localRecords: lifecycleLocals,
      executedAt: syncedAt,
      runId: sourceSyncRunId,
      runStatus:
        exitCode !== 0
          ? "FAILED"
          : completeness.payloadComplete
            ? "SUCCESS"
            : "INCONCLUSIVE",
      mode: options.mode === "apply" ? "apply" : "preview",
    });

    const localsByExternalId = new Map(
      lifecycleLocals.map((l) => [String(l.externalId), l] as const)
    );
    const reconciliationPreview = summarizeAccountsReceivableReconciliationPreview(
      reconciliationPlan,
      completeness,
      scope,
      localsByExternalId
    );

    if (options.mode === "apply" && exitCode === 0) {
      applied = await runApply(fetched.rows, syncedAt, { runId: sourceSyncRunId });

      if (reconcileEnabled && completeness.payloadComplete) {
        const patches = [
          ...reconciliationPlan.missingCandidates,
          ...reconciliationPlan.missingConfirmed,
        ]
          .filter((item) => item.localId && item.lifecyclePatch)
          .map((item) => ({
            localId: item.localId as string,
            patch: item.lifecyclePatch!,
          }));
        if (patches.length > 0) {
          const { applied: n } = await applyAccountsReceivableLifecyclePatches({
            prisma,
            patches,
          });
          lifecycleApplied = n;
        }
      }

      if (sourceSyncRunId) {
        await finishAccountsReceivableSourceSyncRun({
          prisma,
          runId: sourceSyncRunId,
          status: completeness.payloadComplete ? "SUCCESS" : "INCONCLUSIVE",
          payloadComplete: completeness.payloadComplete,
          finishedAt: new Date(),
          counters: {
            pagesRead: fetched.pagesRead,
            rowsRead: fetched.recordsRead,
            createdCount: applied?.created ?? 0,
            updatedCount: applied?.updated ?? 0,
            unchangedCount: applied?.unchanged ?? 0,
            missingCandidateCount: reconciliationPlan.counters.missingCandidates,
            missingConfirmedCount: reconciliationPlan.counters.missingConfirmed,
            reactivatedCount:
              applied?.reactivatedReceivableIds.length ??
              reconciliationPlan.counters.reactivated,
            http429Count: fetched.http429Count,
            errors: (applied?.errors ?? 0) + fetched.errors,
          },
          summaryJson: {
            reconciliation: reconciliationPreview,
            lifecycleApplied,
            pilot: ACCOUNTS_RECEIVABLE_PILOT,
          },
        });
      }
    }

    sourceLifecycle = {
      runId: sourceSyncRunId,
      reconciliationEnabled: reconcileEnabled,
      authoritativeScope: completeness.authoritativeScope,
      fetchCompleteness: completeness,
      scope,
      creates: reconciliationPreview.creates,
      updates: reconciliationPreview.updates,
      unchanged: reconciliationPreview.unchanged,
      missingCandidates: reconciliationPreview.missingCandidates,
      missingConfirmed: reconciliationPreview.missingConfirmed,
      reactivated: reconciliationPreview.reactivated,
      ignoredOutsideScope: reconciliationPreview.ignoredOutsideScope,
      totalOpenAffected: reconciliationPreview.totalOpenAffected,
      totalReceivedHistoricalProtected:
        reconciliationPreview.totalReceivedHistoricalProtected,
      counters: reconciliationPreview.counters,
      reasons: reconciliationPreview.reasons,
      absencesEvaluated: reconciliationPreview.absencesEvaluated,
      lifecycleApplied,
      dryRunWrites: false,
      pilot: {
        ...ACCOUNTS_RECEIVABLE_PILOT,
        inPreview:
          reconciliationPreview.missingCandidates.some(
            (r) => r.externalId === String(ACCOUNTS_RECEIVABLE_PILOT.externalId)
          ) ||
          reconciliationPreview.missingConfirmed.some(
            (r) => r.externalId === String(ACCOUNTS_RECEIVABLE_PILOT.externalId)
          ) ||
          reconciliationPreview.unchanged.some(
            (r) => r.externalId === String(ACCOUNTS_RECEIVABLE_PILOT.externalId)
          ) ||
          reconciliationPreview.updates.some(
            (r) => r.externalId === String(ACCOUNTS_RECEIVABLE_PILOT.externalId)
          ),
      },
    };

    const durationMs = Date.now() - startedMs;
    const finishedAt = new Date();

    const summary = {
      syncStrategy: options.syncStrategy,
      incremental: options.incremental,
      pagesRead: fetched.pagesRead,
      recordsRead: fetched.recordsRead,
      mapped: fetched.rows.length,
      mapErrors: fetched.errors,
      durationMs,
      ...(applied ?? {}),
    };

    console.warn(
      `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — páginas=${summary.pagesRead} lidos=${summary.recordsRead} mapeados=${summary.mapped} criados=${applied?.created ?? 0} atualizados=${applied?.updated ?? 0} inalterados=${applied?.unchanged ?? 0} erros=${(applied?.errors ?? 0) + summary.mapErrors} lifecycleApplied=${lifecycleApplied}`
    );

    const payload = {
      mode: options.mode,
      summary,
      applied,
      sourceLifecycle,
      preview: fetched.rows.slice(0, 5).map((row) => ({
        externalId: row.externalId,
        personName: row.personName,
        dueDate: row.dueDate?.toISOString() ?? null,
        balanceReceivable: row.balanceReceivable?.toString() ?? null,
        status: row.status,
        payloadHash: row.payloadHash.slice(0, 12),
      })),
    };

    console.log(JSON.stringify(payload, null, 2));

    if (options.mode === "apply" && applied?.affectedReceivableIds?.length) {
      await runCommissionMaterializationAfterNomusSync(
        prisma,
        buildNomusSyncMaterializationTrigger({
          source: "accounts-receivable",
          syncMode: "apply",
          receivableIds: applied.affectedReceivableIds,
        })
      );
    }

    if (options.mode === "apply") {
      await persistAccountsReceivableIntegrationRun({
        mode: "apply",
        startedAt: runStartedAt,
        finishedAt,
        durationMs,
        exitCode,
        logFile: runnerLogFile,
        command: "sync:nomus:accounts-receivable:apply",
        summary,
        applied,
        errorMessage,
      });
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }

    return {
      status:
        exitCode !== 0
          ? "FAILED"
          : completeness.payloadComplete
            ? "SUCCESS"
            : "INCONCLUSIVE",
      runId: sourceSyncRunId,
      payloadComplete: completeness.payloadComplete,
      hasRelevantChanges: Boolean(
        (applied?.created ?? 0) + (applied?.updated ?? 0)
      ),
      counters: {
        pagesRead: summary.pagesRead,
        rowsRead: summary.recordsRead,
        created: applied?.created ?? 0,
        updated: applied?.updated ?? 0,
        unchanged: applied?.unchanged ?? 0,
        reactivated: 0,
        missingCandidates: 0,
        missingConfirmed: 0,
        errors: (applied?.errors ?? 0) + summary.mapErrors,
        http429: fetched.http429Count,
      },
      hooksAlreadyRan:
        options.mode === "apply" && applied?.affectedReceivableIds?.length
          ? ["commissionMaterialization"]
          : [],
    };
  } finally {
    lock.release();
  }

  return { status: "FAILED", message: "AR sync ended unexpectedly", hooksAlreadyRan: [] };
}

async function mainCli(): Promise<void> {
  const options = parseAccountsReceivableSyncCli(process.argv.slice(2));
  const result = await runNomusAccountsReceivableSync(
    {
      strategy: "FULL_RECONCILIATION",
      mode: options.mode === "apply" ? "apply" : "preview",
      sourceTrigger: resolveSourceTriggerFromEnv(),
      scope: { kind: "accounts_receivable_cli", syncStrategy: options.syncStrategy },
      // Automático/admin: ausência só se flag canônica + env de reconciliação.
      allowMissingDetection: false,
      allowMissingConfirmation: false,
      requestedBy: "cli:nomusAccountsReceivableSync",
    },
    (execution) => executeNomusAccountsReceivableSync(execution)
  );
  if (result.status === "SKIPPED_LOCKED") {
    console.warn(`${LOG_PREFIX} ${result.message ?? "SKIPPED_LOCKED"}`);
    process.exitCode = 0;
  }
}

mainCli()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectAccountsReceivableIntegrationPrisma();
  });
