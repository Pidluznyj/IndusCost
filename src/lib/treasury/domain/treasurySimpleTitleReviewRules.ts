/**
 * Categorias visuais simples — revisão diária de CR/CP.
 * Sem Prisma; sem enums técnicos na UI.
 */

import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryPayableListItemDto } from "../contracts/treasuryPayableContracts.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export const TREASURY_SIMPLE_RECEIVABLE_REVIEW_CATEGORIES = [
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "PLANNED_TODAY",
  "NOT_RECEIVED",
  "OVERDUE",
  "UNLINKED_ACCOUNT",
] as const;
export type TreasurySimpleReceivableReviewCategory =
  (typeof TREASURY_SIMPLE_RECEIVABLE_REVIEW_CATEGORIES)[number];

export const TREASURY_SIMPLE_PAYABLE_REVIEW_CATEGORIES = [
  "PAID",
  "PARTIALLY_PAID",
  "PLANNED_TODAY",
  "PENDING",
  "OVERDUE",
  "UNLINKED_ACCOUNT",
] as const;
export type TreasurySimplePayableReviewCategory =
  (typeof TREASURY_SIMPLE_PAYABLE_REVIEW_CATEGORIES)[number];

export const TREASURY_SIMPLE_REVIEW_BUCKETS = [
  "ALL",
  "PLANNED",
  "REALIZED",
  "PENDING",
  "UNLINKED",
] as const;
export type TreasurySimpleReviewBucket =
  (typeof TREASURY_SIMPLE_REVIEW_BUCKETS)[number];

export const TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS: Record<
  TreasurySimpleReceivableReviewCategory,
  string
> = {
  RECEIVED: "Recebido",
  PARTIALLY_RECEIVED: "Parcialmente recebido",
  PLANNED_TODAY: "Previsto para hoje",
  NOT_RECEIVED: "Não recebido",
  OVERDUE: "Vencido",
  UNLINKED_ACCOUNT: "Conta não vinculada",
};

export const TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS: Record<
  TreasurySimplePayableReviewCategory,
  string
> = {
  PAID: "Pago",
  PARTIALLY_PAID: "Parcialmente pago",
  PLANNED_TODAY: "Previsto para hoje",
  PENDING: "Pendente",
  OVERDUE: "Vencido",
  UNLINKED_ACCOUNT: "Conta não vinculada",
};

export const TREASURY_SIMPLE_REVIEW_BUCKET_LABELS: Record<
  TreasurySimpleReviewBucket,
  string
> = {
  ALL: "Todos",
  PLANNED: "Previsto",
  REALIZED: "Realizado",
  PENDING: "Pendente",
  UNLINKED: "Sem vínculo",
};

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

function isPositive(value: string | null | undefined): boolean {
  return compareTreasuryMoney(money(value), "0.00") > 0;
}

function plannedAccountIdFromReceivable(
  row: TreasuryReceivableListItemDto
): string | null {
  return row.complement?.plannedAccountId ?? null;
}

function plannedAccountIdFromPayable(
  row: TreasuryPayableListItemDto
): string | null {
  return row.plannedAccountId ?? row.complement?.plannedAccountId ?? null;
}

/**
 * Categoria visual do recebimento (prioriza vínculo de conta e baixa oficial).
 */
export function deriveTreasurySimpleReceivableReviewCategory(
  row: TreasuryReceivableListItemDto,
  civilDate: string,
  options?: { linkedAccountId?: string | null }
): TreasurySimpleReceivableReviewCategory {
  const planned = plannedAccountIdFromReceivable(row);
  const linked =
    planned ||
    (options?.linkedAccountId?.trim() ? options.linkedAccountId.trim() : null);
  if (!linked) return "UNLINKED_ACCOUNT";

  const settled = Boolean(row.official.officialStatus.isSettled);
  const received = money(row.receivedAmount ?? row.official.settlements.settledAmount);
  const open = money(row.openAmount ?? row.official.openBalance);
  const hasReceived = isPositive(received);
  const hasOpen = isPositive(open);

  if (settled || (hasReceived && !hasOpen)) return "RECEIVED";
  if (hasReceived && hasOpen) return "PARTIALLY_RECEIVED";

  if (row.daysOverdue > 0 || row.operationalStatus === "OVERDUE") {
    return "OVERDUE";
  }

  const due = row.official.dueDate;
  const expected = row.complement?.expectedDate ?? null;
  const settledAt = row.official.settlements.settledAt ?? null;
  if (due === civilDate || expected === civilDate || settledAt === civilDate) {
    return due === civilDate || expected === civilDate
      ? "PLANNED_TODAY"
      : "RECEIVED";
  }
  return "NOT_RECEIVED";
}

/**
 * Categoria visual do pagamento.
 */
