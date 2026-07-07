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
  rawSellerName: string | null;
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
    scheduledCommissionAmount: Math.round(scheduledCommissionAmount * 100) / 100,
    releasedCommissionAmount: Math.round(releasedCommissionAmount * 100) / 100,
  };
}
