/**
 * Relatório de validação: motor por recebimento vs legado (read-only).
 */
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import type { CommissionMonthlyPayableDetailLine, CommissionMonthlyPayableSummary } from "./commissionMonthlyPayable.js";
import { roundMoney } from "./commission-money.js";

export type PayableSummarySnapshot = {
  reportSource: string;
  reportStatus: string;
  receivedAmountTotal: number;
  allocatedBaseAmountTotal: number;
  expectedCommissionAmountTotal: number;
  payableCommissionTotal: number;
  pendingCommissionAmountTotal: number;
  uniqueReceivablesCount: number;
  uniqueSellersCount: number;
  lineCount: number;
  calculationHash: string | null;
};

export type PayableDiffSnapshot = {
  receivedAmountDiff: number;
  baseDiff: number;
  expectedCommissionDiff: number;
  releasedCommissionDiff: number;
  pendingCommissionDiff: number;
  receivableCountDiff: number;
  lineCountDiff: number;
};

export type NomusValidationComparison = {
  nomusBase: number | null;
  nomusCommission: number | null;
  newBaseDiff: number | null;
  newCommissionDiff: number | null;
  legacyCommissionDiff: number | null;
  newBaseDiffPercent: number | null;
  newCommissionDiffPercent: number | null;
};

export type StatusBreakdownRow = {
  status: string;
  count: number;
  receivedAmount: number;
  allocatedBase: number;
  commissionAmount: number;
};

export type SellerBreakdownRow = {
  sellerKey: string;
  sellerName: string;
  lineCount: number;
  receivedAmount: number;
  allocatedBase: number;
  newCommissionAmount: number;
  legacyCommissionAmount: number | null;
  differenceAmount: number | null;
};

export type CustomerBreakdownRow = {
  customerKey: string;
  customerName: string;
  lineCount: number;
  receivedAmount: number;
  allocatedBase: number;
  newCommissionAmount: number;
  legacyCommissionAmount: number | null;
  differenceAmount: number | null;
};

export type ExceptionHighlight = {
  lineKey: string;
  status: string;
  receivableNumber: string | null;
  settlementDate: string | null;
  customerName: string | null;
  canonicalSellerName: string | null;
  receivedAmount: number;
  exceptionReason: string | null;
};

export type DifferenceHighlight = {
  lineKey: string;
  receivableNumber: string | null;
  customerName: string | null;
  canonicalSellerName: string | null;
  newCommissionAmount: number;
  legacyCommissionAmount: number;
  differenceAmount: number;
  status: string;
};

export type ValidationCompareLine = {
  lineKey: string;
  source: "NEW" | "LEGACY" | "BOTH";
  year: number;
  month: number;
  status: string;
  receivableNumber: string | null;
  settlementDate: string | null;
  customerName: string | null;
  salesOrderNumber: string | null;
  nfeNumber: string | null;
  productName: string | null;
  rawSellerName: string | null;
  canonicalSellerName: string | null;
  receivedAmount: number;
  allocatedBase: number;
  commissionRate: number;
  newCommissionAmount: number;
  legacyCommissionAmount: number;
  differenceAmount: number;
  nomusReference: string | null;
  exceptionReason: string | null;
  calculationHash: string | null;
};

export type CommissionReceiptClosingValidationReport = {
  year: number;
  month: number;
  filters: {
    seller: string | null;
    customer: string | null;
  };
  previewOnly: true;
  calculationHash: string;
  closedLedgerExists: {
    closingId: string;
    payableCommissionTotal: number;
    diffVsLivePreview: number;
  } | null;
  summaryNewReceiptEngine: PayableSummarySnapshot;
  summaryLegacy: PayableSummarySnapshot | null;
  diffNewVsLegacy: PayableDiffSnapshot | null;
  nomusComparison: NomusValidationComparison | null;
  breakdownByStatus: StatusBreakdownRow[];
  breakdownBySeller: SellerBreakdownRow[];
  breakdownByCustomer: CustomerBreakdownRow[];
  topExceptions: ExceptionHighlight[];
  topDifferences: DifferenceHighlight[];
  lines?: ValidationCompareLine[];
};

