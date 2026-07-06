/**
 * Rateio da comissão materializada (order snapshot) por título de Contas a Receber.
 * Lógica pura — persistência em commissionReceivableScheduler.server.ts.
 *
 * Não reutiliza CommissionPaymentSchedule (legado, vinculado a CommissionRecord por item).
 */
import { createHash } from "node:crypto";
import { allocateProportional, roundMoney } from "./commission-money.js";

export type CommissionReceivableScheduleStatusValue =
  | "ACTIVE"
  | "STALE"
  | "SUPERSEDED"
  | "ORPHAN"
  | "CUSTOMER_EXCLUDED"
  | "ERROR";

export type CommissionReceivableScheduleInput = {
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  receivableNominalAmount: number;
};

export type CommissionOrderSnapshotScheduleContext = {
  id: string;
  sourceHash: string;
  salesOrderId: string;
  nfeId: number | null;
  customerId: string;
  canonicalSellerId: string | null;
  totalFinalCommissionAmount: number;
  itemStatuses: string[];
};

export type CommissionReceivableScheduleDraft = {
  orderSnapshotId: string;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  nfeId: number | null;
  salesOrderId: string;
  customerId: string;
  canonicalSellerId: string | null;
  receivableNominalAmount: number;
  receivableSharePercent: number;
  scheduledCommissionAmount: number;
  status: CommissionReceivableScheduleStatusValue;
  sourceHash: string;
};

export type CommissionReceivableScheduleRebuildPlan = {
  unchanged: CommissionReceivableScheduleDraft[];
  toCreate: CommissionReceivableScheduleDraft[];
  toSupersede: Array<{ receivableId: number; existingId: string }>;
  toStale: Array<{ receivableId: number; existingId: string }>;
};

export type CommissionReceivableScheduleRebuildResult = {
  action: "unchanged" | "created" | "updated" | "mixed";
  orderSnapshotId: string;
  schedulesCreated: number;
  schedulesSuperseded: number;
  schedulesStaled: number;
  schedulesUnchanged: number;
  dryRun: boolean;
  preview: CommissionReceivableScheduleDraft[];
};

function hashPayload(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => (part == null ? "" : String(part))).join("|"))
    .digest("hex");
}

function normalizeRate(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 10000) / 10000);
}

export function buildCommissionReceivableScheduleSourceHash(input: {
  orderSnapshotId: string;
  orderSnapshotSourceHash: string;
  receivableId: number;
  receivableNominalAmount: number;
  receivableSharePercent: number;
  scheduledCommissionAmount: number;
  status: CommissionReceivableScheduleStatusValue;
}): string {
  return hashPayload([
    "receivable-schedule",
    input.orderSnapshotId,
    input.orderSnapshotSourceHash,
    input.receivableId,
    roundMoney(input.receivableNominalAmount),
    normalizeRate(input.receivableSharePercent),
    roundMoney(input.scheduledCommissionAmount),
    input.status,
  ]);
}

/** Deriva status da linha de schedule a partir do snapshot da venda. */
export function deriveReceivableScheduleStatus(
  snapshot: Pick<CommissionOrderSnapshotScheduleContext, "itemStatuses" | "totalFinalCommissionAmount">
): CommissionReceivableScheduleStatusValue {
  if (snapshot.itemStatuses.length === 0) return "ERROR";
  if (snapshot.itemStatuses.every((status) => status === "CUSTOMER_EXCLUDED")) {
    return "CUSTOMER_EXCLUDED";
  }
  if (snapshot.itemStatuses.some((status) => status === "ERROR")) {
    return "ERROR";
  }
  return "ACTIVE";
}

/**
 * Rateia a comissão final do snapshot entre títulos pelo valor nominal.
 * Ex.: NF R$ 10.000, comissão R$ 160, 2 títulos de R$ 5.000 → R$ 80 cada.
 */
