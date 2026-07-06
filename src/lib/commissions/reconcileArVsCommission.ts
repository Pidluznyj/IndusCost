/**
 * Reconciliação AR financeiro x Comissão PAYABLE — lógica pura.
 */
import { roundMoney } from "./commission-money.js";
import {
  resolveCommissionSellerIdentity,
  type CommissionSellerIdentityContext,
  type CommissionSellerIdentityResolution,
} from "./commissionSellerIdentity.js";
import type { VisualAuditRow } from "./commissionVisualAudit.js";
import { resolveReceivableUniqueKey } from "./commissionVisualAudit.js";

export type ArReceivableSnapshot = {
  externalId: number;
  personName: string | null;
  personId: number | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
};

export type ArCommissionBreakdownCategory =
  | "COMMISSIONABLE_RELEASED"
  | "COMMISSIONABLE_NOT_FULLY_RELEASED"
  | "CUSTOMER_EXCLUDED"
  | "NO_SELLER"
  | "SELLER_AMBIGUOUS"
  | "NO_ORDER_NFE_LINK"
  | "NO_COMMISSION_RECORD"
  | "ZERO_COMMISSION_RULE"
  | "PARTIAL_RECEIPT"
  | "OTHER_TECHNICAL";

export type ArCommissionDetailLine = {
  receivableId: string;
  externalReceivableId: number;
  customer: string | null;
  rawSellerName: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  canonicalSellerId: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  titleAmount: number;
  receivedAmount: number;
  inArByDueJune: boolean;
  inArBySettlementJune: boolean;
  inCommissionPayableJune: boolean;
  commissionableBase: number;
  expectedCommission: number;
  releasedCommission: number;
  nonCommissionReason: string | null;
  divergenceReason: string | null;
  breakdownCategory: ArCommissionBreakdownCategory;
  sellerResolutionStatus: string | null;
};

export type ArPeriodMetrics = {
  uniqueReceivableCount: number;
  nominalTotal: number;
  receivedTotal: number;
  openTotal: number;
  overdueCount: number;
};

export type ArCommissionReconcileSummary = {
  year: number;
  month: number;
  arByDue: ArPeriodMetrics;
  arBySettlement: ArPeriodMetrics;
  commissionPayable: {
    uniqueReceivableCount: number;
    receivableAmountTotal: number;
    receivedAmountTotal: number;
    commissionableBaseTotal: number;
    expectedCommissionTotal: number;
    releasedCommissionTotal: number;
    pendingCommissionTotal: number;
    averageRatePercent: number;
    schedulesWithoutAr: number;
    receivablesWithoutSchedule: number;
  };
  bridge: {
    arSettlementReceived: number;
    arSettlementWithCommission: number;
    arSettlementWithoutCommission: number;
    commissionReceivedAmount: number;
    arVsCommissionReceivedDiff: number;
    arVsCommissionBaseDiff: number;
  };
  breakdownByCategory: Array<{
    category: ArCommissionBreakdownCategory;
    count: number;
    receivedAmount: number;
    label: string;
  }>;
  topExclusionReasons: Array<{ reason: string; count: number; receivedAmount: number }>;
};

const CATEGORY_LABELS: Record<ArCommissionBreakdownCategory, string> = {
  COMMISSIONABLE_RELEASED: "Comissionável e liberado",
  COMMISSIONABLE_NOT_FULLY_RELEASED: "Comissionável mas não liberado integralmente",
  CUSTOMER_EXCLUDED: "Cliente excluído de comissão",
  NO_SELLER: "Sem vendedor",
  SELLER_AMBIGUOUS: "Vendedor ambíguo/não consolidado",
  NO_ORDER_NFE_LINK: "Sem vínculo pedido/NF",
  NO_COMMISSION_RECORD: "Sem CommissionRecord",
  ZERO_COMMISSION_RULE: "Comissão zero por regra",
  PARTIAL_RECEIPT: "Recebimento parcial",
  OTHER_TECHNICAL: "Outro motivo técnico",
};

function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function inPeriod(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false;
  const ms = date.getTime();
  return ms >= from.getTime() && ms <= to.getTime();
}

function aggregateArMetrics(
  rows: ArReceivableSnapshot[],
  predicate: (row: ArReceivableSnapshot) => boolean,
  referenceDate: Date
): ArPeriodMetrics {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const seen = new Set<number>();
  let nominalTotal = 0;
  let receivedTotal = 0;
  let openTotal = 0;
  let overdueCount = 0;

  for (const row of rows) {
    if (!predicate(row)) continue;
    if (!seen.has(row.externalId)) {
      seen.add(row.externalId);
      nominalTotal = roundMoney(nominalTotal + row.amountReceivable);
      receivedTotal = roundMoney(receivedTotal + row.amountReceived);
      openTotal = roundMoney(openTotal + row.balanceReceivable);
      if (
        row.balanceReceivable > 0.009 &&
        row.dueDate &&
        row.dueDate.getTime() < today.getTime()
      ) {
        overdueCount += 1;
      }
    }
  }

  return {
    uniqueReceivableCount: seen.size,
    nominalTotal,
    receivedTotal,
    openTotal,
    overdueCount,
  };
}