export const VALIDATION_CSV_HEADERS = [
  "source",
  "year",
  "month",
  "status",
  "receivableNumber",
  "settlementDate",
  "customerName",
  "salesOrderNumber",
  "nfeNumber",
  "productName",
  "rawSellerName",
  "canonicalSellerName",
  "receivedAmount",
  "allocatedBase",
  "commissionRate",
  "newCommissionAmount",
  "legacyCommissionAmount",
  "differenceAmount",
  "nomusReference",
  "exceptionReason",
  "calculationHash",
] as const;

export function buildValidationLineKey(input: {
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  productCode?: string | null;
  productName?: string | null;
  lineId?: string;
}): string {
  return [
    input.nomusReceivableId ?? "na",
    input.installmentNumber ?? 0,
    (input.productCode ?? input.productName ?? input.lineId ?? "item").toLowerCase(),
  ].join("|");
}

export function summaryFromPreview(
  preview: CommissionReceiptPreviewResult,
  calculationHash: string
): PayableSummarySnapshot {
  return {
    reportSource: "RECEIPT_PREVIEW",
    reportStatus: "PREVIEW",
    receivedAmountTotal: preview.totalReceivedAmount,
    allocatedBaseAmountTotal: preview.totalCommissionableBase,
    expectedCommissionAmountTotal: preview.totalExpectedCommission,
    payableCommissionTotal: preview.totalReleasedCommission,
    pendingCommissionAmountTotal: roundMoney(
      Math.max(0, preview.totalExpectedCommission - preview.totalReleasedCommission)
    ),
    uniqueReceivablesCount: preview.totalReceivables,
    uniqueSellersCount: preview.bySeller.length,
    lineCount: preview.lines.length,
    calculationHash,
  };
}

export function summaryFromMonthlyPayable(summary: CommissionMonthlyPayableSummary): PayableSummarySnapshot {
  return {
    reportSource: summary.reportSource,
    reportStatus: summary.reportStatus,
    receivedAmountTotal: summary.receivedAmountTotal,
    allocatedBaseAmountTotal: summary.allocatedBaseAmountTotal,
    expectedCommissionAmountTotal: summary.expectedCommissionAmountTotal,
    payableCommissionTotal: summary.payableCommissionTotal,
    pendingCommissionAmountTotal: summary.pendingCommissionAmountTotal,
    uniqueReceivablesCount: summary.uniqueReceivablesCount,
    uniqueSellersCount: summary.uniqueSellersCount,
    lineCount: summary.details.length,
    calculationHash: summary.calculationHash,
  };
}

export function diffPayableSummaries(
  newer: PayableSummarySnapshot,
  legacy: PayableSummarySnapshot
): PayableDiffSnapshot {
  return {
    receivedAmountDiff: roundMoney(newer.receivedAmountTotal - legacy.receivedAmountTotal),
    baseDiff: roundMoney(newer.allocatedBaseAmountTotal - legacy.allocatedBaseAmountTotal),
    expectedCommissionDiff: roundMoney(
      newer.expectedCommissionAmountTotal - legacy.expectedCommissionAmountTotal
    ),
    releasedCommissionDiff: roundMoney(newer.payableCommissionTotal - legacy.payableCommissionTotal),
    pendingCommissionDiff: roundMoney(
      newer.pendingCommissionAmountTotal - legacy.pendingCommissionAmountTotal
    ),
    receivableCountDiff: newer.uniqueReceivablesCount - legacy.uniqueReceivablesCount,
    lineCountDiff: newer.lineCount - legacy.lineCount,
  };
}

