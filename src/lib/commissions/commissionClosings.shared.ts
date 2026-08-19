/**
 * Consulta de Fechamentos oficiais — lógica pura (safe para frontend).
 * Fonte: ledger CLOSED (CommissionMonthlyClosing + CommissionReceiptLedgerLine).
 * Agrupa por vendedor canônico (atribuível), sem recálculo.
 */
import { roundMoney } from "./commission-money.shared.js";
import {
  RECEIPT_CLOSING_NO_SELLER_GROUP_KEY,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL,
  type ReceiptClosingApiLine,
  type ReceiptClosingPagePayload,
  type ReceiptClosingSnapshotShared,
} from "./commissionReceiptClosingApi.shared.js";
import {
  formatCommissionClosingPeriodStatus,
  formatCommissionPeriodLabel,
  formatCommissionReceiptLineReason,
  formatCommissionReceiptLineStatus,
} from "./commissionReceiptLineStatusLabels.js";

function round2(n: number): number {
  return roundMoney(n ?? 0);
}

/** Chave de agrupamento para a aba Fechamentos: prioriza vendedor canônico atribuível. */
export function resolveClosingSellerGroupKey(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId?: number | null;
  rawSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
  if (line.canonicalSellerId) return line.canonicalSellerId;
  if (line.status === "CUSTOMER_EXCLUDED" && !line.canonicalSellerId) {
    return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
  }
  if (line.sellerResolutionStatus === "SELLER_UNRESOLVED" && line.rawSellerId != null) {
    return `nomus-unresolved:${line.rawSellerId}`;
  }
  if (line.status === "NO_SELLER" || line.sellerResolutionStatus === "NO_SELLER") {
    return RECEIPT_CLOSING_NO_SELLER_GROUP_KEY;
  }
  if (line.canonicalSellerName?.trim()) return `name:${line.canonicalSellerName.trim().toLowerCase()}`;
  if (line.rawSellerName?.trim()) return `raw:${line.rawSellerName.trim().toLowerCase()}`;
  return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
}

export function resolveClosingSellerDisplayName(line: {
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerName: string | null;
  status: string;
}): string {
  const name = line.canonicalSellerName?.trim() || line.rawSellerName?.trim();
  if (name && !/^vendedor\s*id\s*\d+$/i.test(name)) return name;
  if (line.status === "CUSTOMER_EXCLUDED") return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL;
  if (line.status === "NO_SELLER") return "Sem vendedor";
  return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL;
}

export type CommissionClosingListItem = {
  closingId: string;
  year: number;
  month: number;
  periodLabel: string;
  status: string;
  statusLabel: string;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  totalReceivedAmount: number;
  commissionBaseAmount: number;
  finalCommissionAmount: number;
  excludedCommissionAmount: number;
  lineCount: number;
  sellerCount: number;
  criticalDivergence: boolean;
  calculationHash: string | null;
  notes: string | null;
};

export type CommissionClosingSellerSummary = {
  sellerGroupKey: string;
  sellerId: string | null;
  sellerName: string;
  titleCount: number;
  orderCount: number;
  customerCount: number;
  totalReceivedAmount: number;
  commissionBaseAmount: number;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  finalCommissionAmount: number;
  averageRate: number | null;
  exceptionCount: number;
  primaryStatus: string;
  primaryStatusLabel: string;
};

export type CommissionClosingSellerReportRow = {
  orderCode: string | null;
  customerName: string | null;
  nfeNumber: string | null;
  receivableNumber: string | null;
  installment: number | null;
  receivableDueDate: string | null;
  settlementDate: string | null;
  originalReceivableAmount: number | null;
  receivedGrossAmount: number;
  overpaidAmount: number;
  commissionBaseAmount: number;
  commissionRate: number;
  commissionAmount: number;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  status: string;
  statusLabel: string;
  reasonLabel: string | null;
  lineKey: string;
};

export type CommissionClosingSellerReport = {
  closing: {
    id: string;
    year: number;
    month: number;
    periodLabel: string;
    status: string;
    statusLabel: string;
    closedAt: string | null;
    closedByName: string | null;
    note: string | null;
  };
  seller: {
    id: string | null;
    groupKey: string;
    name: string;
    displayName: string;
  };
  summary: {
    titleCount: number;
    orderCount: number;
    customerCount: number;
    totalReceivedAmount: number;
    commissionBaseAmount: number;
    grossCommissionAmount: number;
    excludedCommissionAmount: number;
    finalCommissionAmount: number;
    averageRate: number | null;
    exceptionCount: number;
  };
  rows: CommissionClosingSellerReportRow[];
  totals: {
    totalReceivedAmount: number;
    commissionBaseAmount: number;
    grossCommissionAmount: number;
    excludedCommissionAmount: number;
    finalCommissionAmount: number;
  };
};

