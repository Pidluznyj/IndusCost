/**
 * Persistência best-effort de IntegrationRun para sync de OP (OP-11).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  maskProductionOrdersSensitiveText,
  type ProductionOrdersSyncAuditRecord,
} from "@/src/lib/nomusProductionOrdersSyncAudit.js";
import {
  NOMUS_PRODUCTION_ORDERS_LOG_PREFIX,
  NOMUS_PRODUCTION_ORDERS_SYNC_TARGET,
} from "@/src/lib/nomusProductionOrdersSyncConstants.js";

export type PersistProductionOrdersIntegrationRunInput = {
  audit: ProductionOrdersSyncAuditRecord;
  command?: string | null;
  logFile?: string | null;
  summaryExtra?: Record<string, unknown>;
};

export async function persistProductionOrdersIntegrationRun(
  db: PrismaClient,
  input: PersistProductionOrdersIntegrationRunInput
): Promise<string | null> {
  const audit = input.audit;
  const success = audit.status === "SUCCESS" || audit.status === "BLOCKED";
  const data: Prisma.IntegrationRunUncheckedCreateInput = {
    sourceSystem: "NOMUS",
    kind: "sync",
    target: NOMUS_PRODUCTION_ORDERS_SYNC_TARGET,
    mode: audit.mode === "apply" ? "apply" : "dry",
    status: audit.status,
    success,
    command:
      input.command ??
      `sync:nomus:production-orders:${audit.type}:${audit.mode}`,
    startedAt: new Date(audit.startedAt),
    finishedAt: new Date(audit.finishedAt),
    durationMs: audit.durationMs,
    exitCode: audit.exitCode,
    logFile: input.logFile ?? null,
    pageRead: audit.pages,
    ordersRead: audit.received,
    createdCount: audit.created,
    updatedCount: audit.updated,
    summaryJson: {
      audit,
      ...(input.summaryExtra ?? {}),
    } as Prisma.InputJsonValue,
    errorMessage:
      audit.status === "FAILED" || audit.status === "INTERRUPTED"
        ? maskProductionOrdersSensitiveText(audit.finalMessage).slice(0, 2000)
        : audit.status === "BLOCKED"
          ? maskProductionOrdersSensitiveText(audit.finalMessage).slice(0, 2000)
          : null,
  };

  try {
    if (input.logFile) {
      const existing = await db.integrationRun.findFirst({
        where: { logFile: input.logFile },
        select: { id: true },
      });
      if (existing) {
        await db.integrationRun.update({ where: { id: existing.id }, data });
        return existing.id;
      }
    }
    const created = await db.integrationRun.create({ data, select: { id: true } });
    return created.id;
  } catch (err) {
    console.error(
      `${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} falha ao registrar IntegrationRun:`,
      err
    );
    return null;
  }
}