export function buildNomusValidationComparison(input: {
  nomusBase: number | null;
  nomusCommission: number | null;
  newSummary: PayableSummarySnapshot;
  legacySummary: PayableSummarySnapshot | null;
}): NomusValidationComparison | null {
  if (input.nomusBase == null && input.nomusCommission == null) return null;
  const newBaseDiff =
    input.nomusBase != null
      ? roundMoney(input.newSummary.allocatedBaseAmountTotal - input.nomusBase)
      : null;
  const newCommissionDiff =
    input.nomusCommission != null
      ? roundMoney(input.newSummary.payableCommissionTotal - input.nomusCommission)
      : null;
  const legacyCommissionDiff =
    input.nomusCommission != null && input.legacySummary
      ? roundMoney(input.legacySummary.payableCommissionTotal - input.nomusCommission)
      : null;
  return {
    nomusBase: input.nomusBase,
    nomusCommission: input.nomusCommission,
    newBaseDiff,
    newCommissionDiff,
    legacyCommissionDiff,
    newBaseDiffPercent:
      input.nomusBase != null && input.nomusBase > 0 && newBaseDiff != null
        ? roundMoney((newBaseDiff / input.nomusBase) * 100)
        : null,
    newCommissionDiffPercent:
      input.nomusCommission != null && input.nomusCommission > 0 && newCommissionDiff != null
        ? roundMoney((newCommissionDiff / input.nomusCommission) * 100)
        : null,
  };
}

export function buildBreakdownByStatus(lines: CommissionReceiptPreviewLine[]): StatusBreakdownRow[] {
  const map = new Map<string, StatusBreakdownRow>();
  for (const line of lines) {
    const row = map.get(line.status) ?? {
      status: line.status,
      count: 0,
      receivedAmount: 0,
      allocatedBase: 0,
      commissionAmount: 0,
    };
    row.count += 1;
    row.receivedAmount = roundMoney(row.receivedAmount + line.receivedAmount);
    if (line.status === "COMMISSIONABLE") {
      row.allocatedBase = roundMoney(row.allocatedBase + line.commissionableBaseAmount);
      row.commissionAmount = roundMoney(row.commissionAmount + line.releasedCommissionAmount);
    }
    map.set(line.status, row);
  }
  return [...map.values()].sort((a, b) => b.receivedAmount - a.receivedAmount);
}

function legacyCommissionByKey(details: CommissionMonthlyPayableDetailLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of details) {
    const key = buildValidationLineKey({
      nomusReceivableId: line.nomusReceivableId,
      installmentNumber: line.installmentNumber,
      productCode: line.productCode,
      lineId: line.lineId,
    });
    map.set(key, roundMoney((map.get(key) ?? 0) + line.releasedCommissionAmount));
  }
  return map;
}

export function buildBreakdownBySeller(
  lines: CommissionReceiptPreviewLine[],
  legacyDetails: CommissionMonthlyPayableDetailLine[] | null
): SellerBreakdownRow[] {
  const legacyBySeller = new Map<string, number>();
  if (legacyDetails) {
    for (const line of legacyDetails) {
      for (const key of [line.sellerName, line.sellerId]) {
        if (!key) continue;
        legacyBySeller.set(key, roundMoney((legacyBySeller.get(key) ?? 0) + line.releasedCommissionAmount));
      }
    }
  }

  const map = new Map<string, SellerBreakdownRow>();
  for (const line of lines) {
    const sellerKey = line.canonicalSellerId ?? line.canonicalSellerName ?? line.rawSellerName ?? "—";
    const sellerName = line.canonicalSellerName ?? line.rawSellerName ?? "—";
    const row = map.get(sellerKey) ?? {
      sellerKey,
      sellerName,
      lineCount: 0,
      receivedAmount: 0,
      allocatedBase: 0,
      newCommissionAmount: 0,
      legacyCommissionAmount: null,
      differenceAmount: null,
    };
    row.lineCount += 1;
    row.receivedAmount = roundMoney(row.receivedAmount + line.receivedAmount);
    if (line.status === "COMMISSIONABLE") {
      row.allocatedBase = roundMoney(row.allocatedBase + line.commissionableBaseAmount);
      row.newCommissionAmount = roundMoney(row.newCommissionAmount + line.releasedCommissionAmount);
    }
    map.set(sellerKey, row);
  }

  return [...map.values()]
    .map((row) => {
      const legacyAmount =
        legacyDetails == null
          ? null
          : roundMoney(
              legacyBySeller.get(row.sellerName) ??
                legacyBySeller.get(row.sellerKey) ??
                0
            );
      return {
        ...row,
        legacyCommissionAmount: legacyAmount,
        differenceAmount:
          legacyAmount == null ? null : roundMoney(row.newCommissionAmount - legacyAmount),
      };
    })
    .sort((a, b) => Math.abs(b.differenceAmount ?? b.newCommissionAmount) - Math.abs(a.differenceAmount ?? a.newCommissionAmount));
}