export type CommissionClosingDetailPayload = {
  closing: CommissionClosingListItem;
  cards: {
    totalReceivedAmount: number;
    commissionBaseAmount: number;
    grossCommissionAmount: number;
    excludedCommissionAmount: number;
    finalCommissionAmount: number;
    sellerCount: number;
    titleCount: number;
    criticalDivergence: boolean;
  };
  sellers: CommissionClosingSellerSummary[];
};

function lineGross(line: ReceiptClosingApiLine): number {
  if (line.grossCommissionAmount > 0) return round2(line.grossCommissionAmount);
  if (line.status === "CUSTOMER_EXCLUDED" || line.status === "GROUP_COMPANY_EXCLUDED") {
    return round2(
      line.expectedCommissionAmount > 0
        ? line.expectedCommissionAmount
        : line.releasedCommissionAmount
    );
  }
  return round2(line.releasedCommissionAmount);
}

function lineFinal(line: ReceiptClosingApiLine): number {
  if (line.status === "COMMISSIONABLE") {
    const released = round2(line.releasedCommissionAmount);
    if (released > 0) return released;
    return round2(line.expectedCommissionAmount);
  }
  return 0;
}

function looksLikeRawSellerIdLabel(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return /^vendedor\s*id\s*\d+$/i.test(name.trim());
}

export function buildClosingSellerSummaries(
  lines: ReceiptClosingApiLine[]
): CommissionClosingSellerSummary[] {
  type Acc = CommissionClosingSellerSummary & {
    rateWeight: number;
    rateBase: number;
    statusCounts: Map<string, number>;
    seenReceivables: Set<number | string>;
    seenOrders: Set<string>;
    seenCustomers: Set<string>;
  };
  const map = new Map<string, Acc>();

  for (const line of lines) {
    if (line.status === "GROUP_COMPANY_EXCLUDED") continue;
    const key = resolveClosingSellerGroupKey(line);
    const row =
      map.get(key) ??
      ({
        sellerGroupKey: key,
        sellerId: line.canonicalSellerId,
        sellerName: resolveClosingSellerDisplayName(line),
        titleCount: 0,
        orderCount: 0,
        customerCount: 0,
        totalReceivedAmount: 0,
        commissionBaseAmount: 0,
        grossCommissionAmount: 0,
        excludedCommissionAmount: 0,
        finalCommissionAmount: 0,
        averageRate: null,
        exceptionCount: 0,
        primaryStatus: line.status,
        primaryStatusLabel: formatCommissionReceiptLineStatus(line.status),
        rateWeight: 0,
        rateBase: 0,
        statusCounts: new Map<string, number>(),
        seenReceivables: new Set(),
        seenOrders: new Set(),
        seenCustomers: new Set(),
      } satisfies Acc);

    if (line.canonicalSellerName?.trim() && !looksLikeRawSellerIdLabel(line.canonicalSellerName)) {
      row.sellerName = line.canonicalSellerName.trim();
      row.sellerId = line.canonicalSellerId ?? row.sellerId;
    } else if (
      looksLikeRawSellerIdLabel(row.sellerName) &&
      line.rawSellerName?.trim() &&
      !looksLikeRawSellerIdLabel(line.rawSellerName)
    ) {
      row.sellerName = line.rawSellerName.trim();
    }

    const recvKey =
      line.nomusReceivableId != null
        ? line.nomusReceivableId
        : line.receivableNumber ?? line.lineKey;
    if (!row.seenReceivables.has(recvKey)) {
      row.seenReceivables.add(recvKey);
      row.titleCount += 1;
      row.totalReceivedAmount = round2(row.totalReceivedAmount + line.uniqueReceivedAmount);
    }
    if (line.orderCode?.trim()) row.seenOrders.add(line.orderCode.trim());
    const custKey =
      line.customerId ??
      (line.customerExternalId != null ? `ext:${line.customerExternalId}` : null) ??
      line.customerName?.trim().toLowerCase() ??
      null;
    if (custKey) row.seenCustomers.add(custKey);

    if (line.status === "COMMISSIONABLE") {
      row.commissionBaseAmount = round2(row.commissionBaseAmount + line.commissionableBaseAmount);
      row.grossCommissionAmount = round2(row.grossCommissionAmount + lineGross(line));
      row.finalCommissionAmount = round2(row.finalCommissionAmount + lineFinal(line));
      if (line.commissionableBaseAmount > 0) {
        row.rateWeight += line.ratePercent * line.commissionableBaseAmount;
        row.rateBase += line.commissionableBaseAmount;
      }
    } else if (line.status === "CUSTOMER_EXCLUDED") {
      const g = lineGross(line);
      row.excludedCommissionAmount = round2(row.excludedCommissionAmount + g);
      row.grossCommissionAmount = round2(row.grossCommissionAmount + g);
    } else {
      row.exceptionCount += 1;
    }

    row.statusCounts.set(line.status, (row.statusCounts.get(line.status) ?? 0) + 1);
    map.set(key, row);
  }

  return [...map.values()]
    .map((row) => {
      let primaryStatus = "COMMISSIONABLE";
      let max = -1;
      for (const [status, count] of row.statusCounts) {
        if (count > max) {
          max = count;
          primaryStatus = status;
        }
      }
      return {
        sellerGroupKey: row.sellerGroupKey,
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        titleCount: row.titleCount,
        orderCount: row.seenOrders.size,
        customerCount: row.seenCustomers.size,
        totalReceivedAmount: row.totalReceivedAmount,
        commissionBaseAmount: row.commissionBaseAmount,
        grossCommissionAmount: row.grossCommissionAmount,
        excludedCommissionAmount: row.excludedCommissionAmount,
        finalCommissionAmount: row.finalCommissionAmount,
        averageRate: row.rateBase > 0 ? round2(row.rateWeight / row.rateBase) : null,
        exceptionCount: row.exceptionCount,
        primaryStatus,
        primaryStatusLabel: formatCommissionReceiptLineStatus(primaryStatus),
      };
    })
    .sort(
      (a, b) =>
        b.finalCommissionAmount - a.finalCommissionAmount ||
        a.sellerName.localeCompare(b.sellerName, "pt-BR")
    );
}

