/**
 * Payload e export CSV da API de fechamento por recebimento — lógica pura.
 */
import { roundMoney } from "./commission-money.js";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import {
  buildNomusReceiptReconciliationReport,
  detectDuplicateReceived,
  type NomusReceiptReconciliationReport,
} from "./commissionNomusReceiptReconciliation.js";
import {
  CRITICAL_NOMUS_COMMISSION_DIFF,
  CRITICAL_NOMUS_COMMISSION_DIFF_PERCENT,
} from "./commissionMonthlyClosingWorkflow.js";
import type {
  ReceiptClosingLedgerLineSnapshot,
  ReceiptClosingSnapshot,
} from "./commissionReceiptClosing.js";

export type ReceiptClosingPageMode = "EMPTY" | "PREVIEW" | "CLOSED";

export type ReceiptClosingMaterializationCards = {
  totalReceivedAmount: number;
  receivedWithScheduleAmount: number;
  receivedExcludedCustomerAmount: number;
  receivedWithoutScheduleAmount: number;
  commissionableBaseAmount: number;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  finalCommissionAmount: number;
  nomusCommissionDiff: number | null;
  nomusDiffExplanation: string | null;
  reportStatus: "PREVIEW" | "CLOSED";
};

export type ReceiptClosingReconciliationSummary = {
  nomusBase: number | null;
  nomusCommission: number | null;
  diffCommissionFinal: number | null;
  diffCommissionBeforeExclusions: number | null;
  diffExplanation: string | null;
  excludedCustomerCount: number;
  receivablesWithoutScheduleCount: number;
  staleScheduleCount: number;
  divergentReceivableCount: number;
  duplicateReceivedCount: number;
  comparable: boolean;
};

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
  /** Valor recebido exibido na linha — zero em linhas duplicadas do mesmo título. */
  uniqueReceivedAmount: number;
  commissionableBaseAmount: number;
  ratePercent: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  grossCommissionAmount: number;
  scheduledCommissionAmount: number | null;
  commissionReceivableScheduleId: string | null;
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
  grossCommission: number;
  excludedCommission: number;
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
  criticalDivergence: boolean;
  criticalDivergenceReason: string | null;
  requiresCriticalConfirmation: boolean;
  cards: ReceiptClosingMaterializationCards;
  reconciliation: ReceiptClosingReconciliationSummary;
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
  "uniqueReceivedAmount",
  "allocatedCommercialBase",
  "commissionRatePercent",
  "scheduledCommissionAmount",
  "grossCommissionAmount",
  "expectedCommissionAmount",
  "releasedCommissionAmount",
  "scheduleId",
  "ruleId",
  "ruleNameSnapshot",
  "exclusionReason",
  "lineStatus",
  "exceptionReason",
  "calculationHash",
] as const;

const DIVERGENT_STATUSES = new Set([
  "NO_SALES_LINK",
  "NO_SCHEDULE",
  "NO_SELLER",
  "SELLER_UNRESOLVED",
  "NO_RULE",
  "STALE_SCHEDULE",
  "ERROR",
  "ZERO_AMOUNT",
]);

const SCHEDULE_SOURCES = new Set(["MATERIALIZED_SCHEDULE", "PERSISTED_SCHEDULE"]);

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function round2(n: number): number {
  return roundMoney(n);
}

function lineGrossCommissionApi(line: ReceiptClosingApiLine): number {
  if (line.grossCommissionAmount > 0) return round2(line.grossCommissionAmount);
  if (line.status === "COMMISSIONABLE") return round2(line.releasedCommissionAmount);
  return 0;
}

type ReceivableBucket = "CUSTOMER_EXCLUDED" | "NO_SCHEDULE" | "WITH_SCHEDULE" | "OTHER";

function classifyReceivableBucket(line: ReceiptClosingApiLine): ReceivableBucket {
  if (line.status === "CUSTOMER_EXCLUDED") return "CUSTOMER_EXCLUDED";
  if (line.status === "NO_SCHEDULE" || line.status === "STALE_SCHEDULE") return "NO_SCHEDULE";
  if (
    line.status === "COMMISSIONABLE" &&
    (SCHEDULE_SOURCES.has(line.source) || line.commissionReceivableScheduleId != null)
  ) {
    return "WITH_SCHEDULE";
  }
  return "OTHER";
}

