import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber, toPrismaDecimal } from "./commission-money.js";
import {
  buildCommissionReceivableScheduleDrafts,
  planCommissionReceivableScheduleRebuild,
  summarizeReceivableScheduleRebuild,
  type CommissionOrderSnapshotScheduleContext,
  type CommissionReceivableScheduleDraft,
  type CommissionReceivableScheduleInput,
  type CommissionReceivableScheduleRebuildResult,
} from "./commissionReceivableScheduler.js";
import { resolveUniqueSalesOrderFromNfeLinkCandidates } from "./commissionSalesOrderNfeLinkResolution.js";

export class OrderSnapshotNotFoundError extends Error {
  constructor(
    public readonly salesOrderId: string | null,
    public readonly nfeId: number | null
  ) {
    super(
      `Snapshot ACTIVE de comissão não encontrado para pedido=${salesOrderId ?? "—"} nfe=${nfeId ?? "—"}`
    );
    this.name = "OrderSnapshotNotFoundError";
  }
}

export type RebuildCommissionReceivableScheduleInput = {
  salesOrderId?: string;
  nfeId?: number;
  dryRun?: boolean;
};

type SchedulerDb = Pick<PrismaClient, "commissionReceivableSchedule" | "$transaction">;

function mapDraftToCreateData(
  draft: CommissionReceivableScheduleDraft
): Prisma.CommissionReceivableScheduleCreateInput {
  return {
    orderSnapshot: { connect: { id: draft.orderSnapshotId } },
    receivableId: draft.receivableId,
    receivableCode: draft.receivableCode,
    installmentNumber: draft.installmentNumber,
    nfeId: draft.nfeId,
    salesOrder: { connect: { id: draft.salesOrderId } },
    customer: { connect: { id: draft.customerId } },
    canonicalSeller: draft.canonicalSellerId
      ? { connect: { id: draft.canonicalSellerId } }
      : undefined,
    receivableNominalAmount: toPrismaDecimal(draft.receivableNominalAmount),
    receivableSharePercent: toPrismaDecimal(draft.receivableSharePercent),
    scheduledCommissionAmount: toPrismaDecimal(draft.scheduledCommissionAmount),
    status: draft.status,
    sourceHash: draft.sourceHash,
  };
}

async function loadReceivablesForNfe(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  nfeId: number
): Promise<CommissionReceivableScheduleInput[]> {
  const rows = await db.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: nfeId },
    select: {
      externalId: true,
      sourceInvoiceNumber: true,
      dueDate: true,
      amountReceivable: true,
    },
    orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
  });

  return rows.map((row, index) => ({
    receivableId: row.externalId,
    receivableCode: row.sourceInvoiceNumber?.trim() || null,
    installmentNumber: index + 1,
    receivableNominalAmount: decimalToNumber(row.amountReceivable),
  }));
}

