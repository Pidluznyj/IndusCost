/**
 * Workflow operacional de fechamento mensal — status derivado, sem persistência própria.
 * Integra leitura de CommissionPaymentBatch quando existir lote no período.
 */
import { roundMoney } from "./commission-money.js";
import type { CommissionMonthlyPayableSellerSummary } from "./commissionMonthlyPayable.js";
import type { VisualAuditNomusReference } from "./commissionVisualAudit.js";

export const MONTHLY_CLOSING_WORKFLOW_STATUSES = [
  "CALCULATED",
  "REVIEWED",
  "DIVERGENT",
  "APPROVED",
  "PAID",
] as const;

export type MonthlyClosingWorkflowStatus = (typeof MONTHLY_CLOSING_WORKFLOW_STATUSES)[number];

export type PaymentBatchStatusSnapshot = "DRAFT" | "APPROVED" | "PAID";

export type SellerPaymentBatchLink = {
  batchId: string;
  status: PaymentBatchStatusSnapshot;
  totalSelected: number;
  totalPaid: number;
};

export const MONTHLY_CLOSING_STATUS_LABELS: Record<MonthlyClosingWorkflowStatus, string> = {
  CALCULATED: "Calculado",
  REVIEWED: "Revisado",
  DIVERGENT: "Divergente",
  APPROVED: "Aprovado",
  PAID: "Pago",
};

/** Limiar de diferença Nomus considerada crítica (R$). */
export const CRITICAL_NOMUS_COMMISSION_DIFF = 0.02;

/** Limiar percentual de diferença Nomus considerada crítica. */
export const CRITICAL_NOMUS_COMMISSION_DIFF_PERCENT = 1;

export type MonthlyClosingWorkflowInput = {
  divergenceCount: number;
  warnings: string[];
  nomusReference: Pick<
    VisualAuditNomusReference,
    "commissionDiff" | "commissionDiffPercent" | "comparable"
  > | null;
  paymentBatch: SellerPaymentBatchLink | null;
  sellerHasLineAlerts: boolean;
};

export type MonthlyClosingWorkflowResult = {
  status: MonthlyClosingWorkflowStatus;
  statusLabel: string;
  isCriticalDivergence: boolean;
  canApprove: boolean;
  approvalBlockedReason: string | null;
  paymentBatchId: string | null;
  paymentBatchStatus: PaymentBatchStatusSnapshot | null;
};

export type MonthlyClosingWorkflowMeta = {
  /** Fechamento mensal não grava aprovação própria — usa lotes de pagamento existentes. */
  persistApproval: false;
  overallStatus: MonthlyClosingWorkflowStatus;
  overallStatusLabel: string;
  canApprove: boolean;
  approvalBlockedReason: string | null;
  sellerRows: Array<
    CommissionMonthlyPayableSellerSummary & {
      workflow: MonthlyClosingWorkflowResult;
    }
  >;
};

const BATCH_STATUS_PRIORITY: Record<PaymentBatchStatusSnapshot, number> = {
  DRAFT: 1,
  APPROVED: 2,
  PAID: 3,
};

export function isCriticalNomusDivergence(
  nomusReference: MonthlyClosingWorkflowInput["nomusReference"]
): boolean {
  if (!nomusReference?.comparable) return false;
  if (
    nomusReference.commissionDiff != null &&
    Math.abs(nomusReference.commissionDiff) > CRITICAL_NOMUS_COMMISSION_DIFF
  ) {
    return true;
  }
  if (
    nomusReference.commissionDiffPercent != null &&
    Math.abs(nomusReference.commissionDiffPercent) > CRITICAL_NOMUS_COMMISSION_DIFF_PERCENT
  ) {
    return true;
  }
  return false;
}

export function hasCriticalDataDivergence(input: {
  divergenceCount: number;
  warnings: string[];
  sellerHasLineAlerts: boolean;
  nomusReference: MonthlyClosingWorkflowInput["nomusReference"];
}): boolean {
  if (input.divergenceCount > 0) return true;
  if (input.sellerHasLineAlerts) return true;
  if (input.warnings.length > 0) return true;
  return isCriticalNomusDivergence(input.nomusReference);
}

export function validateClosingApproval(input: {
  status: MonthlyClosingWorkflowStatus;
  isCriticalDivergence: boolean;
  justification?: string | null;
}): { ok: boolean; reason: string | null } {
  if (input.status === "PAID") {
    return { ok: false, reason: "Fechamento já consta como pago via lote de pagamento." };
  }
  if (input.status === "APPROVED") {
    return { ok: false, reason: "Já existe lote aprovado para este vendedor/período." };
  }
  if (input.isCriticalDivergence && !input.justification?.trim()) {
    return {
      ok: false,
      reason:
        "Divergência crítica (alertas ou diferença Nomus) exige justificativa antes de aprovar.",
    };
  }
  if (input.status === "DIVERGENT" && !input.justification?.trim()) {
    return {
      ok: false,
      reason: "Status divergente — registre justificativa ou corrija os títulos antes de aprovar.",
    };
  }
  return { ok: true, reason: null };
}