function receivableBucketForGroup(lines: ReceiptClosingApiLine[]): ReceivableBucket {
  const priority: ReceivableBucket[] = [
    "CUSTOMER_EXCLUDED",
    "NO_SCHEDULE",
    "WITH_SCHEDULE",
    "OTHER",
  ];
  const buckets = new Set(lines.map(classifyReceivableBucket));
  for (const bucket of priority) {
    if (buckets.has(bucket)) return bucket;
  }
  return "OTHER";
}

function sumUniqueReceivableReceived(
  lines: ReceiptClosingApiLine[],
  predicate: (line: ReceiptClosingApiLine) => boolean
): number {
  const byReceivable = new Map<number, ReceiptClosingApiLine[]>();
  for (const line of lines) {
    if (line.nomusReceivableId == null || !predicate(line)) continue;
    const group = byReceivable.get(line.nomusReceivableId) ?? [];
    group.push(line);
    byReceivable.set(line.nomusReceivableId, group);
  }
  let total = 0;
  for (const group of byReceivable.values()) {
    total = round2(total + (group[0]?.receivedAmount ?? 0));
  }
  return total;
}

export function markReceivableReceivedAnchors(
  lines: ReceiptClosingApiLine[]
): ReceiptClosingApiLine[] {
  const seen = new Set<number>();
  return lines.map((line) => {
    if (line.nomusReceivableId == null) {
      return { ...line, uniqueReceivedAmount: line.receivedAmount };
    }
    if (seen.has(line.nomusReceivableId)) {
      return { ...line, uniqueReceivedAmount: 0 };
    }
    seen.add(line.nomusReceivableId);
    return { ...line, uniqueReceivedAmount: line.receivedAmount };
  });
}

export function buildReceiptClosingMaterializationCards(
  lines: ReceiptClosingApiLine[],
  reportStatus: "PREVIEW" | "CLOSED",
  reconciliation: ReceiptClosingReconciliationSummary
): ReceiptClosingMaterializationCards {
  const byReceivable = new Map<number, ReceiptClosingApiLine[]>();
  for (const line of lines) {
    if (line.nomusReceivableId == null) continue;
    const group = byReceivable.get(line.nomusReceivableId) ?? [];
    group.push(line);
    byReceivable.set(line.nomusReceivableId, group);
  }

  let receivedWithScheduleAmount = 0;
  let receivedExcludedCustomerAmount = 0;
  let receivedWithoutScheduleAmount = 0;

  for (const group of byReceivable.values()) {
    const amount = group[0]?.receivedAmount ?? 0;
    const bucket = receivableBucketForGroup(group);
    if (bucket === "WITH_SCHEDULE") receivedWithScheduleAmount = round2(receivedWithScheduleAmount + amount);
    else if (bucket === "CUSTOMER_EXCLUDED") {
      receivedExcludedCustomerAmount = round2(receivedExcludedCustomerAmount + amount);
    } else if (bucket === "NO_SCHEDULE") {
      receivedWithoutScheduleAmount = round2(receivedWithoutScheduleAmount + amount);
    }
  }

  const totalReceivedAmount = sumUniqueReceivableReceived(lines, () => true);

  let commissionableBaseAmount = 0;
  let grossCommissionAmount = 0;
  let excludedCommissionAmount = 0;
  let finalCommissionAmount = 0;

  for (const line of lines) {
    if (line.status === "COMMISSIONABLE") {
      commissionableBaseAmount = round2(commissionableBaseAmount + line.commissionableBaseAmount);
      grossCommissionAmount = round2(grossCommissionAmount + lineGrossCommissionApi(line));
      finalCommissionAmount = round2(finalCommissionAmount + line.releasedCommissionAmount);
    } else if (line.status === "CUSTOMER_EXCLUDED") {
      excludedCommissionAmount = round2(excludedCommissionAmount + lineGrossCommissionApi(line));
      grossCommissionAmount = round2(grossCommissionAmount + lineGrossCommissionApi(line));
    }
  }

  return {
    totalReceivedAmount,
    receivedWithScheduleAmount,
    receivedExcludedCustomerAmount,
    receivedWithoutScheduleAmount,
    commissionableBaseAmount,
    grossCommissionAmount,
    excludedCommissionAmount,
    finalCommissionAmount,
    nomusCommissionDiff: reconciliation.diffCommissionFinal,
    nomusDiffExplanation: reconciliation.diffExplanation,
    reportStatus,
  };
}