export function buildBreakdownByCustomer(
  lines: CommissionReceiptPreviewLine[],
  legacyDetails: CommissionMonthlyPayableDetailLine[] | null
): CustomerBreakdownRow[] {
  const legacyByCustomer = new Map<string, number>();
  if (legacyDetails) {
    for (const line of legacyDetails) {
      const key = (line.customerName ?? "—").toLowerCase();
      legacyByCustomer.set(key, roundMoney((legacyByCustomer.get(key) ?? 0) + line.releasedCommissionAmount));
    }
  }

  const map = new Map<string, CustomerBreakdownRow>();
  for (const line of lines) {
    const customerKey = (line.customerName ?? "—").toLowerCase();
    const customerName = line.customerName ?? "—";
    const row = map.get(customerKey) ?? {
      customerKey,
      customerName,
      lineCount: 0,
      receivedAmount: 0,
      allocatedBase: 0,
      newCommissionAmount: 0,
      legacyCommissionAmount: null,
      differenceAmount: null,
    };
    row.lineCount += 1;
    row.receivedAmount = roundMoney(row.receivedAmount + line.receivedAmount);
    if (line.status === "COMMISSIONABLE") {
      row.allocatedBase = roundMoney(row.allocatedBase + line.commissionableBaseAmount);
      row.newCommissionAmount = roundMoney(row.newCommissionAmount + line.releasedCommissionAmount);
    }
    map.set(customerKey, row);
  }

  return [...map.values()]
    .map((row) => {
      const legacyAmount = legacyDetails
        ? roundMoney(legacyByCustomer.get(row.customerKey) ?? 0)
        : null;
      return {
        ...row,
        legacyCommissionAmount: legacyAmount,
        differenceAmount:
          legacyAmount == null ? null : roundMoney(row.newCommissionAmount - legacyAmount),
      };
    })
    .sort((a, b) => Math.abs(b.differenceAmount ?? b.newCommissionAmount) - Math.abs(a.differenceAmount ?? a.newCommissionAmount));
}

export function buildTopExceptions(
  lines: CommissionReceiptPreviewLine[],
  limit = 25
): ExceptionHighlight[] {
  return lines
    .filter((line) => line.status !== "COMMISSIONABLE")
    .map((line) => ({
      lineKey: line.ledgerLineKey,
      status: line.status,
      receivableNumber: line.receivableNumber,
      settlementDate: line.settlementDate,
      customerName: line.customerName,
      canonicalSellerName: line.canonicalSellerName ?? line.rawSellerName,
      receivedAmount: line.receivedAmount,
      exceptionReason: line.statusReason ?? line.exclusionReason ?? line.status,
    }))
    .sort((a, b) => b.receivedAmount - a.receivedAmount)
    .slice(0, limit);
}

