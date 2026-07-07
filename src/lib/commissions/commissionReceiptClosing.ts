/**
 * Fechamento mensal de comissão por recebimento — lógica pura (sem Prisma).
 */
import type { Prisma } from "@prisma/client";
import { roundMoney } from "./commission-money.js";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import { COMMISSION_RECEIPT_EXCEPTION_STATUSES } from "./commissionReceiptEngine.js";
import {
  buildCommissionMonthlyClosingHash,
  buildPersistedCommissionReceiptLedgerLineKey,
  COMMISSION_MONTHLY_CLOSING_LOCKING_STATUSES,
  normalizeCommissionLedgerMoney,
  type CommissionMonthlyClosingSource,
  type CommissionMonthlyClosingStatus,
  type CommissionReceiptLedgerLineStatus,
} from "./commissionReceiptLedger.js";
import type {
  CommissionMonthlyPayableDetailLine,
  CommissionMonthlyPayableQuery,
  CommissionMonthlyPayableSummary,
} from "./commissionMonthlyPayable.js";
import { buildMonthKey, formatMonthLabelPt } from "./commissionMonthlyPayable.js";

export const RECEIPT_CLOSING_SOURCE: CommissionMonthlyClosingSource = "RECEIPT_BASED";

export const RECEIPT_CLOSING_CONFIRM_APPLY = "FECHAR COMISSAO";
export const RECEIPT_CLOSING_CONFIRM_REPROCESS = "REPROCESSAR COMISSAO";

export type ReceiptClosingSnapshot = {
  closingId: string;
  year: number;
  month: number;
  status: CommissionMonthlyClosingStatus;
  calculationHash: string | null;
  totalReceivedAmount: number;
  totalCommissionableBase: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  totalExcludedAmount: number;
  totalExceptionAmount: number;
  lineCount: number;
  closedAt: string | null;
  closedBy: string | null;
  notes: string | null;
};

export type ReceiptClosingLedgerLineSnapshot = {
  id: string;
  ledgerLineKey: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  receivedAmount: number;
  allocatedCommercialBase: number;
  commissionRatePercent: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  status: CommissionReceiptLedgerLineStatus;
  exceptionReason: string | null;
  exclusionReason: string | null;
  ruleNameSnapshot: string | null;
  ruleSnapshotJson: unknown;
};

export type ReceiptClosingPreviewPayload = {
  preview: CommissionReceiptPreviewResult;
  existingClosing: ReceiptClosingSnapshot | null;
  canApply: boolean;
  applyBlockedReason: string | null;
};

export type ReceiptClosingApplyResult = {
  closingId: string;
  calculationHash: string;
  summary: ReceiptClosingSnapshot;
  lineCount: number;
};

export type ReceiptClosingReprocessDiff = {
  receivedAmountDiff: number;
  commissionableBaseDiff: number;
  expectedCommissionDiff: number;
  releasedCommissionDiff: number;
  lineCountDiff: number;
  addedLines: number;
  removedLines: number;
  changedLines: number;
  hashChanged: boolean;
  beforeHash: string | null;
  afterHash: string;
};

export type ReceiptClosingReprocessPreview = {
  existingClosing: ReceiptClosingSnapshot;
  preview: CommissionReceiptPreviewResult;
  before: ReceiptClosingSnapshot;
  afterTotals: Pick<
    ReceiptClosingSnapshot,
    | "totalReceivedAmount"
    | "totalCommissionableBase"
    | "totalExpectedCommission"
    | "totalReleasedCommission"
    | "totalExcludedAmount"
    | "totalExceptionAmount"
    | "lineCount"
    | "calculationHash"
  >;
  diff: ReceiptClosingReprocessDiff;
};

export class ReceiptClosingDuplicateError extends Error {
  readonly code = "RECEIPT_CLOSING_DUPLICATE";
  readonly existingClosingId: string;

  constructor(existingClosingId: string, message?: string) {
    super(message ?? `Já existe fechamento CLOSED para o período (id=${existingClosingId}).`);
    this.name = "ReceiptClosingDuplicateError";
    this.existingClosingId = existingClosingId;
  }
}

