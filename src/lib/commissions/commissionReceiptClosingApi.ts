/**
 * Payload e export CSV da API de fechamento por recebimento — lógica pura.
 */
export * from "./commissionReceiptClosingApi.shared.js";

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
} from "./commissionMonthlyClosingWorkflow.shared.js";
import type {
  ReceiptClosingLedgerLineSnapshot,
  ReceiptClosingSnapshot,
} from "./commissionReceiptClosing.js";
import {
  COMMISSION_RECEIPT_MATERIALIZATION_PENDING_MESSAGE,
  isReceiptClosingSellerExcludedFromCommission,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY,
  resolveReceiptClosingSellerGroupKey,
  type ReceiptClosingApiLine,
  type ReceiptClosingApiSellerRow,
  type ReceiptClosingMaterializationCards,
  type ReceiptClosingMaterializationSummary,
  type ReceiptClosingPageMode,
  type ReceiptClosingPagePayload,
  type ReceiptClosingReconciliationSummary,
} from "./commissionReceiptClosingApi.shared.js";

function clearCanonicalSellerForExcludedApiLine(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
}): { canonicalSellerId: string | null; canonicalSellerName: string | null } {
  if (isReceiptClosingSellerExcludedFromCommission(line.status)) {
    return { canonicalSellerId: null, canonicalSellerName: null };
  }
  return {
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
  };
}

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

type ReceivableBucket =
  | "GROUP_COMPANY_EXCLUDED"
  | "CUSTOMER_EXCLUDED"
  | "NO_SCHEDULE"
  | "WITH_SCHEDULE"
  | "OTHER";