export function buildValidationCompareLines(input: {
  year: number;
  month: number;
  previewLines: CommissionReceiptPreviewLine[];
  legacyDetails: CommissionMonthlyPayableDetailLine[] | null;
  calculationHash: string;
  nomusReference: string | null;
}): ValidationCompareLine[] {
  const legacyMap = input.legacyDetails ? legacyCommissionByKey(input.legacyDetails) : new Map();
  const keys = new Set<string>();

  for (const line of input.previewLines) {
    keys.add(
      buildValidationLineKey({
        nomusReceivableId: line.nomusReceivableId,
        installmentNumber: line.installmentNumber,
        productCode: line.productCode,
        productName: line.productName,
        lineId: line.ledgerLineKey,
      })
    );
  }
  if (input.legacyDetails) {
    for (const line of input.legacyDetails) {
      keys.add(
        buildValidationLineKey({
          nomusReceivableId: line.nomusReceivableId,
          installmentNumber: line.installmentNumber,
          productCode: line.productCode,
          lineId: line.lineId,
        })
      );
    }
  }

  const previewByKey = new Map(
    input.previewLines.map((line) => [
      buildValidationLineKey({
        nomusReceivableId: line.nomusReceivableId,
        installmentNumber: line.installmentNumber,
        productCode: line.productCode,
        productName: line.productName,
        lineId: line.ledgerLineKey,
      }),
      line,
    ])
  );

  const legacyDetailByKey = new Map(
    (input.legacyDetails ?? []).map((line) => [
      buildValidationLineKey({
        nomusReceivableId: line.nomusReceivableId,
        installmentNumber: line.installmentNumber,
        productCode: line.productCode,
        lineId: line.lineId,
      }),
      line,
    ])
  );

  const rows: ValidationCompareLine[] = [];
  for (const key of keys) {
    const newLine = previewByKey.get(key);
    const legacyLine = legacyDetailByKey.get(key);
    const newCommission = newLine?.releasedCommissionAmount ?? 0;
    const legacyCommission = legacyMap.get(key) ?? legacyLine?.releasedCommissionAmount ?? 0;
    rows.push({
      lineKey: key,
      source: newLine && legacyLine ? "BOTH" : newLine ? "NEW" : "LEGACY",
      year: input.year,
      month: input.month,
      status: newLine?.status ?? (legacyLine?.alerts[0] ?? "LEGACY_ONLY"),
      receivableNumber: newLine?.receivableNumber ?? String(newLine?.nomusReceivableId ?? legacyLine?.nomusReceivableId ?? ""),
      settlementDate: newLine?.settlementDate ?? legacyLine?.settlementDate ?? null,
      customerName: newLine?.customerName ?? legacyLine?.customerName ?? null,
      salesOrderNumber: newLine?.orderCode ?? legacyLine?.orderCode ?? null,
      nfeNumber: newLine?.nfeNumber ?? legacyLine?.nfeNumber ?? null,
      productName: newLine?.productName ?? newLine?.productCode ?? legacyLine?.productCode ?? null,
      rawSellerName: newLine?.rawSellerName ?? null,
      canonicalSellerName:
        newLine?.canonicalSellerName ??
        newLine?.rawSellerName ??
        legacyLine?.sellerName ??
        null,
      receivedAmount: newLine?.receivedAmount ?? legacyLine?.receivedAmount ?? 0,
      allocatedBase: newLine?.commissionableBaseAmount ?? legacyLine?.allocatedBaseAmount ?? 0,
      commissionRate: newLine?.ratePercent ?? legacyLine?.itemRatePercent ?? 0,
      newCommissionAmount: newCommission,
      legacyCommissionAmount: legacyCommission,
      differenceAmount: roundMoney(newCommission - legacyCommission),
      nomusReference: input.nomusReference,
      exceptionReason:
        newLine?.statusReason ??
        newLine?.exclusionReason ??
        (legacyLine?.alerts.join("; ") || null),
      calculationHash: input.calculationHash,
    });
  }

  return rows.sort((a, b) => Math.abs(b.differenceAmount) - Math.abs(a.differenceAmount));
}

export function buildTopDifferences(
  lines: ValidationCompareLine[],
  limit = 25
): DifferenceHighlight[] {
  return lines
    .filter((line) => Math.abs(line.differenceAmount) > 0.009)
    .map((line) => ({
      lineKey: line.lineKey,
      receivableNumber: line.receivableNumber,
      customerName: line.customerName,
      canonicalSellerName: line.canonicalSellerName,
      newCommissionAmount: line.newCommissionAmount,
      legacyCommissionAmount: line.legacyCommissionAmount,
      differenceAmount: line.differenceAmount,
      status: String(line.status),
    }))
    .slice(0, limit);
}