function buildNomusDiffExplanation(report: NomusReceiptReconciliationReport): string | null {
  if (report.nomusCommission == null && report.nomusBase == null) return null;
  const parts: string[] = [];
  if (report.diffCommissionFinal != null && Math.abs(report.diffCommissionFinal) > 0.005) {
    parts.push(
      `Comissão final IndusCost ${report.indusCostFinalCommission.toFixed(2)} vs Nomus ${report.nomusCommission?.toFixed(2) ?? "—"} (Δ ${report.diffCommissionFinal.toFixed(2)}).`
    );
  }
  if (report.excludedCommissionTotal > 0) {
    parts.push(
      `Exclusões de cliente: ${report.excludedCustomers.length} cliente(s), comissão excluída R$ ${report.excludedCommissionTotal.toFixed(2)}.`
    );
  }
  if (report.receivablesWithoutSchedule.length > 0) {
    parts.push(`${report.receivablesWithoutSchedule.length} título(s) sem schedule materializado.`);
  }
  if (report.staleSchedules.length > 0) {
    parts.push(`${report.staleSchedules.length} título(s) com schedule desatualizado.`);
  }
  if (report.divergentReceivableCodes.length > 0) {
    parts.push(`${report.divergentReceivableCodes.length} título(s) com status divergente.`);
  }
  if (report.duplicateReceived.length > 0) {
    parts.push(`${report.duplicateReceived.length} título(s) com recebido duplicado nas linhas.`);
  }
  if (parts.length === 0) {
    if (report.nomusCommission != null) return "Totais conferem com o relatório Nomus informado.";
    return null;
  }
  return parts.join(" ");
}

export function summarizeNomusReceiptReconciliation(
  report: NomusReceiptReconciliationReport
): ReceiptClosingReconciliationSummary {
  const comparable =
    report.nomusCommission != null &&
    (report.diffCommissionFinal != null || report.diffCommissionBeforeExclusions != null);
  const diff =
    report.diffCommissionFinal ?? report.diffCommissionBeforeExclusions ?? null;
  const hasDiff = diff != null && Math.abs(diff) > 0.005;
  return {
    nomusBase: report.nomusBase,
    nomusCommission: report.nomusCommission,
    diffCommissionFinal: report.diffCommissionFinal,
    diffCommissionBeforeExclusions: report.diffCommissionBeforeExclusions,
    diffExplanation: hasDiff || report.nomusCommission != null ? buildNomusDiffExplanation(report) : null,
    excludedCustomerCount: report.excludedCustomers.length,
    receivablesWithoutScheduleCount: report.receivablesWithoutSchedule.length,
    staleScheduleCount: report.staleSchedules.length,
    divergentReceivableCount: report.divergentReceivableCodes.length,
    duplicateReceivedCount: report.duplicateReceived.length,
    comparable,
  };
}

function detectDuplicateReceivedFromApiLines(
  lines: ReceiptClosingApiLine[]
): ReturnType<typeof detectDuplicateReceived> {
  const previewLike = lines.map(
    (line) =>
      ({
        nomusReceivableId: line.nomusReceivableId ?? 0,
        receivableNumber: line.receivableNumber,
        receivedAmount: line.receivedAmount,
      }) as CommissionReceiptPreviewLine
  );
  return detectDuplicateReceived(previewLike);
}