function classifyReceivableBucket(line: ReceiptClosingApiLine): ReceivableBucket {
  if (line.status === "GROUP_COMPANY_EXCLUDED") return "GROUP_COMPANY_EXCLUDED";
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
    "GROUP_COMPANY_EXCLUDED",
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

const SELLER_UNRESOLVED_STATUSES = new Set(["SELLER_UNRESOLVED", "NO_SELLER"]);

function countUniqueReceivablesByBucket(
  lines: ReceiptClosingApiLine[],
  bucket: ReceivableBucket
): number {
  const seen = new Set<number>();
  const byReceivable = new Map<number, ReceiptClosingApiLine[]>();
  for (const line of lines) {
    if (line.nomusReceivableId == null) continue;
    const group = byReceivable.get(line.nomusReceivableId) ?? [];
    group.push(line);
    byReceivable.set(line.nomusReceivableId, group);
  }
  for (const [id, group] of byReceivable) {
    if (receivableBucketForGroup(group) === bucket && !seen.has(id)) {
      seen.add(id);
    }
  }
  return seen.size;
}

function countReceivablesWithMaterializedSchedule(lines: ReceiptClosingApiLine[]): number {
  const seen = new Set<number>();
  for (const line of lines) {
    if (line.nomusReceivableId == null) continue;
    if (line.status === "NO_SCHEDULE" || line.status === "STALE_SCHEDULE") continue;
    if (
      line.commissionReceivableScheduleId != null ||
      SCHEDULE_SOURCES.has(line.source)
    ) {
      seen.add(line.nomusReceivableId);
    }
  }
  return seen.size;
}

function countUniqueReceivablesWithStatus(
  lines: ReceiptClosingApiLine[],
  statuses: Set<string>
): number {
  const seen = new Set<number>();
  for (const line of lines) {
    if (line.nomusReceivableId == null || !statuses.has(line.status)) continue;
    seen.add(line.nomusReceivableId);
  }
  return seen.size;
}

export function buildReceiptClosingMaterializationSummary(input: {
  lines: ReceiptClosingApiLine[];
  reconciliation: ReceiptClosingReconciliationSummary;
  year: number;
  month: number;
  totalReceivedAmount: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
}): ReceiptClosingMaterializationSummary {
  const uniqueReceivableIds = new Set<number>();
  for (const line of input.lines) {
    if (line.nomusReceivableId != null) uniqueReceivableIds.add(line.nomusReceivableId);
  }

  const receivablesWithScheduleCount = countReceivablesWithMaterializedSchedule(input.lines);
  const receivablesWithoutScheduleCount = countUniqueReceivablesByBucket(input.lines, "NO_SCHEDULE");
  const groupCompanyExcludedCount = countUniqueReceivablesByBucket(
    input.lines,
    "GROUP_COMPANY_EXCLUDED"
  );
  const groupCompanyExcludedReceivedAmount = sumUniqueReceivableReceived(
    input.lines,
    (line) => line.status === "GROUP_COMPANY_EXCLUDED"
  );
  const sellerUnresolvedCount = countUniqueReceivablesWithStatus(
    input.lines,
    SELLER_UNRESOLVED_STATUSES
  );

  const pendingMaterialization =
    receivablesWithoutScheduleCount > 0 || input.reconciliation.staleScheduleCount > 0;

  return {
    totalReceivablesCount: uniqueReceivableIds.size,
    receivablesWithScheduleCount,
    receivablesWithoutScheduleCount,
    excludedCustomerCount: input.reconciliation.excludedCustomerCount,
    groupCompanyExcludedCount,
    groupCompanyExcludedReceivedAmount,
    sellerUnresolvedCount,
    staleScheduleCount: input.reconciliation.staleScheduleCount,
    totalReceivedAmount: round2(input.totalReceivedAmount),
    totalExpectedCommission: round2(input.totalExpectedCommission),
    totalReleasedCommission: round2(input.totalReleasedCommission),
    pendingMaterialization,
    pendingMaterializationMessage: pendingMaterialization
      ? COMMISSION_RECEIPT_MATERIALIZATION_PENDING_MESSAGE
      : null,
    rebuildScriptHint: pendingMaterialization
      ? `npx tsx scripts/rebuild-commission-materialization.ts --year=${input.year} --month=${input.month} --preview`
      : null,
  };
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
  let receivedGroupCompanyExcludedAmount = 0;
  let receivedWithoutScheduleAmount = 0;

  for (const group of byReceivable.values()) {
    const amount = group[0]?.receivedAmount ?? 0;
    const bucket = receivableBucketForGroup(group);
    if (bucket === "WITH_SCHEDULE") receivedWithScheduleAmount = round2(receivedWithScheduleAmount + amount);
    else if (bucket === "GROUP_COMPANY_EXCLUDED") {
      receivedGroupCompanyExcludedAmount = round2(receivedGroupCompanyExcludedAmount + amount);
    } else if (bucket === "CUSTOMER_EXCLUDED") {
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
    receivedGroupCompanyExcludedAmount,
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
    groupCompanyExcludedCount: report.groupCompanyExcludedReceivables.length,
    groupCompanyExcludedReceivedAmount: report.groupCompanyExcludedReceivedTotal,
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
  const seenGroupCompany = new Set<number>();
  let groupCompanyExcludedCount = 0;
  let groupCompanyExcludedReceivedAmount = 0;
  for (const line of input.lines) {
    if (line.nomusReceivableId == null || line.status !== "GROUP_COMPANY_EXCLUDED") continue;
    if (!seenGroupCompany.has(line.nomusReceivableId)) {
      seenGroupCompany.add(line.nomusReceivableId);
      groupCompanyExcludedCount += 1;
      groupCompanyExcludedReceivedAmount = round2(
        groupCompanyExcludedReceivedAmount + line.receivedAmount
      );
    }
  }

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
  if (groupCompanyExcludedReceivedAmount > 0) {
    parts.push(
      `Empresas do grupo excluídas: ${groupCompanyExcludedCount} título(s), recebido R$ ${groupCompanyExcludedReceivedAmount.toFixed(2)}.`
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
    groupCompanyExcludedCount,
    groupCompanyExcludedReceivedAmount,
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
  const canonicalSeller = clearCanonicalSellerForExcludedApiLine(line);
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
    canonicalSellerId: canonicalSeller.canonicalSellerId,
    canonicalSellerName: canonicalSeller.canonicalSellerName,
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
  const canonicalSeller = clearCanonicalSellerForExcludedApiLine(line);
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
    canonicalSellerId: canonicalSeller.canonicalSellerId,
    canonicalSellerName: canonicalSeller.canonicalSellerName,
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
    const key = resolveReceiptClosingSellerGroupKey(line);
    const isUnassignedBucket = key === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
    const row = map.get(key) ?? {
      sellerId: isUnassignedBucket ? null : line.canonicalSellerId,
      sellerName: isUnassignedBucket ? null : (line.canonicalSellerName ?? line.rawSellerName),
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
    groupCompanyExcludedCount: 0,
    groupCompanyExcludedReceivedAmount: 0,
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
    receivedGroupCompanyExcludedAmount: 0,
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

function emptyMaterializationSummary(): ReceiptClosingMaterializationSummary {
  return {
    totalReceivablesCount: 0,
    receivablesWithScheduleCount: 0,
    receivablesWithoutScheduleCount: 0,
    excludedCustomerCount: 0,
    groupCompanyExcludedCount: 0,
    groupCompanyExcludedReceivedAmount: 0,
    sellerUnresolvedCount: 0,
    staleScheduleCount: 0,
    totalReceivedAmount: 0,
    totalExpectedCommission: 0,
    totalReleasedCommission: 0,
    pendingMaterialization: false,
    pendingMaterializationMessage: null,
    rebuildScriptHint: null,
  };
}

export function enrichReceiptClosingPagePayload(
  base: Omit<
    ReceiptClosingPagePayload,
    | "cards"
    | "materializationSummary"
    | "reconciliation"
    | "criticalDivergence"
    | "criticalDivergenceReason"
    | "requiresCriticalConfirmation"
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
  const materializationSummary = buildReceiptClosingMaterializationSummary({
    lines,
    reconciliation,
    year: base.year,
    month: base.month,
    totalReceivedAmount: base.summary.totalReceivedAmount,
    totalExpectedCommission: base.summary.totalExpectedCommission,
    totalReleasedCommission: base.summary.totalReleasedCommission,
  });
  const critical = assessReceiptClosingCriticalDivergence({ reconciliation });
  return {
    ...base,
    lines,
    bySeller: buildReceiptClosingBySeller(lines),
    cards,
    materializationSummary,
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
    materializationSummary: emptyMaterializationSummary(),
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
  materializationSummary?: ReceiptClosingMaterializationSummary;
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
      `# receivedGroupCompanyExcludedAmount,${input.cards.receivedGroupCompanyExcludedAmount.toFixed(2)}`
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
  if (input.materializationSummary) {
    const m = input.materializationSummary;
    cardLines.push("# materializationSummary");
    cardLines.push(`# totalReceivablesCount,${m.totalReceivablesCount}`);
    cardLines.push(`# receivablesWithScheduleCount,${m.receivablesWithScheduleCount}`);
    cardLines.push(`# receivablesWithoutScheduleCount,${m.receivablesWithoutScheduleCount}`);
    cardLines.push(`# excludedCustomerCount,${m.excludedCustomerCount}`);
    cardLines.push(`# groupCompanyExcludedCount,${m.groupCompanyExcludedCount}`);
    cardLines.push(
      `# groupCompanyExcludedReceivedAmount,${m.groupCompanyExcludedReceivedAmount.toFixed(2)}`
    );
    cardLines.push(`# sellerUnresolvedCount,${m.sellerUnresolvedCount}`);
    cardLines.push(`# staleScheduleCount,${m.staleScheduleCount}`);
    cardLines.push(`# totalExpectedCommission,${m.totalExpectedCommission.toFixed(2)}`);
    cardLines.push(`# totalReleasedCommission,${m.totalReleasedCommission.toFixed(2)}`);
    if (m.pendingMaterializationMessage) {
      cardLines.push(
        `# pendingMaterializationMessage,${escapeCsvCell(m.pendingMaterializationMessage)}`
      );
    }
    if (m.rebuildScriptHint) {
      cardLines.push(`# rebuildScriptHint,${escapeCsvCell(m.rebuildScriptHint)}`);
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