export function buildCommissionReceivableScheduleDrafts(input: {
  snapshot: CommissionOrderSnapshotScheduleContext;
  receivables: CommissionReceivableScheduleInput[];
}): CommissionReceivableScheduleDraft[] {
  if (input.receivables.length === 0) return [];

  const lineStatus = deriveReceivableScheduleStatus(input.snapshot);
  const commissionTotal = roundMoney(input.snapshot.totalFinalCommissionAmount);
  const parts = input.receivables.map((row) => ({
    key: String(row.receivableId),
    weight: row.receivableNominalAmount,
  }));
  const allocations = allocateProportional(commissionTotal, parts);

  return input.receivables.map((row, index) => {
    const receivableSharePercent = allocations[index]?.percent ?? 0;
    const scheduledCommissionAmount = allocations[index]?.amount ?? 0;
    const sourceHash = buildCommissionReceivableScheduleSourceHash({
      orderSnapshotId: input.snapshot.id,
      orderSnapshotSourceHash: input.snapshot.sourceHash,
      receivableId: row.receivableId,
      receivableNominalAmount: row.receivableNominalAmount,
      receivableSharePercent,
      scheduledCommissionAmount,
      status: lineStatus,
    });

    return {
      orderSnapshotId: input.snapshot.id,
      receivableId: row.receivableId,
      receivableCode: row.receivableCode,
      installmentNumber: row.installmentNumber,
      nfeId: input.snapshot.nfeId,
      salesOrderId: input.snapshot.salesOrderId,
      customerId: input.snapshot.customerId,
      canonicalSellerId: input.snapshot.canonicalSellerId,
      receivableNominalAmount: row.receivableNominalAmount,
      receivableSharePercent,
      scheduledCommissionAmount,
      status: lineStatus,
      sourceHash,
    };
  });
}

export function planCommissionReceivableScheduleRebuild(input: {
  existingActive: Array<{ id: string; receivableId: number; sourceHash: string }>;
  drafts: CommissionReceivableScheduleDraft[];
}): CommissionReceivableScheduleRebuildPlan {
  const existingByReceivableId = new Map(
    input.existingActive.map((row) => [row.receivableId, row])
  );
  const newReceivableIds = new Set(input.drafts.map((draft) => draft.receivableId));

  const unchanged: CommissionReceivableScheduleDraft[] = [];
  const toCreate: CommissionReceivableScheduleDraft[] = [];
  const toSupersede: Array<{ receivableId: number; existingId: string }> = [];
  const toStale: Array<{ receivableId: number; existingId: string }> = [];

  for (const draft of input.drafts) {
    const existing = existingByReceivableId.get(draft.receivableId);
    if (!existing) {
      toCreate.push(draft);
      continue;
    }
    if (existing.sourceHash === draft.sourceHash) {
      unchanged.push(draft);
      continue;
    }
    toSupersede.push({ receivableId: draft.receivableId, existingId: existing.id });
    toCreate.push(draft);
  }

  for (const existing of input.existingActive) {
    if (!newReceivableIds.has(existing.receivableId)) {
      toStale.push({ receivableId: existing.receivableId, existingId: existing.id });
    }
  }

  return { unchanged, toCreate, toSupersede, toStale };
}

export function summarizeReceivableScheduleRebuild(
  plan: CommissionReceivableScheduleRebuildPlan,
  input: {
    orderSnapshotId: string;
    dryRun: boolean;
    drafts: CommissionReceivableScheduleDraft[];
  }
): CommissionReceivableScheduleRebuildResult {
  const schedulesCreated = plan.toCreate.length;
  const schedulesSuperseded = plan.toSupersede.length;
  const schedulesStaled = plan.toStale.length;
  const schedulesUnchanged = plan.unchanged.length;

  let action: CommissionReceivableScheduleRebuildResult["action"] = "unchanged";
  if (schedulesCreated > 0 && schedulesSuperseded === 0 && schedulesStaled === 0) {
    action = schedulesUnchanged > 0 ? "mixed" : "created";
  } else if (schedulesSuperseded > 0 || schedulesStaled > 0) {
    action = schedulesCreated > 0 || schedulesStaled > 0 ? "updated" : "unchanged";
  }
  if (schedulesCreated === 0 && schedulesSuperseded === 0 && schedulesStaled === 0) {
    action = "unchanged";
  } else if (
    schedulesCreated > 0 &&
    (schedulesSuperseded > 0 || schedulesStaled > 0 || schedulesUnchanged > 0)
  ) {
    action = "mixed";
  }

  return {
    action,
    orderSnapshotId: input.orderSnapshotId,
    schedulesCreated,
    schedulesSuperseded,
    schedulesStaled,
    schedulesUnchanged,
    dryRun: input.dryRun,
    preview: input.drafts,
  };
}