export class ReceiptClosingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReceiptClosingValidationError";
    this.code = code;
  }
}

export function isReceiptClosingLockingStatus(status: CommissionMonthlyClosingStatus): boolean {
  return COMMISSION_MONTHLY_CLOSING_LOCKING_STATUSES.includes(status);
}

export function validateReceiptClosingConfirmPhrase(
  confirm: string | null | undefined,
  expected: string
): void {
  if ((confirm ?? "").trim() !== expected) {
    throw new ReceiptClosingValidationError(
      "CONFIRMATION_REQUIRED",
      `Confirmação obrigatória: --confirm="${expected}"`
    );
  }
}

export function validateReceiptClosingCancelReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) {
    throw new ReceiptClosingValidationError(
      "CANCEL_REASON_REQUIRED",
      "Cancelamento exige --reason com pelo menos 3 caracteres."
    );
  }
  return trimmed;
}

const RECEIPT_CLOSING_NON_BLOCKING_STATUSES = new Set<CommissionReceiptLedgerLineStatus>([
  "GROUP_COMPANY_EXCLUDED",
  "CUSTOMER_EXCLUDED",
]);

const RECEIPT_CLOSING_SCHEDULE_BLOCKING_STATUSES = new Set<CommissionReceiptLedgerLineStatus>([
  "NO_SCHEDULE",
  "STALE_SCHEDULE",
]);

export function assessReceiptClosingApplyReadiness(
  preview: CommissionReceiptPreviewResult
): { canApply: boolean; applyBlockedReason: string | null } {
  const seenReceivable = new Set<number>();
  let commercialWithoutSchedule = 0;

  for (const line of preview.lines) {
    if (line.nomusReceivableId == null) continue;
    if (seenReceivable.has(line.nomusReceivableId)) continue;
    seenReceivable.add(line.nomusReceivableId);

    if (RECEIPT_CLOSING_NON_BLOCKING_STATUSES.has(line.status)) continue;
    if (RECEIPT_CLOSING_SCHEDULE_BLOCKING_STATUSES.has(line.status)) {
      commercialWithoutSchedule += 1;
    }
  }

  if (commercialWithoutSchedule > 0) {
    return {
      canApply: false,
      applyBlockedReason: `${commercialWithoutSchedule} título(s) comercial(is) sem schedule materializado. Rode a materialização (scripts/rebuild-commission-materialization.ts) antes de fechar.`,
    };
  }

  return { canApply: true, applyBlockedReason: null };
}

export function validateReceiptClosingPreviewForApply(
  preview: CommissionReceiptPreviewResult
): void {
  const readiness = assessReceiptClosingApplyReadiness(preview);
  if (!readiness.canApply && readiness.applyBlockedReason) {
    throw new ReceiptClosingValidationError(
      "COMMERCIAL_WITHOUT_SCHEDULE",
      readiness.applyBlockedReason
    );
  }
}

export function appendReceiptClosingNote(
  existing: string | null | undefined,
  entry: string
): string {
  const base = existing?.trim();
  return base ? `${base}\n${entry}` : entry;
}

export function formatReceiptClosingCancelNote(userId: string, reason: string): string {
  return `[CANCELLED ${new Date().toISOString()} by ${userId}] ${reason}`;
}

export function formatReceiptClosingReprocessNote(
  userId: string,
  reason: string,
  newClosingId: string
): string {
  return `[REPROCESSED ${new Date().toISOString()} by ${userId} → ${newClosingId}] ${reason}`;
}

export function buildReceiptClosingHashFromPreview(
  preview: CommissionReceiptPreviewResult
): string {
  return buildCommissionMonthlyClosingHash({
    year: preview.year,
    month: preview.month,
    source: RECEIPT_CLOSING_SOURCE,
    lineKeys: preview.lines.map((line) => line.ledgerLineKey),
  });
}