type CommissionReceivableAgg = {
  rows: VisualAuditRow[];
  commissionableBase: number;
  expectedCommission: number;
  releasedCommission: number;
  receivedAmount: number;
  receivableAmount: number;
  rawSellerId: number | null;
  rawSellerName: string | null;
  sellerResolution: CommissionSellerIdentityResolution | null;
};

function aggregateCommissionByReceivable(
  payableRows: VisualAuditRow[],
  identityCtx: CommissionSellerIdentityContext
): Map<number, CommissionReceivableAgg> {
  const map = new Map<number, CommissionReceivableAgg>();

  for (const row of payableRows) {
    const rid = row.nomusReceivableId;
    if (rid == null) continue;
    const existing = map.get(rid) ?? {
      rows: [],
      commissionableBase: 0,
      expectedCommission: 0,
      releasedCommission: 0,
      receivedAmount: 0,
      receivableAmount: 0,
      rawSellerId: null,
      rawSellerName: row.commissionPersonName,
      sellerResolution: null,
    };

    existing.rows.push(row);
    existing.commissionableBase = roundMoney(
      existing.commissionableBase + row.allocatedBaseAmount
    );
    existing.expectedCommission = roundMoney(
      existing.expectedCommission + row.commissionExpected
    );
    existing.releasedCommission = roundMoney(
      existing.releasedCommission + row.commissionReleased
    );

    const receivableKey = resolveReceivableUniqueKey(row);
    if (receivableKey && !existing.rows.some((r, i) => i < existing.rows.length - 1 && resolveReceivableUniqueKey(r) === receivableKey)) {
      existing.receivedAmount = roundMoney(existing.receivedAmount + row.receivedAmount);
      existing.receivableAmount = roundMoney(existing.receivableAmount + row.receivableAmount);
    }

    existing.sellerResolution = resolveCommissionSellerIdentity(
      {
        rawSellerId: row.commissionPersonId ? null : null,
        rawSellerName: row.commissionPersonName,
        source: "COMMISSION_RECORD",
      },
      identityCtx
    );
    existing.sellerResolution = {
      ...existing.sellerResolution,
      canonicalSellerId: row.commissionPersonId,
      canonicalSellerName: row.commissionPersonName,
      resolutionStatus:
        existing.sellerResolution.resolutionStatus === "UNRESOLVED"
          ? "OK_CANONICAL"
          : existing.sellerResolution.resolutionStatus,
    };

    map.set(rid, existing);
  }

  return map;
}

function classifyReceivable(
  ar: ArReceivableSnapshot,
  commission: CommissionReceivableAgg | undefined,
  sellerResolution: CommissionSellerIdentityResolution | null
): { category: ArCommissionBreakdownCategory; nonCommissionReason: string | null; divergenceReason: string | null } {
  if (!commission || commission.rows.length === 0) {
    if (!ar.sourceInvoiceId && !ar.sourceInvoiceNumber) {
      return {
        category: "NO_ORDER_NFE_LINK",
        nonCommissionReason: "CR sem NF/pedido vinculado",
        divergenceReason: "Recebimento financeiro sem cadeia comercial",
      };
    }
    return {
      category: "NO_COMMISSION_RECORD",
      nonCommissionReason: "Sem CommissionRecord/schedule para o título",
      divergenceReason: "Título baixado no financeiro sem comissão calculada",
    };
  }

  const first = commission.rows[0]!;
  if (first.customerNoCommission || !first.isCommissionable) {
    return {
      category: "CUSTOMER_EXCLUDED",
      nonCommissionReason: first.exclusionReason ?? "Cliente excluído de comissão",
      divergenceReason: null,
    };
  }

  if (
    sellerResolution &&
    ["CONFLICT", "MULTIPLE_CANONICALS", "UNRESOLVED"].includes(sellerResolution.resolutionStatus)
  ) {
    return {
      category: "SELLER_AMBIGUOUS",
      nonCommissionReason: sellerResolution.warnings.join("; ") || "Vendedor não consolidado",
      divergenceReason: null,
    };
  }

  if (!first.commissionPersonId && !first.commissionPersonName) {
    return {
      category: "NO_SELLER",
      nonCommissionReason: "Sem vendedor na comissão",
      divergenceReason: null,
    };
  }

  if (commission.expectedCommission <= 0 && commission.commissionableBase > 0) {
    return {
      category: "ZERO_COMMISSION_RULE",
      nonCommissionReason: "Base comissionável com comissão esperada zero",
      divergenceReason: null,
    };
  }

  if (ar.amountReceived > 0 && ar.amountReceived < ar.amountReceivable - 0.02) {
    if (commission.releasedCommission < commission.expectedCommission - 0.02) {
      return {
        category: "PARTIAL_RECEIPT",
        nonCommissionReason: "Recebimento parcial do título",
        divergenceReason: "Liberação parcial de comissão",
      };
    }
  }

  if (commission.releasedCommission >= commission.expectedCommission - 0.02) {
    return {
      category: "COMMISSIONABLE_RELEASED",
      nonCommissionReason: null,
      divergenceReason: null,
    };
  }

  if (commission.releasedCommission > 0) {
    return {
      category: "COMMISSIONABLE_NOT_FULLY_RELEASED",
      nonCommissionReason: "Comissão liberada parcialmente",
      divergenceReason: `Liberado ${commission.releasedCommission} de ${commission.expectedCommission}`,
    };
  }

  return {
    category: "OTHER_TECHNICAL",
    nonCommissionReason: first.alertLabels.join("; ") || "Motivo técnico",
    divergenceReason: null,
  };
}