export function buildCommissionReceiptClosingValidationReport(input: {
  year: number;
  month: number;
  seller: string | null;
  customer: string | null;
  preview: CommissionReceiptPreviewResult;
  calculationHash: string;
  legacySummary: CommissionMonthlyPayableSummary | null;
  closedLedger: { closingId: string; payableCommissionTotal: number } | null;
  nomusBase: number | null;
  nomusCommission: number | null;
  includeLines: boolean;
}): CommissionReceiptClosingValidationReport {
  const summaryNew = summaryFromPreview(input.preview, input.calculationHash);
  const summaryLegacy = input.legacySummary
    ? summaryFromMonthlyPayable(input.legacySummary)
    : null;
  const nomusReference =
    input.nomusBase != null || input.nomusCommission != null
      ? `base=${input.nomusBase ?? ""};commission=${input.nomusCommission ?? ""}`
      : null;
  const compareLines = buildValidationCompareLines({
    year: input.year,
    month: input.month,
    previewLines: input.preview.lines,
    legacyDetails: input.legacySummary?.details ?? null,
    calculationHash: input.calculationHash,
    nomusReference,
  });

  return {
    year: input.year,
    month: input.month,
    filters: { seller: input.seller, customer: input.customer },
    previewOnly: true,
    calculationHash: input.calculationHash,
    closedLedgerExists: input.closedLedger
      ? {
          closingId: input.closedLedger.closingId,
          payableCommissionTotal: input.closedLedger.payableCommissionTotal,
          diffVsLivePreview: roundMoney(
            input.closedLedger.payableCommissionTotal - summaryNew.payableCommissionTotal
          ),
        }
      : null,
    summaryNewReceiptEngine: summaryNew,
    summaryLegacy,
    diffNewVsLegacy:
      summaryLegacy != null ? diffPayableSummaries(summaryNew, summaryLegacy) : null,
    nomusComparison: buildNomusValidationComparison({
      nomusBase: input.nomusBase,
      nomusCommission: input.nomusCommission,
      newSummary: summaryNew,
      legacySummary: summaryLegacy,
    }),
    breakdownByStatus: buildBreakdownByStatus(input.preview.lines),
    breakdownBySeller: buildBreakdownBySeller(
      input.preview.lines,
      input.legacySummary?.details ?? null
    ),
    breakdownByCustomer: buildBreakdownByCustomer(
      input.preview.lines,
      input.legacySummary?.details ?? null
    ),
    topExceptions: buildTopExceptions(input.preview.lines),
    topDifferences: input.legacySummary ? buildTopDifferences(compareLines) : [],
    lines: input.includeLines ? compareLines : undefined,
  };
}

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildValidationCsv(compareLines: ValidationCompareLine[], report: CommissionReceiptClosingValidationReport): string {
  const header = [
    `# preview_only=true`,
    `# calculation_hash=${report.calculationHash}`,
    `# report_status=PREVIEW`,
    VALIDATION_CSV_HEADERS.join(","),
  ];

  const body = compareLines.map((line) =>
    [
      line.source,
      line.year,
      line.month,
      line.status,
      line.receivableNumber ?? "",
      line.settlementDate?.slice(0, 10) ?? "",
      line.customerName ?? "",
      line.salesOrderNumber ?? "",
      line.nfeNumber ?? "",
      line.productName ?? "",
      line.rawSellerName ?? "",
      line.canonicalSellerName ?? "",
      line.receivedAmount.toFixed(2),
      line.allocatedBase.toFixed(2),
      line.commissionRate.toFixed(4),
      line.newCommissionAmount.toFixed(2),
      line.legacyCommissionAmount.toFixed(2),
      line.differenceAmount.toFixed(2),
      line.nomusReference ?? "",
      line.exceptionReason ?? "",
      line.calculationHash ?? "",
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return [...header, ...body].join("\n");
}