export function buildReceiptClosingSnapshotFromPreview(
  preview: CommissionReceiptPreviewResult,
  closingId: string,
  status: CommissionMonthlyClosingStatus,
  meta: {
    calculationHash: string;
    closedBy?: string | null;
    closedAt?: Date | null;
    notes?: string | null;
  }
): ReceiptClosingSnapshot {
  return {
    closingId,
    year: preview.year,
    month: preview.month,
    status,
    calculationHash: meta.calculationHash,
    totalReceivedAmount: preview.totalReceivedAmount,
    totalCommissionableBase: preview.totalCommissionableBase,
    totalExpectedCommission: preview.totalExpectedCommission,
    totalReleasedCommission: preview.totalReleasedCommission,
    totalExcludedAmount: preview.totalExcludedAmount,
    totalExceptionAmount: preview.totalExceptionAmount,
    lineCount: preview.lines.length,
    closedAt: meta.closedAt?.toISOString() ?? null,
    closedBy: meta.closedBy ?? null,
    notes: meta.notes ?? null,
  };
}

export function buildReceiptClosingPreviewPayload(
  preview: CommissionReceiptPreviewResult,
  existingClosing: ReceiptClosingSnapshot | null
): ReceiptClosingPreviewPayload {
  if (existingClosing != null) {
    return {
      preview,
      existingClosing,
      canApply: false,
      applyBlockedReason: `Fechamento CLOSED já existe (id=${existingClosing.closingId}). Use reprocessamento explícito.`,
    };
  }

  const readiness = assessReceiptClosingApplyReadiness(preview);
  return {
    preview,
    existingClosing: null,
    canApply: readiness.canApply,
    applyBlockedReason: readiness.applyBlockedReason,
  };
}

export function mapPreviewLineToLedgerCreateData(
  line: CommissionReceiptPreviewLine,
  closingId: string
): Prisma.CommissionReceiptLedgerLineCreateManyInput {
  const ledgerLineKey = buildPersistedCommissionReceiptLedgerLineKey({
    year: line.year,
    month: line.month,
    nomusReceivableId: line.nomusReceivableId,
    commissionRecordId: line.commissionRecordId,
    commissionPaymentScheduleId: line.commissionPaymentScheduleId,
    commissionReceivableScheduleId: line.commissionReceivableScheduleId,
    installmentNumber: line.installmentNumber,
    nomusOrderItemId: line.nomusOrderItemId,
    ruleId: line.ruleId,
    closingId,
  });

  const ruleSnapshotJson =
    line.commissionReceivableScheduleId != null
      ? {
          commissionReceivableScheduleId: line.commissionReceivableScheduleId,
          ratePercent: line.ratePercent,
          source: line.source,
          capturedAt: new Date().toISOString(),
        }
      : line.ruleId != null
      ? {
          ruleId: line.ruleId,
          ruleName: line.ruleName,
          ratePercent: line.ratePercent,
          source: line.source,
          capturedAt: new Date().toISOString(),
        }
      : line.ratePercent > 0
        ? {
            ratePercent: line.ratePercent,
            source: line.source,
            capturedAt: new Date().toISOString(),
          }
        : null;

  const isException = COMMISSION_RECEIPT_EXCEPTION_STATUSES.includes(line.status);

  return {
    closingId,
    year: line.year,
    month: line.month,
    ledgerLineKey,
    nomusReceivableId: line.nomusReceivableId,
    receivableNumber: line.receivableNumber,
    installmentNumber: line.installmentNumber,
    settlementDate: line.settlementDate ? new Date(line.settlementDate) : null,
    dueDate: line.dueDate ? new Date(line.dueDate) : null,
    customerId: line.customerId,
    customerExternalId: line.customerExternalId,
    customerNameSnapshot: line.customerName,
    orderCode: line.orderCode,
    nomusNfeId: line.nomusNfeId,
    nfeNumber: line.nfeNumber,
    nomusOrderItemId: line.nomusOrderItemId,
    productCode: line.productCode,
    productNameSnapshot: line.productName,
    rawSellerId: line.rawSellerId,
    rawSellerName: line.rawSellerName,
    canonicalSellerId: line.canonicalSellerId,
    canonicalSellerName: line.canonicalSellerName,
    sellerResolutionStatus: line.sellerResolutionStatus,
    receivedAmount: line.receivedAmount,
    receivableNominalAmount: line.receivableAmount,
    allocatedReceivedAmount: line.receivedAmount,
    allocatedCommercialBase: line.commissionableBaseAmount,
    commissionRatePercent: line.ratePercent,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    commissionRecordId: line.commissionRecordId,
    commissionPaymentScheduleId: line.commissionPaymentScheduleId,
    ruleId: line.ruleId,
    ruleNameSnapshot: line.ruleName,
    ruleSnapshotJson: ruleSnapshotJson ?? undefined,
    customerExclusionRuleId: line.exclusionRuleId,
    exclusionReason: line.exclusionReason,
    status: line.status,
    exceptionReason: isException ? line.statusReason : null,
    calculationHash: line.ledgerLineKey,
  };
}