export function buildArCommissionReconcile(input: {
  year: number;
  month: number;
  periodFrom: Date;
  periodTo: Date;
  arRows: ArReceivableSnapshot[];
  payableRows: VisualAuditRow[];
  payableCards: {
    receivableAmountTotal: number;
    receivedAmountTotal: number;
    commissionableBaseTotal: number;
    commissionExpectedTotal: number;
    commissionReleasedTotal: number;
    commissionPendingTotal: number;
    averageRatePercent: number;
    receivableCount: number;
  };
  identityCtx: CommissionSellerIdentityContext;
  referenceDate?: Date;
}): { summary: ArCommissionReconcileSummary; details: ArCommissionDetailLine[] } {
  const { year, month, periodFrom, periodTo, arRows, payableRows, payableCards, identityCtx } =
    input;
  const referenceDate = input.referenceDate ?? periodTo;

  const arByDue = aggregateArMetrics(
    arRows,
    (row) => inPeriod(row.dueDate, periodFrom, periodTo),
    referenceDate
  );
  const arBySettlement = aggregateArMetrics(
    arRows,
    (row) => inPeriod(row.settlementDate, periodFrom, periodTo),
    referenceDate
  );

  const commissionByReceivable = aggregateCommissionByReceivable(payableRows, identityCtx);
  const settledInPeriod = arRows.filter((row) =>
    inPeriod(row.settlementDate, periodFrom, periodTo)
  );

  const details: ArCommissionDetailLine[] = [];
  const categoryAcc = new Map<ArCommissionBreakdownCategory, { count: number; receivedAmount: number }>();
  const exclusionAcc = new Map<string, { count: number; receivedAmount: number }>();

  let arWithCommissionReceived = 0;

  for (const ar of settledInPeriod) {
    const commission = commissionByReceivable.get(ar.externalId);
    const sellerResolution = commission?.sellerResolution ?? null;
    const { category, nonCommissionReason, divergenceReason } = classifyReceivable(
      ar,
      commission,
      sellerResolution
    );

    const receivedAmount = ar.amountReceived;
    if (commission && commission.releasedCommission > 0) {
      arWithCommissionReceived = roundMoney(arWithCommissionReceived + receivedAmount);
    }

    const catBucket = categoryAcc.get(category) ?? { count: 0, receivedAmount: 0 };
    catBucket.count += 1;
    catBucket.receivedAmount = roundMoney(catBucket.receivedAmount + receivedAmount);
    categoryAcc.set(category, catBucket);

    if (nonCommissionReason) {
      const ex = exclusionAcc.get(nonCommissionReason) ?? { count: 0, receivedAmount: 0 };
      ex.count += 1;
      ex.receivedAmount = roundMoney(ex.receivedAmount + receivedAmount);
      exclusionAcc.set(nonCommissionReason, ex);
    }

    const firstRow = commission?.rows[0];
    details.push({
      receivableId: String(ar.externalId),
      externalReceivableId: ar.externalId,
      customer: ar.personName,
      rawSellerName: firstRow?.commissionPersonName ?? null,
      canonicalSellerName: sellerResolution?.canonicalSellerName ?? firstRow?.commissionPersonName ?? null,
      rawSellerId: null,
      canonicalSellerId: firstRow?.commissionPersonId ?? sellerResolution?.canonicalSellerId ?? null,
      orderCode: firstRow?.orderCode ?? null,
      nfeNumber: firstRow?.nfeNumber ?? ar.sourceInvoiceNumber,
      dueDate: isoDate(ar.dueDate),
      settlementDate: isoDate(ar.settlementDate),
      titleAmount: ar.amountReceivable,
      receivedAmount,
      inArByDueJune: inPeriod(ar.dueDate, periodFrom, periodTo),
      inArBySettlementJune: true,
      inCommissionPayableJune: Boolean(commission && commission.rows.length > 0),
      commissionableBase: commission?.commissionableBase ?? 0,
      expectedCommission: commission?.expectedCommission ?? 0,
      releasedCommission: commission?.releasedCommission ?? 0,
      nonCommissionReason,
      divergenceReason,
      breakdownCategory: category,
      sellerResolutionStatus: sellerResolution?.resolutionStatus ?? null,
    });
  }

  const receivablesWithoutSchedule = settledInPeriod.filter(
    (ar) => !commissionByReceivable.has(ar.externalId)
  ).length;

  const summary: ArCommissionReconcileSummary = {
    year,
    month,
    arByDue,
    arBySettlement,
    commissionPayable: {
      uniqueReceivableCount: payableCards.receivableCount,
      receivableAmountTotal: payableCards.receivableAmountTotal,
      receivedAmountTotal: payableCards.receivedAmountTotal,
      commissionableBaseTotal: payableCards.commissionableBaseTotal,
      expectedCommissionTotal: payableCards.commissionExpectedTotal,
      releasedCommissionTotal: payableCards.commissionReleasedTotal,
      pendingCommissionTotal: payableCards.commissionPendingTotal,
      averageRatePercent: payableCards.averageRatePercent,
      schedulesWithoutAr: 0,
      receivablesWithoutSchedule,
    },
    bridge: {
      arSettlementReceived: arBySettlement.receivedTotal,
      arSettlementWithCommission: arWithCommissionReceived,
      arSettlementWithoutCommission: roundMoney(
        arBySettlement.receivedTotal - arWithCommissionReceived
      ),
      commissionReceivedAmount: payableCards.receivedAmountTotal,
      arVsCommissionReceivedDiff: roundMoney(
        arBySettlement.receivedTotal - payableCards.receivedAmountTotal
      ),
      arVsCommissionBaseDiff: roundMoney(
        arBySettlement.receivedTotal - payableCards.commissionableBaseTotal
      ),
    },
    breakdownByCategory: [...categoryAcc.entries()]
      .map(([category, stats]) => ({
        category,
        count: stats.count,
        receivedAmount: stats.receivedAmount,
        label: CATEGORY_LABELS[category],
      }))
      .sort((a, b) => b.receivedAmount - a.receivedAmount),
    topExclusionReasons: [...exclusionAcc.entries()]
      .map(([reason, stats]) => ({ reason, ...stats }))
      .sort((a, b) => b.receivedAmount - a.receivedAmount)
      .slice(0, 15),
  };

  return { summary, details };
}