export function buildClosingSellerReport(
  lines: ReceiptClosingApiLine[],
  sellerGroupKey: string,
  closing: ReceiptClosingSnapshotShared,
  closedByName: string | null
): CommissionClosingSellerReport | null {
  const filtered = lines.filter(
    (line) =>
      line.status !== "GROUP_COMPANY_EXCLUDED" &&
      resolveClosingSellerGroupKey(line) === sellerGroupKey
  );
  if (filtered.length === 0) return null;

  const summaries = buildClosingSellerSummaries(filtered);
  const seller = summaries[0];
  if (!seller) return null;

  const rows: CommissionClosingSellerReportRow[] = filtered
    .map((line) => {
      const overpaid =
        line.ignoredFinancialChargesAmount != null
          ? round2(line.ignoredFinancialChargesAmount)
          : round2(
              Math.max(
                0,
                line.receivedAmount -
                  (line.receivableOriginalAmount ??
                    line.commissionPrincipalAmount ??
                    line.commissionableBaseAmount)
              )
            );
      const isExcluded = line.status === "CUSTOMER_EXCLUDED";
      const gross = lineGross(line);
      const final = lineFinal(line);
      return {
        orderCode: line.orderCode,
        customerName: line.customerName,
        nfeNumber: line.nfeNumber,
        receivableNumber:
          line.receivableNumber ??
          (line.nomusReceivableId != null ? String(line.nomusReceivableId) : null),
        installment: line.installmentNumber,
        receivableDueDate: line.dueDate,
        settlementDate: line.settlementDate,
        originalReceivableAmount:
          line.receivableOriginalAmount ?? line.commissionPrincipalAmount ?? null,
        receivedGrossAmount: round2(line.uniqueReceivedAmount),
        overpaidAmount: overpaid,
        commissionBaseAmount: round2(line.commissionableBaseAmount),
        commissionRate: round2(line.ratePercent),
        commissionAmount: final,
        grossCommissionAmount: gross,
        excludedCommissionAmount: isExcluded ? gross : 0,
        status: line.status,
        statusLabel: formatCommissionReceiptLineStatus(line.status),
        reasonLabel: formatCommissionReceiptLineReason(
          line.statusReason ?? line.exclusionReason
        ),
        lineKey: line.lineKey,
      };
    })
    .sort((a, b) => {
      const da = a.settlementDate ? Date.parse(a.settlementDate) : 0;
      const db = b.settlementDate ? Date.parse(b.settlementDate) : 0;
      return db - da || (a.orderCode ?? "").localeCompare(b.orderCode ?? "");
    });

  const periodLabel = formatCommissionPeriodLabel(closing.year, closing.month);
  return {
    closing: {
      id: closing.closingId,
      year: closing.year,
      month: closing.month,
      periodLabel,
      status: closing.status,
      statusLabel: formatCommissionClosingPeriodStatus(closing.status),
      closedAt: closing.closedAt,
      closedByName,
      note: closing.notes,
    },
    seller: {
      id: seller.sellerId,
      groupKey: seller.sellerGroupKey,
      name: seller.sellerName,
      displayName: seller.sellerName,
    },
    summary: {
      titleCount: seller.titleCount,
      orderCount: seller.orderCount,
      customerCount: seller.customerCount,
      totalReceivedAmount: seller.totalReceivedAmount,
      commissionBaseAmount: seller.commissionBaseAmount,
      grossCommissionAmount: seller.grossCommissionAmount,
      excludedCommissionAmount: seller.excludedCommissionAmount,
      finalCommissionAmount: seller.finalCommissionAmount,
      averageRate: seller.averageRate,
      exceptionCount: seller.exceptionCount,
    },
    rows,
    totals: {
      totalReceivedAmount: seller.totalReceivedAmount,
      commissionBaseAmount: seller.commissionBaseAmount,
      grossCommissionAmount: seller.grossCommissionAmount,
      excludedCommissionAmount: seller.excludedCommissionAmount,
      finalCommissionAmount: seller.finalCommissionAmount,
    },
  };
}