export function buildReceiptClosingReconciliationFromApiLines(input: {
  lines: ReceiptClosingApiLine[];
  nomusBase: number | null;
  nomusCommission: number | null;
}): ReceiptClosingReconciliationSummary {
  const commissionable = input.lines.filter((line) => line.status === "COMMISSIONABLE");
  const excluded = input.lines.filter((line) => line.status === "CUSTOMER_EXCLUDED");
  const finalCommission = round2(
    commissionable.reduce((sum, line) => round2(sum + line.releasedCommissionAmount), 0)
  );
  const excludedCommission = round2(
    excluded.reduce((sum, line) => round2(sum + lineGrossCommissionApi(line)), 0)
  );
  const diffCommissionFinal =
    input.nomusCommission != null ? round2(finalCommission - input.nomusCommission) : null;

  const seenNoSchedule = new Set<number>();
  let receivablesWithoutScheduleCount = 0;
  const seenStale = new Set<number>();
  let staleScheduleCount = 0;
  const seenDivergent = new Set<number>();
  let divergentReceivableCount = 0;

  for (const line of input.lines) {
    if (line.nomusReceivableId == null) continue;
    if (line.status === "NO_SCHEDULE" && !seenNoSchedule.has(line.nomusReceivableId)) {
      seenNoSchedule.add(line.nomusReceivableId);
      receivablesWithoutScheduleCount += 1;
    }
    if (line.status === "STALE_SCHEDULE" && !seenStale.has(line.nomusReceivableId)) {
      seenStale.add(line.nomusReceivableId);
      staleScheduleCount += 1;
    }
    if (DIVERGENT_STATUSES.has(line.status) && !seenDivergent.has(line.nomusReceivableId)) {
      seenDivergent.add(line.nomusReceivableId);
      divergentReceivableCount += 1;
    }
  }

  const duplicateReceivedCount = detectDuplicateReceivedFromApiLines(input.lines).length;
  const excludedCustomerIds = new Set(
    excluded.map((line) => line.customerId ?? String(line.customerExternalId ?? line.customerName ?? ""))
  );

  const parts: string[] = [];
  if (diffCommissionFinal != null && Math.abs(diffCommissionFinal) > 0.005) {
    parts.push(
      `Comissão final ledger ${finalCommission.toFixed(2)} vs Nomus ${input.nomusCommission?.toFixed(2) ?? "—"} (Δ ${diffCommissionFinal.toFixed(2)}).`
    );
  }
  if (excludedCommission > 0) {
    parts.push(
      `Exclusões de cliente: ${excludedCustomerIds.size} cliente(s), comissão excluída R$ ${excludedCommission.toFixed(2)}.`
    );
  }
  if (receivablesWithoutScheduleCount > 0) {
    parts.push(`${receivablesWithoutScheduleCount} título(s) sem schedule.`);
  }
  if (staleScheduleCount > 0) parts.push(`${staleScheduleCount} título(s) com schedule desatualizado.`);
  if (divergentReceivableCount > 0) {
    parts.push(`${divergentReceivableCount} título(s) com status divergente.`);
  }
  if (duplicateReceivedCount > 0) {
    parts.push(`${duplicateReceivedCount} título(s) com recebido duplicado nas linhas.`);
  }

  return {
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
    diffCommissionFinal,
    diffCommissionBeforeExclusions: null,
    diffExplanation:
      input.nomusCommission != null
        ? parts.length > 0
          ? parts.join(" ")
          : "Totais conferem com o relatório Nomus informado."
        : null,
    excludedCustomerCount: excludedCustomerIds.size,
    receivablesWithoutScheduleCount,
    staleScheduleCount,
    divergentReceivableCount,
    duplicateReceivedCount,
    comparable: input.nomusCommission != null,
  };
}

export function isCriticalReceiptClosingDivergence(input: {
  reconciliation: ReceiptClosingReconciliationSummary;
}): boolean {
  const { reconciliation } = input;
  if (reconciliation.duplicateReceivedCount > 0) return true;
  if (reconciliation.divergentReceivableCount > 0) return true;
  if (reconciliation.receivablesWithoutScheduleCount > 0) return true;
  if (reconciliation.staleScheduleCount > 0) return true;
  if (!reconciliation.comparable) return false;
  const diff = reconciliation.diffCommissionFinal ?? reconciliation.diffCommissionBeforeExclusions;
  if (diff == null) return false;
  if (Math.abs(diff) > CRITICAL_NOMUS_COMMISSION_DIFF) return true;
  if (
    reconciliation.nomusCommission != null &&
    reconciliation.nomusCommission > 0 &&
    Math.abs((diff / reconciliation.nomusCommission) * 100) > CRITICAL_NOMUS_COMMISSION_DIFF_PERCENT
  ) {
    return true;
  }
  return false;
}