async function resolveActiveOrderSnapshot(
  db: Pick<PrismaClient, "commissionOrderSnapshot" | "salesOrder">,
  input: RebuildCommissionReceivableScheduleInput
): Promise<{
  snapshot: CommissionOrderSnapshotScheduleContext;
  salesOrderId: string;
  nfeId: number | null;
}> {
  let salesOrderId = input.salesOrderId ?? null;
  let nfeId = input.nfeId ?? null;

  if (!salesOrderId && nfeId != null) {
    const links = await db.salesOrder.findMany({
      where: { nfeLinks: { some: { nfeExternalId: nfeId } } },
      select: { id: true, orderCode: true },
    });
    const resolution = resolveUniqueSalesOrderFromNfeLinkCandidates(
      links.map((row) => ({ salesOrderId: row.id, orderCode: row.orderCode }))
    );
    if (resolution.status === "AMBIGUOUS") {
      throw new OrderSnapshotNotFoundError(null, nfeId);
    }
    salesOrderId = resolution.salesOrderId;
  }

  if (!salesOrderId) {
    throw new OrderSnapshotNotFoundError(null, nfeId);
  }

  const snapshotRow = await db.commissionOrderSnapshot.findFirst({
    where: {
      salesOrderId,
      ...(nfeId != null ? { nfeId } : {}),
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { status: true } } },
  });

  if (!snapshotRow) {
    throw new OrderSnapshotNotFoundError(salesOrderId, nfeId);
  }

  const effectiveNfeId = nfeId ?? snapshotRow.nfeId;
  const snapshot: CommissionOrderSnapshotScheduleContext = {
    id: snapshotRow.id,
    sourceHash: snapshotRow.sourceHash,
    salesOrderId: snapshotRow.salesOrderId,
    nfeId: effectiveNfeId,
    customerId: snapshotRow.customerId,
    canonicalSellerId: snapshotRow.canonicalSellerId,
    totalFinalCommissionAmount: decimalToNumber(snapshotRow.totalFinalCommissionAmount),
    itemStatuses: snapshotRow.items.map((item) => item.status),
  };

  return { snapshot, salesOrderId, nfeId: effectiveNfeId };
}

export async function persistCommissionReceivableScheduleRebuild(
  db: SchedulerDb,
  input: {
    orderSnapshotId: string;
    plan: ReturnType<typeof planCommissionReceivableScheduleRebuild>;
    drafts: CommissionReceivableScheduleDraft[];
    dryRun: boolean;
  }
): Promise<CommissionReceivableScheduleRebuildResult> {
  const result = summarizeReceivableScheduleRebuild(input.plan, {
    orderSnapshotId: input.orderSnapshotId,
    dryRun: input.dryRun,
    drafts: input.drafts,
  });

  if (input.dryRun) return result;
  if (
    input.plan.toCreate.length === 0 &&
    input.plan.toSupersede.length === 0 &&
    input.plan.toStale.length === 0
  ) {
    return result;
  }

  await db.$transaction(async (tx) => {
    if (input.plan.toStale.length > 0) {
      await tx.commissionReceivableSchedule.updateMany({
        where: { id: { in: input.plan.toStale.map((row) => row.existingId) } },
        data: { status: "STALE" },
      });
    }

    if (input.plan.toSupersede.length > 0) {
      await tx.commissionReceivableSchedule.updateMany({
        where: { id: { in: input.plan.toSupersede.map((row) => row.existingId) } },
        data: { status: "SUPERSEDED" },
      });
    }

    for (const draft of input.plan.toCreate) {
      await tx.commissionReceivableSchedule.create({
        data: mapDraftToCreateData(draft),
      });
    }
  });

  return result;
}

/**
 * Reconstrói o rateio da comissão da venda entre títulos de Contas a Receber.
 * Idempotente por sourceHash; não altera fechamentos mensais CLOSED.
 */
export async function rebuildCommissionReceivableSchedule(
  db: PrismaClient,
  input: RebuildCommissionReceivableScheduleInput
): Promise<CommissionReceivableScheduleRebuildResult> {
  if (!input.salesOrderId && input.nfeId == null) {
    throw new Error("Informe salesOrderId ou nfeId.");
  }

  const { snapshot, nfeId } = await resolveActiveOrderSnapshot(db, input);
  const receivables =
    nfeId != null ? await loadReceivablesForNfe(db, nfeId) : [];

  const drafts = buildCommissionReceivableScheduleDrafts({ snapshot, receivables });
  const existingActive = await db.commissionReceivableSchedule.findMany({
    where: {
      orderSnapshotId: snapshot.id,
      status: "ACTIVE",
    },
    select: { id: true, receivableId: true, sourceHash: true },
  });

  const plan = planCommissionReceivableScheduleRebuild({
    existingActive,
    drafts,
  });

  return persistCommissionReceivableScheduleRebuild(db, {
    orderSnapshotId: snapshot.id,
    plan,
    drafts,
    dryRun: input.dryRun ?? false,
  });
}