export function arCommissionDetailCsvHeader(): string[] {
  return [
    "receivableId",
    "externalReceivableId",
    "cliente",
    "vendedor bruto",
    "vendedor canônico",
    "rawSellerId",
    "canonicalSellerId",
    "pedido",
    "NF",
    "vencimento",
    "settlementDate",
    "valor título",
    "valor recebido",
    "entra no AR por vencimento junho?",
    "entra no AR por baixa junho?",
    "entra na comissão payable junho?",
    "base comissionável",
    "comissão esperada",
    "comissão liberada",
    "motivo se não comissiona",
    "motivo se diverge",
    "categoria",
    "status vendedor",
  ];
}

export function arCommissionDetailToCsvRow(line: ArCommissionDetailLine): unknown[] {
  return [
    line.receivableId,
    line.externalReceivableId,
    line.customer,
    line.rawSellerName,
    line.canonicalSellerName,
    line.rawSellerId,
    line.canonicalSellerId,
    line.orderCode,
    line.nfeNumber,
    line.dueDate,
    line.settlementDate,
    line.titleAmount,
    line.receivedAmount,
    line.inArByDueJune ? "sim" : "não",
    line.inArBySettlementJune ? "sim" : "não",
    line.inCommissionPayableJune ? "sim" : "não",
    line.commissionableBase,
    line.expectedCommission,
    line.releasedCommission,
    line.nonCommissionReason,
    line.divergenceReason,
    line.breakdownCategory,
    line.sellerResolutionStatus,
  ];
}
