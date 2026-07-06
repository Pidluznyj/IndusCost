/**
 * Payload e export CSV da API de fechamento por recebimento — lógica pura.
 */
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import type {
  ReceiptClosingLedgerLineSnapshot,
  ReceiptClosingSnapshot,
} from "./commissionReceiptClosing.js";

export type ReceiptClosingPageMode = "EMPTY" | "PREVIEW" | "CLOSED";

export type ReceiptClosingApiLine = {
  lineKey: string;
  nomusReceivableId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  orderCode: string | null;
  localOrderId: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  localItemId: string | null;
  nomusOrderItemId: number | null;
  productCode: string | null;
  productName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  receivedAmount: number;
  commissionableBaseAmount: number;
  ratePercent: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  ruleId: string | null;
  ruleName: string | null;
  exclusionReason: string | null;
  status: string;
  statusReason: string | null;
  source: string;
};

export type ReceiptClosingApiSellerRow = {
  sellerId: string | null;
  sellerName: string | null;
  receivableCount: number;
  receivedAmount: number;
  commissionableBase: number;
  expectedCommission: number;
  releasedCommission: number;
  exceptionCount: number;
};

export type ReceiptClosingPagePayload = {
  year: number;
  month: number;
  mode: ReceiptClosingPageMode;
  exportMode: "PREVIEW" | "CLOSED" | "NONE";
  closing: ReceiptClosingSnapshot | null;
  canApply: boolean;
  applyBlockedReason: string | null;
  summary: {
    totalReceivables: number;
    totalReceivedAmount: number;
    totalCommissionableBase: number;
    totalExpectedCommission: number;
    totalReleasedCommission: number;
    totalExcludedAmount: number;
    totalExceptionAmount: number;
    countByStatus: Record<string, number>;
  };
  bySeller: ReceiptClosingApiSellerRow[];
  lines: ReceiptClosingApiLine[];
};

export const RECEIPT_CLOSING_EXPORT_HEADERS = [
  "year",
  "month",
  "closingId",
  "closingStatus",
  "exportMode",
  "receivableId",
  "receivableNumber",
  "installment",
  "dueDate",
  "settlementDate",
  "customerId",
  "customerName",
  "salesOrderId",
  "salesOrderNumber",
  "nfeId",
  "nfeNumber",
  "productId",
  "productName",
  "rawSellerId",
  "rawSellerName",
  "canonicalSellerId",
  "canonicalSellerName",
  "sellerResolutionStatus",
  "receivedAmount",
  "allocatedCommercialBase",
  "commissionRatePercent",
  "expectedCommissionAmount",
  "releasedCommissionAmount",
  "ruleId",
  "ruleNameSnapshot",
  "exclusionReason",
  "lineStatus",
  "exceptionReason",
  "calculationHash",
] as const;

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function mapPreviewLineToApiLine(line: CommissionReceiptPreviewLine): ReceiptClosingApiLine {
  return {
    lineKey: line.ledgerLineKey,
    nomusReceivableId: line.nomusReceivableId,
    receivableNumber: line.receivableNumber,
    installmentNumber: line.installmentNumber,
    settlementDate: line.settlementDate,
    dueDate: line.dueDate,
    customerId: line.customerId,
    customerExternalId: line.customerExternalId,
    customerName: line.customerName,
    orderCode: line.orderCode,
    localOrderId: line.localOrderId,
    nomusNfeId: line.nomusNfeId,
    nfeNumber: line.nfeNumber,
    localItemId: line.localItemId,
    nomusOrderItemId: line.nomusOrderItemId,
    productCode: line.productCode,
    productName: line.productName,
    rawSellerId: line.rawSellerId,
    rawSellerName: line.rawSellerName,
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
    sellerResolutionStatus: line.sellerResolutionStatus,
    receivedAmount: line.receivedAmount,
    commissionableBaseAmount: line.commissionableBaseAmount,
    ratePercent: line.ratePercent,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    ruleId: line.ruleId,
    ruleName: line.ruleName,
    exclusionReason: line.exclusionReason,
    status: line.status,
    statusReason: line.statusReason ?? line.exclusionReason,
    source: line.source,
  };
}

