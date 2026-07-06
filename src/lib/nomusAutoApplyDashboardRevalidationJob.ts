import type { NomusAutoApplyDashboardSnapshot } from "@prisma/client";
import {
  assembleAutoApplyBomDashboardResult,
  loadAutoApplyReportContextForDashboard,
  type AutoApplyReportContext,
} from "@/src/lib/nomusAutoApplyBomDashboard.js";
import type { AutoApplyBomDashboardResult } from "@/src/lib/nomusAutoApplyBomDashboardTypes";
import { computeAutoApplyStatusTotals } from "@/src/lib/nomusAutoApplyBomDashboardShared.js";
import type { ParsedAutoApplyReport } from "@/src/lib/nomusAutoApplyBomReportParser.js";
import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyTotals,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import { prisma } from "@/src/lib/prisma.js";
import { countDistinctParentCodesInStage } from "@/src/lib/nomusBomComparisonLoad.js";
import {
  buildAutoApplyDashboardProductsFromStage,
  countEligibleAutoApplyRevalidationProducts,
  DEFAULT_REVALIDATION_BATCH_SIZE,
  DEFAULT_REVALIDATION_CONCURRENCY,
  revalidateAutoApplyDashboardProducts,
} from "@/src/lib/nomusAutoApplyDashboardRevalidation.js";
import type {
  NomusAutoApplyDashboardRevalidationJobStatus,
  NomusAutoApplyDashboardRevalidationStartResult,
  NomusAutoApplyDashboardRevalidationStatus,
  StoredAutoApplyDashboardSnapshot,
} from "@/src/lib/nomusAutoApplyDashboardRevalidationJobTypes.js";

const STALE_JOB_MS = 4 * 60 * 60 * 1000;
export const LIVE_STAGE_PRODUCT_LIST_SOURCE = "LIVE_STAGE_UNIVERSE";

function reportContextHasProductList(context: AutoApplyReportContext): boolean {
  return Boolean(context.parsed?.hasProductList) && (context.parsed?.products.length ?? 0) > 0;
}

/** Monta um relatório sintético com a lista viva do stage para reaproveitar o assembler. */
function buildLiveParsedReport(
  context: AutoApplyReportContext,
  products: NomusBomAutoApplyProductResult[],
  totals: NomusBomAutoApplyTotals
): ParsedAutoApplyReport {
  const nowIso = new Date().toISOString();
  const baseReport = context.parsed?.report ?? context.runFallback?.report ?? null;
  return {
    report: baseReport
      ? { ...baseReport, totals, products }
      : {
          generatedAt: nowIso,
          mode: "DRY",
          startedAt: nowIso,
          finishedAt: nowIso,
          approvedBy: "engenharia (revalidação ao vivo)",
          batchRunId: null,
          reportMdPath: null,
          reportJsonPath: null,
          totals,
          products,
        },
    products,
    totals,
    productListSource: LIVE_STAGE_PRODUCT_LIST_SOURCE,
    hasProductList: products.length > 0,
  };
}

let activeJobIdInProcess: string | null = null;

function progressPercent(processed: number, eligible: number): number {
  if (eligible <= 0) return 100;
  return Math.min(100, Math.round((processed / eligible) * 100));
}