export function resolveMonthlyClosingWorkflowStatus(
  input: MonthlyClosingWorkflowInput
): MonthlyClosingWorkflowResult {
  const isCriticalDivergence = hasCriticalDataDivergence({
    divergenceCount: input.divergenceCount,
    warnings: input.warnings,
    sellerHasLineAlerts: input.sellerHasLineAlerts,
    nomusReference: input.nomusReference,
  });

  const batchStatus = input.paymentBatch?.status ?? null;

  let status: MonthlyClosingWorkflowStatus;
  if (batchStatus === "PAID") {
    status = "PAID";
  } else if (batchStatus === "APPROVED") {
    status = "APPROVED";
  } else if (isCriticalDivergence) {
    status = "DIVERGENT";
  } else if (batchStatus === "DRAFT") {
    status = "REVIEWED";
  } else {
    status = "CALCULATED";
  }

  const approval = validateClosingApproval({ status, isCriticalDivergence });

  return {
    status,
    statusLabel: MONTHLY_CLOSING_STATUS_LABELS[status],
    isCriticalDivergence,
    canApprove: approval.ok,
    approvalBlockedReason: approval.reason,
    paymentBatchId: input.paymentBatch?.batchId ?? null,
    paymentBatchStatus: batchStatus,
  };
}

export function pickDominantBatchForSeller(
  batches: SellerPaymentBatchLink[]
): SellerPaymentBatchLink | null {
  if (batches.length === 0) return null;
  return [...batches].sort(
    (a, b) => BATCH_STATUS_PRIORITY[b.status] - BATCH_STATUS_PRIORITY[a.status]
  )[0]!;
}

const OVERALL_STATUS_PRIORITY: Record<MonthlyClosingWorkflowStatus, number> = {
  DIVERGENT: 5,
  CALCULATED: 4,
  REVIEWED: 3,
  APPROVED: 2,
  PAID: 1,
};

export function resolveOverallClosingStatus(
  sellerStatuses: MonthlyClosingWorkflowStatus[]
): MonthlyClosingWorkflowStatus {
  if (sellerStatuses.length === 0) return "CALCULATED";
  return [...sellerStatuses].sort(
    (a, b) => OVERALL_STATUS_PRIORITY[b] - OVERALL_STATUS_PRIORITY[a]
  )[0]!;
}

export function buildMonthlyClosingWorkflowMeta(input: {
  sellers: CommissionMonthlyPayableSellerSummary[];
  divergenceCount: number;
  warnings: string[];
  nomusReference: VisualAuditNomusReference | null;
  paymentBatchesBySeller: Map<string, SellerPaymentBatchLink[]>;
  sellerLineAlertCounts: Map<string, number>;
}): MonthlyClosingWorkflowMeta {
  const sellerRows = input.sellers.map((seller) => {
    const batch = pickDominantBatchForSeller(
      input.paymentBatchesBySeller.get(seller.sellerId) ?? []
    );
    const workflow = resolveMonthlyClosingWorkflowStatus({
      divergenceCount: input.divergenceCount,
      warnings: seller.warnings,
      nomusReference: input.nomusReference,
      paymentBatch: batch,
      sellerHasLineAlerts: (input.sellerLineAlertCounts.get(seller.sellerId) ?? 0) > 0,
    });
    return { ...seller, workflow };
  });

  const overallStatus = resolveOverallClosingStatus(sellerRows.map((s) => s.workflow.status));
  const overallCritical = sellerRows.some((s) => s.workflow.isCriticalDivergence);
  const overallApproval = validateClosingApproval({
    status: overallStatus,
    isCriticalDivergence: overallCritical,
  });

  return {
    persistApproval: false,
    overallStatus,
    overallStatusLabel: MONTHLY_CLOSING_STATUS_LABELS[overallStatus],
    canApprove: overallApproval.ok,
    approvalBlockedReason: overallApproval.reason,
    sellerRows,
  };
}

export function formatWorkflowStatusForCsv(status: MonthlyClosingWorkflowStatus): string {
  return MONTHLY_CLOSING_STATUS_LABELS[status];
}

export function appendWorkflowToSellerSummaryCsvLine(
  baseColumns: string[],
  workflow: MonthlyClosingWorkflowResult
): string {
  return [
    ...baseColumns,
    formatWorkflowStatusForCsv(workflow.status),
    workflow.paymentBatchId ?? "",
    workflow.canApprove ? "sim" : "nao",
    workflow.approvalBlockedReason ?? "",
  ].join(",");
}

/** Cabeçalho extra para export oficial com status de workflow. */
export function monthlyClosingWorkflowCsvHeaderSuffix(): string {
  return "status_fechamento,lote_pagamento,pode_aprovar,motivo_bloqueio";
}

export function summarizePaymentBatchTotals(
  batches: SellerPaymentBatchLink[]
): { selected: number; paid: number } {
  let selected = 0;
  let paid = 0;
  for (const b of batches) {
    selected = roundMoney(selected + b.totalSelected);
    paid = roundMoney(paid + b.totalPaid);
  }
  return { selected, paid };
}