export function mapLedgerLineToApiLine(
  line: ReceiptClosingLedgerLineSnapshot,
  closing: ReceiptClosingSnapshot
): ReceiptClosingApiLine {
  const ruleSnapshot =
    line.ruleSnapshotJson != null && typeof line.ruleSnapshotJson === "object"
      ? (line.ruleSnapshotJson as Record<string, unknown>)
      : null;
  return {
    lineKey: line.ledgerLineKey,
    nomusReceivableId: line.nomusReceivableId,
    receivableNumber: null,
    installmentNumber: line.installmentNumber,
    settlementDate: line.settlementDate,
    dueDate: null,
    customerId: null,
    customerExternalId: null,
    customerName: line.customerName,
    orderCode: line.orderCode,
    localOrderId: null,
    nomusNfeId: null,
    nfeNumber: line.nfeNumber,
    localItemId: null,
    nomusOrderItemId: null,
    productCode: line.productCode,
    productName: null,
    rawSellerId: null,
    rawSellerName: null,
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
    sellerResolutionStatus: null,
    receivedAmount: line.receivedAmount,
    commissionableBaseAmount: line.allocatedCommercialBase,
    ratePercent: line.commissionRatePercent,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    ruleId: ruleSnapshot?.ruleId != null ? String(ruleSnapshot.ruleId) : null,
    ruleName: line.ruleNameSnapshot,
    exclusionReason: line.exclusionReason,
    status: line.status,
    statusReason: line.exceptionReason ?? line.exclusionReason,
    source: "PERSISTED_LEDGER",
  };
}

export function buildReceiptClosingBySeller(
  lines: ReceiptClosingApiLine[]
): ReceiptClosingApiSellerRow[] {
  const map = new Map<string, ReceiptClosingApiSellerRow>();
  for (const line of lines) {
    const key = line.canonicalSellerId ?? line.canonicalSellerName ?? line.rawSellerName ?? "—";
    const row = map.get(key) ?? {
      sellerId: line.canonicalSellerId,
      sellerName: line.canonicalSellerName ?? line.rawSellerName,
      receivableCount: 0,
      receivedAmount: 0,
      commissionableBase: 0,
      expectedCommission: 0,
      releasedCommission: 0,
      exceptionCount: 0,
    };
    row.receivedAmount = round2(row.receivedAmount + line.receivedAmount);
    if (line.status === "COMMISSIONABLE") {
      row.commissionableBase = round2(row.commissionableBase + line.commissionableBaseAmount);
      row.expectedCommission = round2(row.expectedCommission + line.expectedCommissionAmount);
      row.releasedCommission = round2(row.releasedCommission + line.releasedCommissionAmount);
    } else {
      row.exceptionCount += 1;
    }
    if (line.nomusReceivableId != null) row.receivableCount += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.sellerName ?? "").localeCompare(b.sellerName ?? "", "pt-BR"));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildReceiptClosingPageFromPreview(input: {
  preview: CommissionReceiptPreviewResult;
  closing: ReceiptClosingSnapshot | null;
  canApply: boolean;
  applyBlockedReason: string | null;
}): ReceiptClosingPagePayload {
  const lines = input.preview.lines.map(mapPreviewLineToApiLine);
  return {
    year: input.preview.year,
    month: input.preview.month,
    mode: "PREVIEW",
    exportMode: "PREVIEW",
    closing: input.closing,
    canApply: input.canApply,
    applyBlockedReason: input.applyBlockedReason,
    summary: {
      totalReceivables: input.preview.totalReceivables,
      totalReceivedAmount: input.preview.totalReceivedAmount,
      totalCommissionableBase: input.preview.totalCommissionableBase,
      totalExpectedCommission: input.preview.totalExpectedCommission,
      totalReleasedCommission: input.preview.totalReleasedCommission,
      totalExcludedAmount: input.preview.totalExcludedAmount,
      totalExceptionAmount: input.preview.totalExceptionAmount,
      countByStatus: input.preview.countByStatus,
    },
    bySeller: buildReceiptClosingBySeller(lines),
    lines,
  };
}