function mapRowToStatus(
  row: NomusAutoApplyDashboardSnapshot | null,
  lastSuccessAt: Date | null
): NomusAutoApplyDashboardRevalidationStatus {
  if (!row) {
    return {
      jobId: null,
      status: "IDLE",
      startedAt: null,
      finishedAt: null,
      totalProducts: 0,
      eligibleProducts: 0,
      processedProducts: 0,
      revalidatedProductCount: 0,
      revalidationErrorCount: 0,
      currentParentCode: null,
      progressPercent: 0,
      errorMessage: null,
      snapshotGeneratedAt: null,
      lastSuccessfulSnapshotAt: lastSuccessAt?.toISOString() ?? null,
    };
  }

  const eligible = row.eligibleProducts;
  const processed = row.processedProducts;
  let status = row.status as NomusAutoApplyDashboardRevalidationJobStatus;
  if (!["IDLE", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"].includes(status)) {
    status = "FAILED";
  }

  return {
    jobId: row.id,
    status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    totalProducts: row.totalProducts,
    eligibleProducts: eligible,
    processedProducts: processed,
    revalidatedProductCount: row.revalidatedProductCount,
    revalidationErrorCount: row.revalidationErrorCount,
    currentParentCode: row.currentParentCode,
    progressPercent: progressPercent(processed, eligible),
    errorMessage: row.errorMessage,
    snapshotGeneratedAt: row.generatedAt?.toISOString() ?? null,
    lastSuccessfulSnapshotAt: lastSuccessAt?.toISOString() ?? null,
  };
}

async function findLastSuccessfulSnapshotRow() {
  return prisma.nomusAutoApplyDashboardSnapshot.findFirst({
    where: { status: "SUCCESS", resultJson: { not: null } },
    orderBy: { generatedAt: "desc" },
  });
}

export async function getLatestSuccessfulAutoApplyDashboardSnapshot(): Promise<StoredAutoApplyDashboardSnapshot | null> {
  const row = await findLastSuccessfulSnapshotRow();
  if (!row?.resultJson) return null;
  return {
    id: row.id,
    status: row.status,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    result: row.resultJson as AutoApplyBomDashboardResult,
  };
}

async function markStaleRunningJobsFailed(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_JOB_MS);
  await prisma.nomusAutoApplyDashboardSnapshot.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: "Job interrompido (timeout ou reinício do servidor).",
      currentParentCode: null,
    },
  });
}

async function findActiveRunningJob() {
  await markStaleRunningJobsFailed();
  return prisma.nomusAutoApplyDashboardSnapshot.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
}

export async function getNomusAutoApplyDashboardRevalidationStatus(): Promise<NomusAutoApplyDashboardRevalidationStatus> {
  const [running, lastSuccess] = await Promise.all([
    findActiveRunningJob(),
    findLastSuccessfulSnapshotRow(),
  ]);
  if (running) return mapRowToStatus(running, lastSuccess?.generatedAt ?? null);
  return mapRowToStatus(null, lastSuccess?.generatedAt ?? null);
}

export async function startNomusAutoApplyDashboardRevalidationJob(input?: {
  createdByUserId?: string | null;
}): Promise<NomusAutoApplyDashboardRevalidationStartResult> {
  await markStaleRunningJobsFailed();

  const existing = await findActiveRunningJob();
  if (existing || activeJobIdInProcess) {
    const lastSuccess = await findLastSuccessfulSnapshotRow();
    const row =
      existing ??
      (activeJobIdInProcess
        ? await prisma.nomusAutoApplyDashboardSnapshot.findUnique({
            where: { id: activeJobIdInProcess },
          })
        : null);
    return {
      alreadyRunning: true,
      job: mapRowToStatus(row, lastSuccess?.generatedAt ?? null),
    };
  }

  const context = await loadAutoApplyReportContextForDashboard();
  const hasReportList = reportContextHasProductList(context);

  let totalProducts: number;
  let eligible: number;

  if (hasReportList) {
    const reportProducts = context.parsed!.products;
    totalProducts = reportProducts.length;
    eligible = countEligibleAutoApplyRevalidationProducts(reportProducts);
  } else {
    // Sem lista no relatório: reconstruir a fila a partir do stage Nomus (fonte viva).
    const stageCount = await countDistinctParentCodesInStage();
    if (stageCount === 0) {
      throw new Error(
        "Nenhum produto no stage Nomus para revalidar. Rode o sync Nomus (sync:nomus:all) antes de atualizar o painel."
      );
    }
    totalProducts = stageCount;
    eligible = stageCount;
  }

  const job = await prisma.nomusAutoApplyDashboardSnapshot.create({
    data: {
      status: "RUNNING",
      totalProducts,
      eligibleProducts: eligible,
      processedProducts: 0,
      revalidatedProductCount: eligible,
      revalidationErrorCount: 0,
      createdByUserId: input?.createdByUserId ?? null,
    },
  });

  activeJobIdInProcess = job.id;
  console.info(
    `[nomus-auto-apply-dashboard] job ${job.id} started — source=${hasReportList ? "REPORT" : "LIVE_STAGE"} total=${totalProducts} eligible=${eligible}`
  );

  void runNomusAutoApplyDashboardRevalidationJob(job.id, context).finally(() => {
    if (activeJobIdInProcess === job.id) activeJobIdInProcess = null;
  });

  const lastSuccess = await findLastSuccessfulSnapshotRow();
  return {
    alreadyRunning: false,
    job: mapRowToStatus(job, lastSuccess?.generatedAt ?? null),
  };
}