export function assessReceiptClosingCriticalDivergence(input: {
  reconciliation: ReceiptClosingReconciliationSummary;
}): {
  criticalDivergence: boolean;
  criticalDivergenceReason: string | null;
  requiresCriticalConfirmation: boolean;
} {
  const critical = isCriticalReceiptClosingDivergence(input);
  if (!critical) {
    return {
      criticalDivergence: false,
      criticalDivergenceReason: null,
      requiresCriticalConfirmation: false,
    };
  }
  const reasons: string[] = [];
  const r = input.reconciliation;
  if (r.duplicateReceivedCount > 0) {
    reasons.push(`${r.duplicateReceivedCount} título(s) com recebido duplicado`);
  }
  if (r.receivablesWithoutScheduleCount > 0) {
    reasons.push(`${r.receivablesWithoutScheduleCount} título(s) sem schedule`);
  }
  if (r.staleScheduleCount > 0) {
    reasons.push(`${r.staleScheduleCount} título(s) com schedule desatualizado`);
  }
  if (r.divergentReceivableCount > 0) {
    reasons.push(`${r.divergentReceivableCount} título(s) divergentes`);
  }
  const diff = r.diffCommissionFinal ?? r.diffCommissionBeforeExclusions;
  if (r.comparable && diff != null && Math.abs(diff) > CRITICAL_NOMUS_COMMISSION_DIFF) {
    reasons.push(`diferença Nomus de R$ ${diff.toFixed(2)}`);
  }
  return {
    criticalDivergence: true,
    criticalDivergenceReason: reasons.join("; ") || "Divergência crítica detectada",
    requiresCriticalConfirmation: true,
  };
}

export function mapPreviewLineToApiLine(line: CommissionReceiptPreviewLine): ReceiptClosingApiLine {
  const scheduledCommissionAmount =
    line.commissionReceivableScheduleId != null
      ? line.grossCommissionAmount > 0
        ? line.grossCommissionAmount
        : line.expectedCommissionAmount
      : null;
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
    uniqueReceivedAmount: line.receivedAmount,
    commissionableBaseAmount: line.commissionableBaseAmount,
    ratePercent: line.ratePercent,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    grossCommissionAmount: line.grossCommissionAmount,
    scheduledCommissionAmount,
    commissionReceivableScheduleId: line.commissionReceivableScheduleId,
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
  _closing: ReceiptClosingSnapshot
): ReceiptClosingApiLine {
  const ruleSnapshot =
    line.ruleSnapshotJson != null && typeof line.ruleSnapshotJson === "object"
      ? (line.ruleSnapshotJson as Record<string, unknown>)
      : null;
  const scheduleId =
    ruleSnapshot?.commissionReceivableScheduleId != null
      ? String(ruleSnapshot.commissionReceivableScheduleId)
      : null;
  const gross =
    line.status === "CUSTOMER_EXCLUDED"
      ? line.expectedCommissionAmount > 0
        ? line.expectedCommissionAmount
        : line.releasedCommissionAmount
      : line.releasedCommissionAmount;
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
    uniqueReceivedAmount: line.receivedAmount,
    commissionableBaseAmount: line.allocatedCommercialBase,
    ratePercent: line.commissionRatePercent,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    grossCommissionAmount: gross,
    scheduledCommissionAmount: scheduleId != null ? line.expectedCommissionAmount : null,
    commissionReceivableScheduleId: scheduleId,
    ruleId: ruleSnapshot?.ruleId != null ? String(ruleSnapshot.ruleId) : null,
    ruleName: line.ruleNameSnapshot,
    exclusionReason: line.exclusionReason,
    status: line.status,
    statusReason: line.exceptionReason ?? line.exclusionReason,
    source: scheduleId != null ? "PERSISTED_SCHEDULE" : "PERSISTED_LEDGER",
  };
}