export function mapLedgerRowToSnapshot(row: {
  id: string;
  ledgerLineKey: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  settlementDate: Date | null;
  customerNameSnapshot: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  productCode: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  receivedAmount: Prisma.Decimal | number;
  allocatedCommercialBase: Prisma.Decimal | number;
  commissionRatePercent: Prisma.Decimal | number;
  expectedCommissionAmount: Prisma.Decimal | number;
  releasedCommissionAmount: Prisma.Decimal | number;
  status: CommissionReceiptLedgerLineStatus;
  exceptionReason: string | null;
  exclusionReason: string | null;
  ruleNameSnapshot: string | null;
  ruleSnapshotJson: unknown;
}): ReceiptClosingLedgerLineSnapshot {
  return {
    id: row.id,
    ledgerLineKey: row.ledgerLineKey,
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    settlementDate: row.settlementDate?.toISOString() ?? null,
    customerName: row.customerNameSnapshot,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    productCode: row.productCode,
    canonicalSellerId: row.canonicalSellerId,
    canonicalSellerName: row.canonicalSellerName,
    receivedAmount: normalizeCommissionLedgerMoney(Number(row.receivedAmount)),
    allocatedCommercialBase: normalizeCommissionLedgerMoney(Number(row.allocatedCommercialBase)),
    commissionRatePercent: normalizeCommissionLedgerMoney(Number(row.commissionRatePercent)),
    expectedCommissionAmount: normalizeCommissionLedgerMoney(Number(row.expectedCommissionAmount)),
    releasedCommissionAmount: normalizeCommissionLedgerMoney(Number(row.releasedCommissionAmount)),
    status: row.status,
    exceptionReason: row.exceptionReason,
    exclusionReason: row.exclusionReason,
    ruleNameSnapshot: row.ruleNameSnapshot,
    ruleSnapshotJson: row.ruleSnapshotJson,
  };
}

export function mapPreviewLineToPayableDetail(
  row: CommissionReceiptPreviewLine,
  monthKey: string
): CommissionMonthlyPayableDetailLine {
  return {
    lineId: row.ledgerLineKey,
    sellerId: row.canonicalSellerId ?? row.canonicalSellerName ?? "—",
    sellerName: row.canonicalSellerName ?? row.rawSellerName ?? "—",
    month: monthKey,
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    nomusNfeId: row.nomusNfeId,
    customerName: row.customerName,
    productCode: row.productCode,
    confirmedAt: null,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    receivedAmount: row.receivedAmount,
    receivableAmount: row.receivableAmount,
    allocatedBaseAmount: row.commissionableBaseAmount,
    expectedCommissionAmount: row.expectedCommissionAmount,
    releasedCommissionAmount: row.releasedCommissionAmount,
    pendingCommissionAmount: roundMoney(
      Math.max(0, row.expectedCommissionAmount - row.releasedCommissionAmount)
    ),
    itemRatePercent: row.ratePercent,
    alerts:
      row.status === "COMMISSIONABLE"
        ? []
        : [row.statusReason ?? row.exclusionReason ?? row.status],
  };
}

