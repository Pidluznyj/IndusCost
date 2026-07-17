/**
 * OP-74 — Persistência best-effort de observabilidade (IntegrationRun).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildSalesOrderFlowRecomputeIntegrationRunSummary,
  type SalesOrderFlowRecomputeObservabilityLog,
  type SalesOrderFlowRecomputeObservabilityMetrics,
  type SalesOrderFlowRecomputeSource,
} from "./salesOrderFlowObservability.js";

export type SalesOrderFlowObservabilityDb = Pick<PrismaClient, "integrationRun">;

export async function persistSalesOrderFlowRecomputeObservabilityBestEffort(
  db: SalesOrderFlowObservabilityDb,
  input: {
    source: SalesOrderFlowRecomputeSource;
    metrics: SalesOrderFlowRecomputeObservabilityMetrics;
    logs?: readonly SalesOrderFlowRecomputeObservabilityLog[];
    startedAt: Date;
    finishedAt: Date;
    errorMessage?: string | null;
    mode?: string | null;
  }
): Promise<void> {
  try {
    const hasFailures =
      input.metrics.failures > 0 || Boolean(input.errorMessage);
    const status = hasFailures
      ? input.metrics.ordersEvaluated > input.metrics.failures
        ? "PARTIAL"
        : "FAILED"
      : "SUCCESS";

    const summaryJson = buildSalesOrderFlowRecomputeIntegrationRunSummary({
      metrics: input.metrics,
      logs: input.logs,
      errorMessage: input.errorMessage,
    });

    const data: Prisma.IntegrationRunUncheckedCreateInput = {
      sourceSystem: "INDUSCOST",
      target: `sales-order-flow-recompute:${input.source}`,
      kind:
        input.source === "rebuild" || input.source === "rebuild-preview"
          ? "rebuild"
          : input.source === "post-sync"
            ? "post-sync"
            : "recompute",
      mode: input.mode ?? input.source,
      status,
      success: status === "SUCCESS",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      summaryJson,
      errorMessage: input.errorMessage ?? null,
    };

    await db.integrationRun.create({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[sales-order-flow-recompute] falha ao registrar IntegrationRun: ${message}`
    );
  }
}