export function deriveTreasurySimplePayableReviewCategory(
  row: TreasuryPayableListItemDto,
  civilDate: string,
  options?: { linkedAccountId?: string | null }
): TreasurySimplePayableReviewCategory {
  const planned = plannedAccountIdFromPayable(row);
  const linked =
    planned ||
    (options?.linkedAccountId?.trim() ? options.linkedAccountId.trim() : null);
  if (!linked) return "UNLINKED_ACCOUNT";

  const settled = Boolean(row.official.officialStatus.isSettled);
  const paid = money(row.paidAmount ?? row.official.settlements.settledAmount);
  const open = money(row.openAmount ?? row.official.openBalance);
  const hasPaid = isPositive(paid);
  const hasOpen = isPositive(open);

  if (settled || (hasPaid && !hasOpen)) return "PAID";
  if (hasPaid && hasOpen) return "PARTIALLY_PAID";

  if (row.daysOverdue > 0 || row.operationalStatus === "OVERDUE") {
    return "OVERDUE";
  }

  const due = row.official.dueDate;
  const expected =
    row.complement?.expectedDate ?? row.complement?.scheduledDate ?? null;
  const settledAt =
    row.official.settlements.paidAt ??
    row.official.settlements.settledAt ??
    null;
  if (due === civilDate || expected === civilDate || settledAt === civilDate) {
    return due === civilDate || expected === civilDate
      ? "PLANNED_TODAY"
      : "PAID";
  }
  return "PENDING";
}

export function receivableCategoryMatchesBucket(
  category: TreasurySimpleReceivableReviewCategory,
  bucket: TreasurySimpleReviewBucket
): boolean {
  if (bucket === "ALL") return true;
  if (bucket === "UNLINKED") return category === "UNLINKED_ACCOUNT";
  if (bucket === "REALIZED") {
    return category === "RECEIVED" || category === "PARTIALLY_RECEIVED";
  }
  if (bucket === "PLANNED") {
    return category === "PLANNED_TODAY" || category === "NOT_RECEIVED";
  }
  if (bucket === "PENDING") {
    return (
      category === "NOT_RECEIVED" ||
      category === "OVERDUE" ||
      category === "PARTIALLY_RECEIVED" ||
      category === "PLANNED_TODAY"
    );
  }
  return true;
}

export function payableCategoryMatchesBucket(
  category: TreasurySimplePayableReviewCategory,
  bucket: TreasurySimpleReviewBucket
): boolean {
  if (bucket === "ALL") return true;
  if (bucket === "UNLINKED") return category === "UNLINKED_ACCOUNT";
  if (bucket === "REALIZED") {
    return category === "PAID" || category === "PARTIALLY_PAID";
  }
  if (bucket === "PLANNED") {
    return category === "PLANNED_TODAY" || category === "PENDING";
  }
  if (bucket === "PENDING") {
    return (
      category === "PENDING" ||
      category === "OVERDUE" ||
      category === "PARTIALLY_PAID" ||
      category === "PLANNED_TODAY"
    );
  }
  return true;
}

export function filterTreasurySimpleReceivableRows(input: {
  rows: readonly TreasuryReceivableListItemDto[];
  civilDate: string;
  category: TreasurySimpleReceivableReviewCategory | "ALL";
  bucket: TreasurySimpleReviewBucket;
  /** Conta do filtro diário — títulos vinculados via Nomus bank não ficam “sem vínculo”. */
  linkedAccountId?: string | null;
}): Array<{
  row: TreasuryReceivableListItemDto;
  category: TreasurySimpleReceivableReviewCategory;
}> {
  const out: Array<{
    row: TreasuryReceivableListItemDto;
    category: TreasurySimpleReceivableReviewCategory;
  }> = [];
  for (const row of input.rows) {
    const category = deriveTreasurySimpleReceivableReviewCategory(
      row,
      input.civilDate,
      { linkedAccountId: input.linkedAccountId }
    );
    if (input.category !== "ALL" && category !== input.category) continue;
    if (!receivableCategoryMatchesBucket(category, input.bucket)) continue;
    out.push({ row, category });
  }
  return out;
}

export function filterTreasurySimplePayableRows(input: {
  rows: readonly TreasuryPayableListItemDto[];
  civilDate: string;
  category: TreasurySimplePayableReviewCategory | "ALL";
  bucket: TreasurySimpleReviewBucket;
  linkedAccountId?: string | null;
}): Array<{
  row: TreasuryPayableListItemDto;
  category: TreasurySimplePayableReviewCategory;
}> {
  const out: Array<{
    row: TreasuryPayableListItemDto;
    category: TreasurySimplePayableReviewCategory;
  }> = [];
  for (const row of input.rows) {
    const category = deriveTreasurySimplePayableReviewCategory(
      row,
      input.civilDate,
      { linkedAccountId: input.linkedAccountId }
    );
    if (input.category !== "ALL" && category !== input.category) continue;
    if (!payableCategoryMatchesBucket(category, input.bucket)) continue;
    out.push({ row, category });
  }
  return out;
}

/** Paths da experiência simples (UI). */
export const TREASURY_SIMPLE_RECEIVABLES_REVIEW_PATH =
  "/finance/treasury/today/receivables" as const;
export const TREASURY_SIMPLE_PAYABLES_REVIEW_PATH =
  "/finance/treasury/today/payables" as const;