export function buildReceiptClosingBySeller(
  lines: ReceiptClosingApiLine[]
): ReceiptClosingApiSellerRow[] {
  const map = new Map<
    string,
    ReceiptClosingApiSellerRow & { seenReceivables: Set<number>; seenExceptions: Set<string> }
  >();
  for (const line of lines) {
    const key = line.canonicalSellerId ?? line.canonicalSellerName ?? line.rawSellerName ?? "—";
    const row = map.get(key) ?? {
      sellerId: line.canonicalSellerId,
      sellerName: line.canonicalSellerName ?? line.rawSellerName,
      receivableCount: 0,
      receivedAmount: 0,
      commissionableBase: 0,
      grossCommission: 0,
      excludedCommission: 0,
      expectedCommission: 0,
      releasedCommission: 0,
      exceptionCount: 0,
      seenReceivables: new Set<number>(),
      seenExceptions: new Set<string>(),
    };

    if (line.nomusReceivableId != null) {
      if (!row.seenReceivables.has(line.nomusReceivableId)) {
        row.seenReceivables.add(line.nomusReceivableId);
        row.receivedAmount = round2(row.receivedAmount + line.receivedAmount);
        row.receivableCount += 1;
      }
    } else {
      row.receivedAmount = round2(row.receivedAmount + line.receivedAmount);
    }

    if (line.status === "COMMISSIONABLE") {
      row.commissionableBase = round2(row.commissionableBase + line.commissionableBaseAmount);
      row.grossCommission = round2(row.grossCommission + lineGrossCommissionApi(line));
      row.expectedCommission = round2(row.expectedCommission + line.expectedCommissionAmount);
      row.releasedCommission = round2(row.releasedCommission + line.releasedCommissionAmount);
    } else if (line.status === "CUSTOMER_EXCLUDED") {
      row.excludedCommission = round2(row.excludedCommission + lineGrossCommissionApi(line));
      row.grossCommission = round2(row.grossCommission + lineGrossCommissionApi(line));
    } else {
      const exceptionKey =
        line.nomusReceivableId != null
          ? `${line.nomusReceivableId}|${line.status}`
          : `${line.lineKey}|${line.status}`;
      if (!row.seenExceptions.has(exceptionKey)) {
        row.seenExceptions.add(exceptionKey);
        row.exceptionCount += 1;
      }
    }
    map.set(key, row);
  }
  return [...map.values()]
    .map(({ seenReceivables: _s, seenExceptions: _e, ...row }) => row)
    .sort((a, b) => (a.sellerName ?? "").localeCompare(b.sellerName ?? "", "pt-BR"));
}

function emptyReconciliation(): ReceiptClosingReconciliationSummary {
  return {
    nomusBase: null,
    nomusCommission: null,
    diffCommissionFinal: null,
    diffCommissionBeforeExclusions: null,
    diffExplanation: null,
    excludedCustomerCount: 0,
    receivablesWithoutScheduleCount: 0,
    staleScheduleCount: 0,
    divergentReceivableCount: 0,
    duplicateReceivedCount: 0,
    comparable: false,
  };
}

function emptyCards(reportStatus: "PREVIEW" | "CLOSED"): ReceiptClosingMaterializationCards {
  return {
    totalReceivedAmount: 0,
    receivedWithScheduleAmount: 0,
    receivedExcludedCustomerAmount: 0,
    receivedWithoutScheduleAmount: 0,
    commissionableBaseAmount: 0,
    grossCommissionAmount: 0,
    excludedCommissionAmount: 0,
    finalCommissionAmount: 0,
    nomusCommissionDiff: null,
    nomusDiffExplanation: null,
    reportStatus,
  };
}

export function enrichReceiptClosingPagePayload(
  base: Omit<
    ReceiptClosingPagePayload,
    "cards" | "reconciliation" | "criticalDivergence" | "criticalDivergenceReason" | "requiresCriticalConfirmation"
  >,
  options: {
    previewLines?: CommissionReceiptPreviewLine[];
    nomusBase?: number | null;
    nomusCommission?: number | null;
  } = {}
): ReceiptClosingPagePayload {
  const reportStatus: "PREVIEW" | "CLOSED" = base.exportMode === "CLOSED" ? "CLOSED" : "PREVIEW";
  const lines = markReceivableReceivedAnchors(base.lines);
  const reconciliation =
    options.previewLines != null
      ? summarizeNomusReceiptReconciliation(
          buildNomusReceiptReconciliationReport({
            lines: options.previewLines,
            nomusBase: options.nomusBase ?? null,
            nomusCommission: options.nomusCommission ?? null,
          })
        )
      : buildReceiptClosingReconciliationFromApiLines({
          lines,
          nomusBase: options.nomusBase ?? null,
          nomusCommission: options.nomusCommission ?? null,
        });
  const cards = buildReceiptClosingMaterializationCards(lines, reportStatus, reconciliation);
  const critical = assessReceiptClosingCriticalDivergence({ reconciliation });
  return {
    ...base,
    lines,
    bySeller: buildReceiptClosingBySeller(lines),
    cards,
    reconciliation,
    criticalDivergence: critical.criticalDivergence,
    criticalDivergenceReason: critical.criticalDivergenceReason,
    requiresCriticalConfirmation: critical.requiresCriticalConfirmation,
  };
}