async function runNomusAutoApplyDashboardRevalidationJob(
  jobId: string,
  context: AutoApplyReportContext
): Promise<void> {
  const started = Date.now();
  let shouldContinue = true;

  const onProgress = async (progress: {
    processedProducts: number;
    revalidationErrorCount: number;
    currentParentCode: string | null;
  }) => {
    await prisma.nomusAutoApplyDashboardSnapshot.update({
      where: { id: jobId },
      data: {
        processedProducts: progress.processedProducts,
        revalidationErrorCount: progress.revalidationErrorCount,
        currentParentCode: progress.currentParentCode,
      },
    });
  };

  try {
    const statusRevalidatedAt = new Date().toISOString();
    let result: AutoApplyBomDashboardResult;
    let revalidatedCount: number;
    let revalidationErrors: number;

    if (reportContextHasProductList(context)) {
      // Caminho clássico: revalidar a lista de produtos vinda do relatório batch.
      const parsed = context.parsed!;
      const revalidated = await revalidateAutoApplyDashboardProducts(parsed.products, {
        concurrency: DEFAULT_REVALIDATION_CONCURRENCY,
        batchSize: DEFAULT_REVALIDATION_BATCH_SIZE,
        shouldContinue: () => shouldContinue,
        onProgress,
      });
      revalidatedCount = revalidated.revalidatedCount;
      revalidationErrors = revalidated.revalidationErrors;
      result = assembleAutoApplyBomDashboardResult({
        parsed,
        productsForRows: revalidated.products,
        statusRevalidatedAt,
        revalidatedProductCount: revalidatedCount,
        revalidationErrorCount: revalidationErrors,
        fileReport: context.fileReport,
        runFallback: context.runFallback,
      });
    } else {
      // Sem lista no relatório: reconstruir a fila operacional do stage Nomus (fonte viva).
      const live = await buildAutoApplyDashboardProductsFromStage({
        concurrency: DEFAULT_REVALIDATION_CONCURRENCY,
        batchSize: DEFAULT_REVALIDATION_BATCH_SIZE,
        shouldContinue: () => shouldContinue,
        onProgress,
      });
      revalidatedCount = live.evaluated;
      revalidationErrors = live.errors;
      // Cards/totais são recomputados pelo assembler a partir da lista viva.
      // parsed.totals alimenta os "totais da última execução batch APPLY" exibidos à parte:
      // usa o relatório batch real quando disponível, senão cai na própria lista viva.
      const liveTotals = computeAutoApplyStatusTotals(live.products, context.parsed?.totals ?? null);
      const batchTotals: NomusBomAutoApplyTotals = context.parsed?.totals ?? {
        ...liveTotals,
        parentsInNomusStage: live.parentsInNomusStage,
      };
      const parsed = buildLiveParsedReport(context, live.products, batchTotals);
      result = assembleAutoApplyBomDashboardResult({
        parsed,
        productsForRows: live.products,
        statusRevalidatedAt,
        revalidatedProductCount: revalidatedCount,
        revalidationErrorCount: revalidationErrors,
        fileReport: context.fileReport,
        runFallback: context.runFallback,
      });
    }

    const generatedAt = new Date();
    await prisma.nomusAutoApplyDashboardSnapshot.update({
      where: { id: jobId },
      data: {
        status: "SUCCESS",
        finishedAt: generatedAt,
        generatedAt,
        totalProducts: result.totalProducts,
        processedProducts: revalidatedCount,
        revalidatedProductCount: revalidatedCount,
        revalidationErrorCount: revalidationErrors,
        currentParentCode: null,
        resultJson: result as object,
        errorMessage: null,
      },
    });

    const durationSec = Math.round((Date.now() - started) / 1000);
    console.info(
      `[nomus-auto-apply-dashboard] job ${jobId} success in ${durationSec}s — revalidated=${revalidatedCount} errors=${revalidationErrors}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na revalidação do painel.";
    console.error(`[nomus-auto-apply-dashboard] job ${jobId} failed:`, message);
    shouldContinue = false;

    await prisma.nomusAutoApplyDashboardSnapshot.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        currentParentCode: null,
        errorMessage: message,
      },
    });
  }
}

export async function recoverNomusAutoApplyDashboardRevalidationJobsOnStartup(): Promise<void> {
  await markStaleRunningJobsFailed();
}
