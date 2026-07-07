import type {
  ReceiptClosingApiLine,
  ReceiptClosingApiSellerRow,
} from "./commissionReceiptClosingApi.shared.js";
import {
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL,
  resolveReceiptClosingSellerGroupKey,
  sumUniqueReceivedFromLines,
} from "./commissionReceiptClosingApi.shared.js";
import { roundMoney } from "./commission-money.shared.js";

/** Chave estável de agrupamento — espelha `buildReceiptClosingBySeller`. */
export function receiptClosingSellerRowKey(row: {
  sellerId: string | null;
  sellerName: string | null;
}): string {
  return row.sellerId ?? row.sellerName ?? RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
}

export function receiptClosingLineSellerKey(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId?: number | null;
  rawSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
  return resolveReceiptClosingSellerGroupKey(line);
}

export function receiptClosingSellerFilterLabel(row: {
  sellerId: string | null;
  sellerName: string | null;
}): string {
  return row.sellerName?.trim() || RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL;
}

export function filterReceiptClosingLinesBySellerKey(
  lines: ReceiptClosingApiLine[],
  sellerKey: string | null
): ReceiptClosingApiLine[] {
  if (sellerKey == null) return lines;
  return lines.filter((line) => receiptClosingLineSellerKey(line) === sellerKey);
}

export function findReceiptClosingSellerRowByKey(
  rows: ReceiptClosingApiSellerRow[],
  sellerKey: string
): ReceiptClosingApiSellerRow | undefined {
  return rows.find((row) => receiptClosingSellerRowKey(row) === sellerKey);
}

export type ReceiptClosingDetailTotals = {
  lineCount: number;
  receivedAmount: number;
  scheduledCommissionAmount: number;
  releasedCommissionAmount: number;
};

export function computeReceiptClosingDetailTotals(
  lines: ReceiptClosingApiLine[]
): ReceiptClosingDetailTotals {
  let scheduledCommissionAmount = 0;
  let releasedCommissionAmount = 0;
  for (const line of lines) {
    if (line.scheduledCommissionAmount != null) {
      scheduledCommissionAmount += line.scheduledCommissionAmount;
    }
    releasedCommissionAmount += line.releasedCommissionAmount;
  }
  return {
    lineCount: lines.length,
    receivedAmount: sumUniqueReceivedFromLines(lines),
    scheduledCommissionAmount: roundMoney(scheduledCommissionAmount),
    releasedCommissionAmount: roundMoney(releasedCommissionAmount),
  };
}

export type ReceiptClosingSellerTotals = {
  rowCount: number;
  receivedAmount: number;
  commissionableBase: number;
  grossCommission: number;
  excludedCommission: number;
  releasedCommission: number;
  exceptionCount: number;
};

function safeSellerMetric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Soma colunas numéricas do resumo Por vendedor (linhas já agregadas pelo backend). */
export function computeReceiptClosingSellerTotals(
  rows: Pick<
    ReceiptClosingApiSellerRow,
    | "receivedAmount"
    | "commissionableBase"
    | "grossCommission"
    | "excludedCommission"
    | "releasedCommission"
    | "exceptionCount"
  >[]
): ReceiptClosingSellerTotals {
  let receivedAmount = 0;
  let commissionableBase = 0;
  let grossCommission = 0;
  let excludedCommission = 0;
  let releasedCommission = 0;
  let exceptionCount = 0;

  for (const row of rows) {
    receivedAmount += safeSellerMetric(row.receivedAmount);
    commissionableBase += safeSellerMetric(row.commissionableBase);
    grossCommission += safeSellerMetric(row.grossCommission);
    excludedCommission += safeSellerMetric(row.excludedCommission);
    releasedCommission += safeSellerMetric(row.releasedCommission);
    exceptionCount += Math.trunc(safeSellerMetric(row.exceptionCount));
  }

  return {
    rowCount: rows.length,
    receivedAmount: roundMoney(receivedAmount),
    commissionableBase: roundMoney(commissionableBase),
    grossCommission: roundMoney(grossCommission),
    excludedCommission: roundMoney(excludedCommission),
    releasedCommission: roundMoney(releasedCommission),
    exceptionCount,
  };
}