export function buildReceiptClosingPageFromPreview(input: {
  preview: CommissionReceiptPreviewResult;
  closing: ReceiptClosingSnapshot | null;
  canApply: boolean;
  applyBlockedReason: string | null;
  nomusBase?: number | null;
  nomusCommission?: number | null;
}): ReceiptClosingPagePayload {
  const lines = input.preview.lines.map(mapPreviewLineToApiLine);
  const base = {
    year: input.preview.year,
    month: input.preview.month,
    mode: "PREVIEW" as const,
    exportMode: "PREVIEW" as const,
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
  return enrichReceiptClosingPagePayload(base, {
    previewLines: input.preview.lines,
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
  });
}

export function buildReceiptClosingPageFromLedger(input: {
  closing: ReceiptClosingSnapshot;
  ledgerLines: ReceiptClosingLedgerLineSnapshot[];
  nomusBase?: number | null;
  nomusCommission?: number | null;
}): ReceiptClosingPagePayload {
  const lines = input.ledgerLines.map((line) => mapLedgerLineToApiLine(line, input.closing));
  const base = {
    year: input.closing.year,
    month: input.closing.month,
    mode: "CLOSED" as const,
    exportMode: "CLOSED" as const,
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
  return enrichReceiptClosingPagePayload(base, {
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
  });
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
    criticalDivergence: false,
    criticalDivergenceReason: null,
    requiresCriticalConfirmation: false,
    cards: emptyCards("PREVIEW"),
    reconciliation: emptyReconciliation(),
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
  cards?: ReceiptClosingMaterializationCards;
  calculationHash?: string | null;
}): string {
  const header = RECEIPT_CLOSING_EXPORT_HEADERS.join(",");
  const closingStatus = input.closing?.status ?? "NONE";
  const closingId = input.closing?.closingId ?? "";
  const hash = input.calculationHash ?? input.closing?.calculationHash ?? "";

  const cardLines: string[] = [];
  if (input.cards) {
    cardLines.push("# cards");
    cardLines.push(`# totalReceivedAmount,${input.cards.totalReceivedAmount.toFixed(2)}`);
    cardLines.push(`# receivedWithScheduleAmount,${input.cards.receivedWithScheduleAmount.toFixed(2)}`);
    cardLines.push(
      `# receivedExcludedCustomerAmount,${input.cards.receivedExcludedCustomerAmount.toFixed(2)}`
    );
    cardLines.push(
      `# receivedWithoutScheduleAmount,${input.cards.receivedWithoutScheduleAmount.toFixed(2)}`
    );
    cardLines.push(`# commissionableBaseAmount,${input.cards.commissionableBaseAmount.toFixed(2)}`);
    cardLines.push(`# grossCommissionAmount,${input.cards.grossCommissionAmount.toFixed(2)}`);
    cardLines.push(`# excludedCommissionAmount,${input.cards.excludedCommissionAmount.toFixed(2)}`);
    cardLines.push(`# finalCommissionAmount,${input.cards.finalCommissionAmount.toFixed(2)}`);
    if (input.cards.nomusCommissionDiff != null) {
      cardLines.push(`# nomusCommissionDiff,${input.cards.nomusCommissionDiff.toFixed(2)}`);
    }
    cardLines.push(`# reportStatus,${input.cards.reportStatus}`);
    if (input.cards.nomusDiffExplanation) {
      cardLines.push(`# nomusDiffExplanation,${escapeCsvCell(input.cards.nomusDiffExplanation)}`);
    }
  }

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
      line.uniqueReceivedAmount.toFixed(2),
      line.commissionableBaseAmount.toFixed(2),
      line.ratePercent.toFixed(4),
      line.scheduledCommissionAmount?.toFixed(2) ?? "",
      line.grossCommissionAmount.toFixed(2),
      line.expectedCommissionAmount.toFixed(2),
      line.releasedCommissionAmount.toFixed(2),
      line.commissionReceivableScheduleId ?? "",
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

  return [
    `# exportMode=${input.exportMode}`,
    `# calculationHash=${hash}`,
    ...cardLines,
    header,
    ...rows,
  ].join("\n");
}