export function mapClosingListItemFromPage(
  page: ReceiptClosingPagePayload,
  sellerCount: number,
  closedByName: string | null
): CommissionClosingListItem | null {
  if (!page.closing || page.mode !== "CLOSED") return null;
  const c = page.closing;
  return {
    closingId: c.closingId,
    year: c.year,
    month: c.month,
    periodLabel: formatCommissionPeriodLabel(c.year, c.month),
    status: c.status,
    statusLabel: formatCommissionClosingPeriodStatus(c.status),
    closedAt: c.closedAt,
    closedBy: c.closedBy,
    closedByName,
    totalReceivedAmount: round2(page.cards.totalReceivedAmount),
    commissionBaseAmount: round2(page.cards.commissionableBaseAmount),
    finalCommissionAmount: round2(page.cards.finalCommissionAmount),
    excludedCommissionAmount: round2(page.cards.excludedCommissionAmount),
    // page.lines já reflete o escopo do chamador (own/global) — c.lineCount é
    // o total do ledger inteiro e vazaria contagem de outros vendedores.
    lineCount: page.lines.length,
    sellerCount,
    criticalDivergence: page.criticalDivergence,
    calculationHash: c.calculationHash,
    notes: c.notes,
  };
}

export function filterClosingSellerReportRows(
  rows: CommissionClosingSellerReportRow[],
  search: string | null
): CommissionClosingSellerReportRow[] {
  if (!search?.trim()) return rows;
  const needle = search.trim().toLowerCase();
  return rows.filter((r) =>
    [r.orderCode, r.customerName, r.nfeNumber, r.receivableNumber, r.statusLabel, r.reasonLabel]
      .some((v) => v != null && String(v).toLowerCase().includes(needle))
  );
}

export function isCanonicalSellerDisplayName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return !looksLikeRawSellerIdLabel(name) && !/^\d+$/.test(name.trim());
}

export const COMMISSION_CLOSING_SELLER_REPORT_PRINT_TITLE =
  "COMERCIAL: RELATÓRIO DE COMISSÕES";

export const COMMISSION_CLOSING_SELLER_REPORT_PRINT_SUBTITLE =
  "Fechamento por vendedor";

export const COMMISSION_CLOSING_SELLER_REPORT_PRINT_SOURCE =
  "Ledger oficial de comissões";

export const COMMISSION_CLOSING_SELLER_REPORT_PRINT_FOOTER =
  "Documento gerado pelo IndusCost · Ledger oficial de comissões";