export function buildReceiptClosingPageFromLedger(input: {
  closing: ReceiptClosingSnapshot;
  ledgerLines: ReceiptClosingLedgerLineSnapshot[];
}): ReceiptClosingPagePayload {
  const lines = input.ledgerLines.map((line) => mapLedgerLineToApiLine(line, input.closing));
  return {
    year: input.closing.year,
    month: input.closing.month,
    mode: "CLOSED",
    exportMode: "CLOSED",
    closing: input.closing,
    canApply: false,
    applyBlockedReason: "Fechamento já aplicado — use reprocessamento controlado.",
    summary: {
      totalReceivables: input.closing.lineCount,
      totalReceivedAmount: input.closing.totalReceivedAmount,
      totalCommissionableBase: input.closing.totalCommissionableBase,
      totalExpectedCommission: input.closing.totalExpectedCommission,
      totalReleasedCommission: input.closing.totalReleasedCommission,
      totalExcludedAmount: input.closing.totalExcludedAmount,
      totalExceptionAmount: input.closing.totalExceptionAmount,
      countByStatus: countStatuses(lines),
    },
    bySeller: buildReceiptClosingBySeller(lines),
    lines,
  };
}

export function buildReceiptClosingPageEmpty(year: number, month: number): ReceiptClosingPagePayload {
  return {
    year,
    month,
    mode: "EMPTY",
    exportMode: "NONE",
    closing: null,
    canApply: true,
    applyBlockedReason: null,
    summary: {
      totalReceivables: 0,
      totalReceivedAmount: 0,
      totalCommissionableBase: 0,
      totalExpectedCommission: 0,
      totalReleasedCommission: 0,
      totalExcludedAmount: 0,
      totalExceptionAmount: 0,
      countByStatus: {},
    },
    bySeller: [],
    lines: [],
  };
}

function countStatuses(lines: ReceiptClosingApiLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    counts[line.status] = (counts[line.status] ?? 0) + 1;
  }
  return counts;
}

export function buildReceiptClosingExportCsv(input: {
  year: number;
  month: number;
  closing: ReceiptClosingSnapshot | null;
  exportMode: "PREVIEW" | "CLOSED";
  lines: ReceiptClosingApiLine[];
  calculationHash?: string | null;
}): string {
  const header = RECEIPT_CLOSING_EXPORT_HEADERS.join(",");
  const closingStatus = input.closing?.status ?? "NONE";
  const closingId = input.closing?.closingId ?? "";
  const hash = input.calculationHash ?? input.closing?.calculationHash ?? "";

  const rows = input.lines.map((line) =>
    [
      input.year,
      input.month,
      closingId,
      closingStatus,
      input.exportMode,
      line.nomusReceivableId ?? "",
      line.receivableNumber ?? "",
      line.installmentNumber ?? "",
      line.dueDate?.slice(0, 10) ?? "",
      line.settlementDate?.slice(0, 10) ?? "",
      line.customerId ?? line.customerExternalId ?? "",
      line.customerName ?? "",
      line.localOrderId ?? "",
      line.orderCode ?? "",
      line.nomusNfeId ?? "",
      line.nfeNumber ?? "",
      line.nomusOrderItemId ?? line.localItemId ?? "",
      line.productName ?? line.productCode ?? "",
      line.rawSellerId ?? "",
      line.rawSellerName ?? "",
      line.canonicalSellerId ?? "",
      line.canonicalSellerName ?? "",
      line.sellerResolutionStatus ?? "",
      line.receivedAmount.toFixed(2),
      line.commissionableBaseAmount.toFixed(2),
      line.ratePercent.toFixed(4),
      line.expectedCommissionAmount.toFixed(2),
      line.releasedCommissionAmount.toFixed(2),
      line.ruleId ?? "",
      line.ruleName ?? "",
      line.exclusionReason ?? "",
      line.status,
      line.statusReason ?? "",
      hash || line.lineKey,
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return [`# exportMode=${input.exportMode}`, `# calculationHash=${hash}`, header, ...rows].join("\n");
}