function matchesPreviewFilters(
  row: CommissionReceiptPreviewLine,
  query: CommissionMonthlyPayableQuery
): boolean {
  if (query.sellerId?.trim()) {
    const needle = query.sellerId.trim().toLowerCase();
    const haystacks = [row.canonicalSellerId, row.canonicalSellerName, row.rawSellerName]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    if (!haystacks.some((value) => value.includes(needle) || needle.includes(value))) {
      return false;
    }
  }
  if (query.customer?.trim()) {
    const needle = query.customer.trim().toLowerCase();
    const haystack = (row.customerName ?? "").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (query.orderCode?.trim()) {
    const needle = query.orderCode.trim().toLowerCase();
    if (!(row.orderCode ?? "").toLowerCase().includes(needle)) return false;
  }
  if (query.nfeNumber?.trim()) {
    const needle = query.nfeNumber.trim().toLowerCase();
    if (!(row.nfeNumber ?? "").toLowerCase().includes(needle)) return false;
  }
  if (query.nomusReceivableId != null && row.nomusReceivableId !== query.nomusReceivableId) {
    return false;
  }
  if (query.onlyDivergences && row.status === "COMMISSIONABLE") return false;
  return true;
}

export function aggregateMonthlyPayableFromReceiptPreview(
  preview: CommissionReceiptPreviewResult,
  query: CommissionMonthlyPayableQuery
): CommissionMonthlyPayableSummary {
  const monthKey = buildMonthKey(query.year, query.month);
  const filtered = preview.lines.filter((row) => matchesPreviewFilters(row, query));
  const details = filtered.map((row) => mapPreviewLineToPayableDetail(row, monthKey));

  const sellerMap = new Map<string, CommissionMonthlyPayableSummary["sellers"][number]>();
  const receivableKeys = new Set<string>();

  let receivedAmountTotal = 0;
  let allocatedBaseAmountTotal = 0;
  let expectedCommissionAmountTotal = 0;
  let releasedCommissionAmountTotal = 0;

  for (const row of filtered) {
    receivedAmountTotal = roundMoney(receivedAmountTotal + row.receivedAmount);
    if (row.status === "COMMISSIONABLE") {
      allocatedBaseAmountTotal = roundMoney(
        allocatedBaseAmountTotal + row.commissionableBaseAmount
      );
      expectedCommissionAmountTotal = roundMoney(
        expectedCommissionAmountTotal + row.expectedCommissionAmount
      );
      releasedCommissionAmountTotal = roundMoney(
        releasedCommissionAmountTotal + row.releasedCommissionAmount
      );
    }

    const sellerKey = row.canonicalSellerId ?? row.canonicalSellerName ?? row.rawSellerName ?? "—";
    const seller = sellerMap.get(sellerKey) ?? {
      sellerId: row.canonicalSellerId ?? sellerKey,
      sellerName: row.canonicalSellerName ?? row.rawSellerName ?? sellerKey,
      month: monthKey,
      receivedTitlesCount: 0,
      uniqueReceivablesCount: 0,
      uniqueOrdersCount: 0,
      uniqueNfeCount: 0,
      uniqueCustomersCount: 0,
      receivedAmount: 0,
      allocatedBaseAmount: 0,
      expectedCommissionAmount: 0,
      releasedCommissionAmount: 0,
      pendingCommissionAmount: 0,
      averageCommissionRate: 0,
      receivedVsBaseDiff: 0,
      warnings: [],
    };
    seller.receivedAmount = roundMoney(seller.receivedAmount + row.receivedAmount);
    if (row.status === "COMMISSIONABLE") {
      seller.allocatedBaseAmount = roundMoney(
        seller.allocatedBaseAmount + row.commissionableBaseAmount
      );
      seller.expectedCommissionAmount = roundMoney(
        seller.expectedCommissionAmount + row.expectedCommissionAmount
      );
      seller.releasedCommissionAmount = roundMoney(
        seller.releasedCommissionAmount + row.releasedCommissionAmount
      );
    }
    sellerMap.set(sellerKey, seller);

    if (row.nomusReceivableId != null) {
      receivableKeys.add(`cr:${row.nomusReceivableId}`);
    }
  }

  const sellers = [...sellerMap.values()].map((seller) => ({
    ...seller,
    pendingCommissionAmount: roundMoney(
      Math.max(0, seller.expectedCommissionAmount - seller.releasedCommissionAmount)
    ),
    averageCommissionRate:
      seller.allocatedBaseAmount > 0
        ? roundMoney((seller.releasedCommissionAmount / seller.allocatedBaseAmount) * 100)
        : 0,
    receivedVsBaseDiff: roundMoney(seller.receivedAmount - seller.allocatedBaseAmount),
  }));

  const payableCommissionTotal = releasedCommissionAmountTotal;
  const pendingCommissionAmountTotal = roundMoney(
    Math.max(0, expectedCommissionAmountTotal - releasedCommissionAmountTotal)
  );
  const averageCommissionRate =
    allocatedBaseAmountTotal > 0
      ? roundMoney((releasedCommissionAmountTotal / allocatedBaseAmountTotal) * 100)
      : 0;

  return {
    year: query.year,
    month: query.month,
    monthKey,
    monthLabelPt: formatMonthLabelPt(query.year, query.month),
    payableCommissionTotal,
    receivedAmountTotal,
    allocatedBaseAmountTotal,
    expectedCommissionAmountTotal,
    pendingCommissionAmountTotal,
    uniqueReceivablesCount: receivableKeys.size,
    uniqueSellersCount: sellers.length,
    averageCommissionRate,
    receivedVsBaseDiff: roundMoney(receivedAmountTotal - allocatedBaseAmountTotal),
    warnings: [],
    sellers,
    details,
    reportSource: "RECEIPT_PREVIEW",
    reportStatus: "PREVIEW",
    reportDeprecationNotice: null,
    closingId: null,
    calculationHash: null,
  };
}

export function mapLedgerLineToPayableDetail(
  row: ReceiptClosingLedgerLineSnapshot,
  monthKey: string
): CommissionMonthlyPayableDetailLine {
  return {
    lineId: row.id,
    sellerId: row.canonicalSellerId ?? row.canonicalSellerName ?? "—",
    sellerName: row.canonicalSellerName ?? "—",
    month: monthKey,
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    nomusNfeId: null,
    customerName: row.customerName,
    productCode: row.productCode,
    confirmedAt: null,
    dueDate: null,
    settlementDate: row.settlementDate,
    receivedAmount: row.receivedAmount,
    receivableAmount: row.receivedAmount,
    allocatedBaseAmount: row.allocatedCommercialBase,
    expectedCommissionAmount: row.expectedCommissionAmount,
    releasedCommissionAmount: row.releasedCommissionAmount,
    pendingCommissionAmount: roundMoney(
      Math.max(0, row.expectedCommissionAmount - row.releasedCommissionAmount)
    ),
    itemRatePercent: row.commissionRatePercent,
    alerts: row.status === "COMMISSIONABLE" ? [] : [row.exceptionReason ?? row.exclusionReason ?? row.status],
  };
}

function matchesLedgerFilters(
  row: ReceiptClosingLedgerLineSnapshot,
  query: CommissionMonthlyPayableQuery
): boolean {
  if (query.sellerId?.trim()) {
    const needle = query.sellerId.trim().toLowerCase();
    const haystacks = [row.canonicalSellerId, row.canonicalSellerName]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    if (!haystacks.some((value) => value.includes(needle) || needle.includes(value))) {
      return false;
    }
  }
  if (query.customer?.trim()) {
    const needle = query.customer.trim().toLowerCase();
    const name = (row.customerName ?? "").toLowerCase();
    if (!name.includes(needle) && !needle.includes(name)) return false;
  }
  if (query.orderCode?.trim() && row.orderCode !== query.orderCode.trim()) return false;
  if (query.nfeNumber?.trim() && row.nfeNumber !== query.nfeNumber.trim()) return false;
  if (query.nomusReceivableId != null && row.nomusReceivableId !== query.nomusReceivableId) {
    return false;
  }
  if (query.onlyDivergences && row.status === "COMMISSIONABLE") return false;
  return true;
}

export function aggregateMonthlyPayableFromLedgerLines(
  lines: ReceiptClosingLedgerLineSnapshot[],
  query: CommissionMonthlyPayableQuery
): CommissionMonthlyPayableSummary {
  const monthKey = buildMonthKey(query.year, query.month);
  const filtered = lines.filter((row) => matchesLedgerFilters(row, query));
  const details = filtered.map((row) => mapLedgerLineToPayableDetail(row, monthKey));

  const sellerMap = new Map<string, CommissionMonthlyPayableSummary["sellers"][number]>();
  const receivableKeys = new Set<string>();

  let receivedAmountTotal = 0;
  let allocatedBaseAmountTotal = 0;
  let expectedCommissionAmountTotal = 0;
  let releasedCommissionAmountTotal = 0;

  for (const row of filtered) {
    receivedAmountTotal = roundMoney(receivedAmountTotal + row.receivedAmount);
    if (row.status === "COMMISSIONABLE") {
      allocatedBaseAmountTotal = roundMoney(allocatedBaseAmountTotal + row.allocatedCommercialBase);
      expectedCommissionAmountTotal = roundMoney(
        expectedCommissionAmountTotal + row.expectedCommissionAmount
      );
      releasedCommissionAmountTotal = roundMoney(
        releasedCommissionAmountTotal + row.releasedCommissionAmount
      );
    }

    const sellerKey = row.canonicalSellerId ?? row.canonicalSellerName ?? "—";
    const seller = sellerMap.get(sellerKey) ?? {
      sellerId: row.canonicalSellerId ?? sellerKey,
      sellerName: row.canonicalSellerName ?? sellerKey,
      month: monthKey,
      receivedTitlesCount: 0,
      uniqueReceivablesCount: 0,
      uniqueOrdersCount: 0,
      uniqueNfeCount: 0,
      uniqueCustomersCount: 0,
      receivedAmount: 0,
      allocatedBaseAmount: 0,
      expectedCommissionAmount: 0,
      releasedCommissionAmount: 0,
      pendingCommissionAmount: 0,
      averageCommissionRate: 0,
      receivedVsBaseDiff: 0,
      warnings: [],
    };
    seller.receivedAmount = roundMoney(seller.receivedAmount + row.receivedAmount);
    if (row.status === "COMMISSIONABLE") {
      seller.allocatedBaseAmount = roundMoney(
        seller.allocatedBaseAmount + row.allocatedCommercialBase
      );
      seller.expectedCommissionAmount = roundMoney(
        seller.expectedCommissionAmount + row.expectedCommissionAmount
      );
      seller.releasedCommissionAmount = roundMoney(
        seller.releasedCommissionAmount + row.releasedCommissionAmount
      );
    }
    sellerMap.set(sellerKey, seller);

    if (row.nomusReceivableId != null) {
      receivableKeys.add(`cr:${row.nomusReceivableId}`);
    }
  }

  const sellers = [...sellerMap.values()].map((seller) => ({
    ...seller,
    pendingCommissionAmount: roundMoney(
      Math.max(0, seller.expectedCommissionAmount - seller.releasedCommissionAmount)
    ),
    averageCommissionRate:
      seller.allocatedBaseAmount > 0
        ? roundMoney((seller.releasedCommissionAmount / seller.allocatedBaseAmount) * 100)
        : 0,
    receivedVsBaseDiff: roundMoney(seller.receivedAmount - seller.allocatedBaseAmount),
  }));

  const payableCommissionTotal = releasedCommissionAmountTotal;
  const pendingCommissionAmountTotal = roundMoney(
    Math.max(0, expectedCommissionAmountTotal - releasedCommissionAmountTotal)
  );
  const averageCommissionRate =
    allocatedBaseAmountTotal > 0
      ? roundMoney((releasedCommissionAmountTotal / allocatedBaseAmountTotal) * 100)
      : 0;

  return {
    year: query.year,
    month: query.month,
    monthKey,
    monthLabelPt: formatMonthLabelPt(query.year, query.month),
    payableCommissionTotal,
    receivedAmountTotal,
    allocatedBaseAmountTotal,
    expectedCommissionAmountTotal,
    pendingCommissionAmountTotal,
    uniqueReceivablesCount: receivableKeys.size,
    uniqueSellersCount: sellers.length,
    averageCommissionRate,
    receivedVsBaseDiff: roundMoney(receivedAmountTotal - allocatedBaseAmountTotal),
    warnings: ["Fonte: fechamento persistido (ledger por recebimento)."],
    sellers,
    details,
    reportSource: "RECEIPT_CLOSED",
    reportStatus: "FECHADO",
    reportDeprecationNotice: null,
    closingId: null,
    calculationHash: null,
  };
}

export function diffReceiptClosingSnapshots(
  before: Pick<
    ReceiptClosingSnapshot,
    | "calculationHash"
    | "totalReceivedAmount"
    | "totalCommissionableBase"
    | "totalExpectedCommission"
    | "totalReleasedCommission"
    | "lineCount"
  >,
  afterPreview: CommissionReceiptPreviewResult
): ReceiptClosingReprocessDiff {
  const afterHash = buildReceiptClosingHashFromPreview(afterPreview);
  const beforeKeys = new Set(
    afterPreview.lines.map((line) => line.ledgerLineKey).slice(0, before.lineCount)
  );
  const afterKeys = new Set(afterPreview.lines.map((line) => line.ledgerLineKey));
  let changedLines = 0;
  for (const line of afterPreview.lines) {
    if (beforeKeys.has(line.ledgerLineKey)) changedLines += 1;
  }

  return {
    receivedAmountDiff: roundMoney(afterPreview.totalReceivedAmount - before.totalReceivedAmount),
    commissionableBaseDiff: roundMoney(
      afterPreview.totalCommissionableBase - before.totalCommissionableBase
    ),
    expectedCommissionDiff: roundMoney(
      afterPreview.totalExpectedCommission - before.totalExpectedCommission
    ),
    releasedCommissionDiff: roundMoney(
      afterPreview.totalReleasedCommission - before.totalReleasedCommission
    ),
    lineCountDiff: afterPreview.lines.length - before.lineCount,
    addedLines: [...afterKeys].filter((key) => !beforeKeys.has(key)).length,
    removedLines: [...beforeKeys].filter((key) => !afterKeys.has(key)).length,
    changedLines,
    hashChanged: before.calculationHash !== afterHash,
    beforeHash: before.calculationHash,
    afterHash,
  };
}

export function buildReceiptClosingReprocessPreview(
  existingClosing: ReceiptClosingSnapshot,
  preview: CommissionReceiptPreviewResult
): ReceiptClosingReprocessPreview {
  const afterHash = buildReceiptClosingHashFromPreview(preview);
  return {
    existingClosing,
    preview,
    before: existingClosing,
    afterTotals: {
      totalReceivedAmount: preview.totalReceivedAmount,
      totalCommissionableBase: preview.totalCommissionableBase,
      totalExpectedCommission: preview.totalExpectedCommission,
      totalReleasedCommission: preview.totalReleasedCommission,
      totalExcludedAmount: preview.totalExcludedAmount,
      totalExceptionAmount: preview.totalExceptionAmount,
      lineCount: preview.lines.length,
      calculationHash: afterHash,
    },
    diff: diffReceiptClosingSnapshots(existingClosing, preview),
  };
}

export function receiptClosingLedgerCsvHeader(): string[] {
  return [
    "ledgerLineKey",
    "nomusReceivableId",
    "settlementDate",
    "customerName",
    "orderCode",
    "nfeNumber",
    "productCode",
    "canonicalSellerName",
    "status",
    "allocatedCommercialBase",
    "commissionRatePercent",
    "expectedCommissionAmount",
    "releasedCommissionAmount",
    "ruleNameSnapshot",
    "exclusionReason",
    "exceptionReason",
  ];
}

export function receiptClosingLedgerLineToCsvRow(row: ReceiptClosingLedgerLineSnapshot): string[] {
  return [
    row.ledgerLineKey,
    row.nomusReceivableId != null ? String(row.nomusReceivableId) : "",
    row.settlementDate ?? "",
    row.customerName ?? "",
    row.orderCode ?? "",
    row.nfeNumber ?? "",
    row.productCode ?? "",
    row.canonicalSellerName ?? "",
    row.status,
    row.allocatedCommercialBase.toFixed(2),
    row.commissionRatePercent.toFixed(4),
    row.expectedCommissionAmount.toFixed(2),
    row.releasedCommissionAmount.toFixed(2),
    row.ruleNameSnapshot ?? "",
    row.exclusionReason ?? "",
    row.exceptionReason ?? "",
  ];
}
