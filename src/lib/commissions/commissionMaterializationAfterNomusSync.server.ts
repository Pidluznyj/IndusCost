import type { Prisma, PrismaClient } from "@prisma/client";
import {
  formatCommissionMaterializationAfterSyncLog,
  hasMaterializationTriggerTargets,
  isCommissionMaterializationAfterSyncEnabled,
  type CommissionMaterializationAfterSyncResult,
  type NomusSyncMaterializationTrigger,
} from "./commissionMaterializationAfterNomusSync.js";
import { rebuildCommissionMaterializationForAffectedSales } from "./commissionMaterializationOrchestrator.server.js";

export type CommissionMaterializationAfterSyncDeps = {
  rebuild: typeof rebuildCommissionMaterializationForAffectedSales;
  resolveCustomerSalesOrderIds: (
    db: PrismaClient,
    customerIds: string[]
  ) => Promise<string[]>;
  persistAudit: (
    db: PrismaClient,
    input: {
      trigger: NomusSyncMaterializationTrigger;
      result: CommissionMaterializationAfterSyncResult;
      startedAt: Date;
      finishedAt: Date;
    }
  ) => Promise<void>;
};

async function defaultResolveCustomerSalesOrderIds(
  db: PrismaClient,
  customerIds: string[]
): Promise<string[]> {
  if (customerIds.length === 0) return [];
  const rows = await db.salesOrder.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function persistCommissionMaterializationAuditBestEffort(
  db: PrismaClient,
  input: {
    trigger: NomusSyncMaterializationTrigger;
    result: CommissionMaterializationAfterSyncResult;
    startedAt: Date;
    finishedAt: Date;
  }
): Promise<void> {
  try {
    const status = input.result.error
      ? "FAILED"
      : input.result.skipped
        ? "SKIPPED"
        : "SUCCESS";

    const data: Prisma.IntegrationRunUncheckedCreateInput = {
      sourceSystem: "INDUSCOST",
      target: `commission-materialization:${input.trigger.source}`,
      kind: "post-sync",
      mode: input.trigger.syncMode,
      status,
      success: status === "SUCCESS",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      summaryJson: {
        trigger: input.trigger,
        summary: input.result.summary ?? null,
        skipped: input.result.skipped,
        skipReason: input.result.skipReason ?? null,
      },
      errorMessage: input.result.error ?? input.result.skipReason ?? null,
    };

    await db.integrationRun.create({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[commission-materialization-after-sync] falha ao registrar auditoria: ${message}`
    );
  }
}

const defaultDeps: CommissionMaterializationAfterSyncDeps = {
  rebuild: rebuildCommissionMaterializationForAffectedSales,
  resolveCustomerSalesOrderIds: defaultResolveCustomerSalesOrderIds,
  persistAudit: persistCommissionMaterializationAuditBestEffort,
};

/**
 * Executa materialização de comissão para registros afetados pelo sync Nomus.
 * Não altera dados Nomus nem fechamentos mensais. Erros são logados, não propagados.
 */
export async function runCommissionMaterializationAfterNomusSync(
  db: PrismaClient,
  trigger: NomusSyncMaterializationTrigger,
  deps: CommissionMaterializationAfterSyncDeps = defaultDeps
): Promise<CommissionMaterializationAfterSyncResult> {
  const startedAt = new Date();

  if (!isCommissionMaterializationAfterSyncEnabled()) {
    const result: CommissionMaterializationAfterSyncResult = {
      enabled: false,
      skipped: true,
      skipReason: "flag_disabled",
    };
    console.warn(formatCommissionMaterializationAfterSyncLog(result, trigger));
    return result;
  }

  if (trigger.syncMode !== "apply") {
    const result: CommissionMaterializationAfterSyncResult = {
      enabled: true,
      skipped: true,
      skipReason: "not_apply_mode",
    };
    console.warn(formatCommissionMaterializationAfterSyncLog(result, trigger));
    return result;
  }

  if (!hasMaterializationTriggerTargets(trigger)) {
    const result: CommissionMaterializationAfterSyncResult = {
      enabled: true,
      skipped: true,
      skipReason: "no_affected_targets",
    };
    console.warn(formatCommissionMaterializationAfterSyncLog(result, trigger));
    return result;
  }

  try {
    const customerOrderIds = trigger.customerIds?.length
      ? await deps.resolveCustomerSalesOrderIds(db, trigger.customerIds)
      : [];

    const summary = await deps.rebuild(db, {
      salesOrderIds: [...(trigger.salesOrderIds ?? []), ...customerOrderIds],
      nfeIds: trigger.nfeIds,
      receivableIds: trigger.receivableIds,
      apply: true,
    });

    const result: CommissionMaterializationAfterSyncResult = {
      enabled: true,
      skipped: false,
      summary,
    };

    console.warn(formatCommissionMaterializationAfterSyncLog(result, trigger));
    await deps.persistAudit(db, {
      trigger,
      result,
      startedAt,
      finishedAt: new Date(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: CommissionMaterializationAfterSyncResult = {
      enabled: true,
      skipped: false,
      error: message,
    };
    console.error(formatCommissionMaterializationAfterSyncLog(result, trigger));
    await deps.persistAudit(db, {
      trigger,
      result,
      startedAt,
      finishedAt: new Date(),
    });
    return result;
  }
}
