import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { markFinanceDreSnapshotsDirtySafe } from "@/src/lib/financeDreSnapshot.server.js";
import {
  persistAccountsPayableIntegrationRun,
  disconnectAccountsPayableIntegrationPrisma,
} from "@/src/lib/nomusAccountsPayableIntegrationRun.js";
import {
  buildAccountsPayablePageParams,
  computePaginationPlan,
  hasNextAccountsPayablePage,
  parseAccountsPayableSyncCli,
  pickAccountsPayableArray,
  resolveAccountsPayablePageSize,
  type JsonObject,
} from "@/src/lib/nomusAccountsPayableSyncLogic.js";
import {
  mapNomusAccountsPayablePayload,
  type MappedNomusAccountsPayable,
} from "@/src/lib/nomusAccountsPayableMapper.js";
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
  assessAccountsPayableSyncPayloadCompleteness,
  buildAccountsPayableSourceReconciliationPlan,
  buildAccountsPayableSyncReconciliationScope,
  buildPresentAccountsPayableLifecycleWriteData,
  parseNomusFinancialOnlyPending,
  summarizeAccountsPayableReconciliationPreview,
} from "@/src/lib/nomus/nomusAccountsPayableSourceReconciliation.js";
import {
  acquireAccountsPayableReconcileLock,
  applyAccountsPayableLifecyclePatches,
  createAccountsPayableSourceSyncRun,
  finishAccountsPayableSourceSyncRun,
  isAccountsPayableAbsenceReconcileEnabled,
  loadAccountsPayableLifecycleLocals,
} from "@/src/lib/nomus/nomusAccountsPayableSourceReconciliation.server.js";
import type { NomusCanonicalSyncExecution } from "@/src/lib/nomus/nomusCanonicalSyncContract.js";
import {
  resolveSourceTriggerFromEnv,
  runNomusAccountsPayableSync,
  type NomusCanonicalSyncDelegateResult,
} from "@/src/lib/nomus/nomusCanonicalSync.server.js";
import {
  createTreasuryProjectionRecalcAfterNomusSyncDeps,
  formatTreasuryProjectionRecalcAfterNomusSyncLog,
  runTreasuryProjectionRecalcAfterNomusSync,
} from "@/src/lib/treasury/services/treasuryProjectionRecalcAfterNomusSync.server.js";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-accounts-payable]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function fetchAccountsPayablePage(
  baseUrl: string,
  page: number,
  pageSize: number
): Promise<{ payload: unknown; items: JsonObject[] }> {
  const url = buildNomusUrl(
    baseUrl,
    "contasPagar",
    buildAccountsPayablePageParams(page, pageSize, process.env)
  );
  const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
  const items = pickAccountsPayableArray(payload).filter(
    (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
  );
  return { payload, items };
}

async function fetchAllPages(
  baseUrl: string,
  options: ReturnType<typeof parseAccountsPayableSyncCli>
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusAccountsPayable[];
  errors: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  http429Count: number;
}> {
  const pageSize = resolveAccountsPayablePageSize(process.env);
  const { firstPage, lastPage } = computePaginationPlan(options);

  const rows: MappedNomusAccountsPayable[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let errors = 0;
  let stoppedBecauseEmpty = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseMaxPages = false;

  for (let page = firstPage; page <= lastPage; page += 1) {
    const { payload, items } = await fetchAccountsPayablePage(baseUrl, page, pageSize);
    pagesRead += 1;
    recordsRead += items.length;

    console.warn(`${LOG_PREFIX} página ${page} lida: ${items.length} registros.`);

    for (const item of items) {
      const mapped = mapNomusAccountsPayablePayload(item);
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

    if (!hasNextAccountsPayablePage(payload, page, items.length, pageSize)) {
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
    http429Count: 0,
  };
}

function buildPrismaData(
  row: MappedNomusAccountsPayable,
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
    paymentDate: row.paymentDate,
    amountPayable: row.amountPayable,
    amountScheduled: row.amountScheduled,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    description: row.description,
    comments: row.comments,
    documentNumber: row.documentNumber,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendPayment: row.suspendPayment,
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
  rows: MappedNomusAccountsPayable[],
  syncedAt: Date,
  lifecycleCtx: { runId: string | null }
) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const reactivatedPayableIds: number[] = [];

  for (const row of rows) {
    try {
      const existing = await prisma.nomusAccountsPayable.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true, sourcePresenceStatus: true },
      });

      const lifecycle = buildPresentAccountsPayableLifecycleWriteData({
        payloadHash: row.payloadHash,
        executedAt: syncedAt,
        runId: lifecycleCtx.runId,
        isCreate: !existing,
      });
      const data = buildPrismaData(row, syncedAt, lifecycle);

      if (!existing) {
        await prisma.nomusAccountsPayable.create({ data });
        created += 1;
        continue;
      }

      if (
        existing.sourcePresenceStatus === "MISSING_CANDIDATE" ||
        existing.sourcePresenceStatus === "MISSING_CONFIRMED"
      ) {
        reactivatedPayableIds.push(row.externalId);
      }

      if (existing.payloadHash === row.payloadHash) {
        await prisma.nomusAccountsPayable.update({
          where: { externalId: row.externalId },
          data: { syncedAt, ...lifecycle },
        });
        unchanged += 1;
        continue;
      }

      await prisma.nomusAccountsPayable.update({
        where: { externalId: row.externalId },
        data,
      });
      updated += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    created,
    updated,
    unchanged,
    errors,
    reactivatedPayableIds: [...new Set(reactivatedPayableIds)],
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

/** Implementação canônica CP — somente via runNomusAccountsPayableSync. */
export async function executeNomusAccountsPayableSync(
  execution?: NomusCanonicalSyncExecution
): Promise<NomusCanonicalSyncDelegateResult> {
  const runStartedAt = new Date();
  const startedMs = Date.now();
  const options = parseAccountsPayableSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const runnerLogFile = (process.env.NOMUS_AP_RUNNER_LOG ?? "").trim() || null;

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );
  const pageSize = resolveAccountsPayablePageSize(process.env);

  console.warn(
    `${LOG_PREFIX} modo=${options.mode} incremental=${options.incremental} strategy=${options.syncStrategy} startPage=${options.startPage} maxPages=${options.maxPages}`
  );
  console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
  console.warn(
    `${LOG_PREFIX} credencial: ${JSON.stringify(describeNomusCredential(process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN))}`
  );

  const sampleUrl = buildNomusUrl(
    baseUrl,
    "contasPagar",
    buildAccountsPayablePageParams(1, pageSize, process.env)
  );
  console.warn(`${LOG_PREFIX} endpoint=${redactNomusUrlForLog(sampleUrl)}`);

  let exitCode = 0;
  let errorMessage: string | null = null;

  let fetched = {
    pagesRead: 0,
    recordsRead: 0,
    rows: [] as MappedNomusAccountsPayable[],
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
  const scope = buildAccountsPayableSyncReconciliationScope({
    from: fromRaw,
    to: toRaw,
    onlyPending,
    syncStrategy: options.syncStrategy,
  });

  const lock = acquireAccountsPayableReconcileLock({
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
    throw new Error("Lock de reconciliação de Contas a Pagar indisponível.");
  }

  try {
    try {
      fetched = await fetchAllPages(baseUrl, options);
    } catch (error) {
      exitCode = 1;
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} falha`, errorMessage);
    }

    const completeness = assessAccountsPayableSyncPayloadCompleteness({
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
      isAccountsPayableAbsenceReconcileEnabled() &&
      (execution?.allowMissingDetection === true ||
        (process.env.NOMUS_CANONICAL_ALLOW_MISSING_DETECTION ?? "").trim() === "1");
    let sourceSyncRunId: string | null = null;
    const syncedAt = new Date();

    if (options.mode === "apply" && exitCode === 0) {
      const run = await createAccountsPayableSourceSyncRun({
        prisma,
        strategy: options.syncStrategy,
        scope: scope as unknown as Record<string, unknown>,
        startedAt: runStartedAt,
        coveredFrom: parseBrDateBound(fromRaw, false),
        coveredTo: parseBrDateBound(toRaw, true),
      });
      sourceSyncRunId = run.id;
    }

    const lifecycleLocals = await loadAccountsPayableLifecycleLocals({
      prisma,
      dueDateFrom: parseBrDateBound(fromRaw, false),
      dueDateTo: parseBrDateBound(toRaw, true),
    });

    const reconciliationPlan = buildAccountsPayableSourceReconciliationPlan({
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
    const reconciliationPreview = summarizeAccountsPayableReconciliationPreview(
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
          const { applied: n } = await applyAccountsPayableLifecyclePatches({
            prisma,
            patches,
          });
          lifecycleApplied = n;
        }
      }

      if (sourceSyncRunId) {
        await finishAccountsPayableSourceSyncRun({
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
              applied?.reactivatedPayableIds.length ??
              reconciliationPlan.counters.reactivated,
            http429Count: fetched.http429Count,
            errors: (applied?.errors ?? 0) + fetched.errors,
          },
          summaryJson: {
            reconciliation: reconciliationPreview,
            lifecycleApplied,
            operationalAxis: "dueDate",
          },
        });
      }

      // Snapshot da DRE: AP alocado em CC alimenta fretes/embalagens/despesas.
      // Mapear anos/empresas por título seria caro aqui — invalidação
      // conservadora dos snapshots existentes (barato, soft-fail).
      if ((applied?.created ?? 0) + (applied?.updated ?? 0) + lifecycleApplied > 0) {
        await markFinanceDreSnapshotsDirtySafe(prisma, { reason: "accounts-payable-sync" });
      }
    }

    sourceLifecycle = {
      runId: sourceSyncRunId,
      reconciliationEnabled: reconcileEnabled,
      authoritativeScope: completeness.authoritativeScope,
      fetchCompleteness: completeness,
      scope,
      operationalAxis: "dueDate",
      creates: reconciliationPreview.creates,
      updates: reconciliationPreview.updates,
      unchanged: reconciliationPreview.unchanged,
      missingCandidates: reconciliationPreview.missingCandidates,
      missingConfirmed: reconciliationPreview.missingConfirmed,
      reactivated: reconciliationPreview.reactivated,
      ignoredOutsideScope: reconciliationPreview.ignoredOutsideScope,
      totalOpenAffected: reconciliationPreview.totalOpenAffected,
      totalPaidHistoricalProtected: reconciliationPreview.totalPaidHistoricalProtected,
      counters: reconciliationPreview.counters,
      reasons: reconciliationPreview.reasons,
      absencesEvaluated: reconciliationPreview.absencesEvaluated,
      lifecycleApplied,
      dryRunWrites: false,
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
        balancePayable: row.balancePayable?.toString() ?? null,
        status: row.status,
        payloadHash: row.payloadHash.slice(0, 12),
      })),
    };

    console.log(JSON.stringify(payload, null, 2));

    const hooksAlreadyRan: string[] = [];

    // Recálculo Tesouraria: somente após run oficial SUCCESS (payload completo).
    // Falha do enqueue não altera checkpoint nem exitCode do sync.
    if (options.mode === "apply" && exitCode === 0) {
      try {
        const coveredFrom = parseBrDateBound(fromRaw, false);
        const coveredTo = parseBrDateBound(toRaw, true);
        const recalcResult = await runTreasuryProjectionRecalcAfterNomusSync(
          {
            source: "accounts-payable",
            eventType: "AP_SYNC",
            mode: "apply",
            exitCode,
            payloadComplete: completeness.payloadComplete,
            officialRunSucceeded:
              Boolean(sourceSyncRunId) && completeness.payloadComplete,
            sourceSyncRunId,
            coveredFrom,
            coveredTo,
            created: applied?.created ?? 0,
            updated: applied?.updated ?? 0,
            lifecycleApplied,
            requestId: execution?.correlationId ?? sourceSyncRunId,
          },
          createTreasuryProjectionRecalcAfterNomusSyncDeps(prisma)
        );
        console.warn(
          `${LOG_PREFIX} ${formatTreasuryProjectionRecalcAfterNomusSyncLog(recalcResult)}`
        );
        if (recalcResult.decision.enqueue) {
          hooksAlreadyRan.push("treasuryProjectionRecalc");
        }
      } catch (error) {
        console.error(
          `${LOG_PREFIX} treasury-projection-recalc-after-sync falhou (sync oficial preservado)`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (options.mode === "apply") {
      await persistAccountsPayableIntegrationRun({
        mode: "apply",
        startedAt: runStartedAt,
        finishedAt,
        durationMs,
        exitCode,
        logFile: runnerLogFile,
        command: "sync:nomus:accounts-payable:apply",
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
        (applied?.created ?? 0) + (applied?.updated ?? 0) + lifecycleApplied
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
      hooksAlreadyRan,
    };
  } finally {
    lock.release();
  }

  return { status: "FAILED", message: "AP sync ended unexpectedly", hooksAlreadyRan: [] };
}

async function mainCli(): Promise<void> {
  const options = parseAccountsPayableSyncCli(process.argv.slice(2));
  const result = await runNomusAccountsPayableSync(
    {
      strategy: "FULL_RECONCILIATION",
      mode: options.mode === "apply" ? "apply" : "preview",
      sourceTrigger: resolveSourceTriggerFromEnv(),
      scope: { kind: "accounts_payable_cli", syncStrategy: options.syncStrategy },
      allowMissingDetection: false,
      allowMissingConfirmation: false,
      requestedBy: "cli:nomusAccountsPayableSync",
    },
    (execution) => executeNomusAccountsPayableSync(execution)
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
    await disconnectAccountsPayableIntegrationPrisma();
  });
