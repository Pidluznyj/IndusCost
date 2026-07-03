/**
 * Resumo mensal oficial de comissão a pagar por recebimento (settlementDate).
 * Lógica pura — reutiliza linhas da auditoria visual PAYABLE sem recalcular comissão.
 */
import { roundMoney } from "./commission-money.js";
import {
  resolveReceivableUniqueKey,
  type VisualAuditRow,
} from "./commissionVisualAudit.js";

export type CommissionMonthlyPayableQuery = {
  year: number;
  month: number;
  sellerId?: string | null;
};

export type CommissionMonthlyPayableDetailLine = {
  lineId: string;
  sellerId: string;
  sellerName: string;
  month: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusNfeId: number | null;
  customerName: string | null;
  productCode: string | null;
  confirmedAt: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  receivedAmount: number;
  receivableAmount: number;
  allocatedBaseAmount: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  pendingCommissionAmount: number;
  itemRatePercent: number;
  alerts: string[];
};

export type CommissionMonthlyPayableSellerSummary = {
  sellerId: string;
  sellerName: string;
  month: string;
  receivedTitlesCount: number;
  uniqueReceivablesCount: number;
  uniqueOrdersCount: number;
  uniqueNfeCount: number;
  uniqueCustomersCount: number;
  receivedAmount: number;
  allocatedBaseAmount: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  pendingCommissionAmount: number;
  averageCommissionRate: number;
  receivedVsBaseDiff: number;
  warnings: string[];
};

export type CommissionMonthlyPayableSummary = {
  year: number;
  month: number;
  monthKey: string;
  monthLabelPt: string;
  payableCommissionTotal: number;
  receivedAmountTotal: number;
  allocatedBaseAmountTotal: number;
  expectedCommissionAmountTotal: number;
  pendingCommissionAmountTotal: number;
  uniqueReceivablesCount: number;
  uniqueSellersCount: number;
  averageCommissionRate: number;
  receivedVsBaseDiff: number;
  warnings: string[];
  sellers: CommissionMonthlyPayableSellerSummary[];
  details: CommissionMonthlyPayableDetailLine[];
};

const PT_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function buildMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatMonthLabelPt(year: number, month: number): string {
  const name = PT_MONTHS[month - 1] ?? String(month);
  return `${name}/${year}`;
}

function nfeKey(row: VisualAuditRow): string {
  const nf = row.nomusNfeId ?? row.nfeNumber ?? "—";
  return `${row.commissionPersonId}:${nf}`;
}

function collectWarnings(rows: VisualAuditRow[]): string[] {
  const warnings = new Set<string>();
  for (const row of rows) {
    for (const label of row.alertLabels) {
      warnings.add(label);
    }
    if (row.receivedAmount > 0 && row.allocatedBaseAmount > 0) {
      const diff = roundMoney(row.receivedAmount - row.allocatedBaseAmount);
      if (Math.abs(diff) > 0.02) {
        warnings.add(
          `CR ${row.nomusReceivableId ?? "?"}: valor recebido (${row.receivedAmount.toFixed(2)}) difere da base rateada (${row.allocatedBaseAmount.toFixed(2)})`
        );
      }
    }
  }
  return [...warnings];
}

function aggregateSellerRows(
  sellerId: string,
  sellerName: string,
  monthKey: string,
  rows: VisualAuditRow[]
): CommissionMonthlyPayableSellerSummary {
  const receivableKeys = new Set<string>();
  const scheduleKeys = new Set<string>();
  const orderKeys = new Set<string>();
  const nfeKeys = new Set<string>();
  const customerKeys = new Set<string>();

  let receivedAmount = 0;
  let allocatedBaseAmount = 0;
  let expectedCommissionAmount = 0;
  let releasedCommissionAmount = 0;
  let pendingCommissionAmount = 0;

  for (const row of rows) {
    const receivableKey = resolveReceivableUniqueKey(row);
    if (receivableKey && !receivableKeys.has(receivableKey)) {
      receivableKeys.add(receivableKey);
      receivedAmount = roundMoney(receivedAmount + row.receivedAmount);
    }

    const scheduleKey = row.scheduleId ?? row.lineId;
    if (!scheduleKeys.has(scheduleKey)) {
      scheduleKeys.add(scheduleKey);
      allocatedBaseAmount = roundMoney(allocatedBaseAmount + row.allocatedBaseAmount);
      expectedCommissionAmount = roundMoney(
        expectedCommissionAmount + row.commissionExpected
      );
      releasedCommissionAmount = roundMoney(
        releasedCommissionAmount + row.commissionReleased
      );
      pendingCommissionAmount = roundMoney(
        pendingCommissionAmount + row.commissionPending
      );
    }

    if (row.orderCode) orderKeys.add(row.orderCode);
    nfeKeys.add(nfeKey(row));
    if (row.customerName) customerKeys.add(row.customerName);
  }

  const averageCommissionRate =
    allocatedBaseAmount > 0
      ? roundMoney((releasedCommissionAmount / allocatedBaseAmount) * 100)
      : 0;

  return {
    sellerId,
    sellerName,
    month: monthKey,
    receivedTitlesCount: receivableKeys.size,
    uniqueReceivablesCount: receivableKeys.size,
    uniqueOrdersCount: orderKeys.size,
    uniqueNfeCount: nfeKeys.size,
    uniqueCustomersCount: customerKeys.size,
    receivedAmount,
    allocatedBaseAmount,
    expectedCommissionAmount,
    releasedCommissionAmount,
    pendingCommissionAmount,
    averageCommissionRate,
    receivedVsBaseDiff: roundMoney(receivedAmount - allocatedBaseAmount),
    warnings: collectWarnings(rows),
  };
}

export function mapRowToPayableDetail(
  row: VisualAuditRow,
  monthKey: string
): CommissionMonthlyPayableDetailLine {
  return {
    lineId: row.lineId,
    sellerId: row.commissionPersonId,
    sellerName: row.commissionPersonName,
    month: monthKey,
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    nomusNfeId: row.nomusNfeId,
    customerName: row.customerName,
    productCode: row.productCode,
    confirmedAt: row.confirmedAt,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    receivedAmount: row.receivedAmount,
    receivableAmount: row.receivableAmount,
    allocatedBaseAmount: row.allocatedBaseAmount,
    expectedCommissionAmount: row.commissionExpected,
    releasedCommissionAmount: row.commissionReleased,
    pendingCommissionAmount: row.commissionPending,
    itemRatePercent: row.itemRatePercent,
    alerts: row.alertLabels,
  };
}

export function aggregateMonthlyPayableFromRows(
  rows: VisualAuditRow[],
  query: CommissionMonthlyPayableQuery
): CommissionMonthlyPayableSummary {
  const monthKey = buildMonthKey(query.year, query.month);
  const filtered = query.sellerId
    ? rows.filter((r) => r.commissionPersonId === query.sellerId)
    : rows;

  const bySeller = new Map<string, VisualAuditRow[]>();
  for (const row of filtered) {
    const bucket = bySeller.get(row.commissionPersonId) ?? [];
    bucket.push(row);
    bySeller.set(row.commissionPersonId, bucket);
  }

  const sellers = [...bySeller.entries()]
    .map(([sellerId, sellerRows]) =>
      aggregateSellerRows(
        sellerId,
        sellerRows[0]?.commissionPersonName ?? sellerId,
        monthKey,
        sellerRows
      )
    )
    .sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR"));

  const globalReceivableKeys = new Set<string>();
  let receivedAmountTotal = 0;
  let allocatedBaseAmountTotal = 0;
  let expectedCommissionAmountTotal = 0;
  let payableCommissionTotal = 0;
  let pendingCommissionAmountTotal = 0;

  for (const seller of sellers) {
    allocatedBaseAmountTotal = roundMoney(
      allocatedBaseAmountTotal + seller.allocatedBaseAmount
    );
    expectedCommissionAmountTotal = roundMoney(
      expectedCommissionAmountTotal + seller.expectedCommissionAmount
    );
    payableCommissionTotal = roundMoney(
      payableCommissionTotal + seller.releasedCommissionAmount
    );
    pendingCommissionAmountTotal = roundMoney(
      pendingCommissionAmountTotal + seller.pendingCommissionAmount
    );
  }

  for (const row of filtered) {
    const receivableKey = resolveReceivableUniqueKey(row);
    if (receivableKey && !globalReceivableKeys.has(receivableKey)) {
      globalReceivableKeys.add(receivableKey);
      receivedAmountTotal = roundMoney(receivedAmountTotal + row.receivedAmount);
    }
  }

  const averageCommissionRate =
    allocatedBaseAmountTotal > 0
      ? roundMoney((payableCommissionTotal / allocatedBaseAmountTotal) * 100)
      : 0;

  const warnings = collectWarnings(filtered);

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
    uniqueReceivablesCount: globalReceivableKeys.size,
    uniqueSellersCount: sellers.length,
    averageCommissionRate,
    receivedVsBaseDiff: roundMoney(receivedAmountTotal - allocatedBaseAmountTotal),
    warnings,
    sellers,
    details: filtered.map((row) => mapRowToPayableDetail(row, monthKey)),
  };
}

export function buildMonthlyPayableCsv(summary: CommissionMonthlyPayableSummary): string {
  const lines: string[] = [
    `# comissao_a_pagar_mes=${summary.monthKey}`,
    `# total_liberado=${summary.payableCommissionTotal}`,
    `# base_rateada=${summary.allocatedBaseAmountTotal}`,
    `# valor_recebido=${summary.receivedAmountTotal}`,
    "",
    "vendedor,titulos_recebidos,valor_recebido,base_rateada,comissao_esperada,comissao_liberada,comissao_pendente,percentual_medio",
  ];

  for (const seller of summary.sellers) {
    lines.push(
      [
        `"${seller.sellerName.replace(/"/g, '""')}"`,
        seller.receivedTitlesCount,
        seller.receivedAmount.toFixed(2),
        seller.allocatedBaseAmount.toFixed(2),
        seller.expectedCommissionAmount.toFixed(2),
        seller.releasedCommissionAmount.toFixed(2),
        seller.pendingCommissionAmount.toFixed(2),
        seller.averageCommissionRate.toFixed(4),
      ].join(",")
    );
  }

  if (summary.details.length > 0) {
    lines.push("");
    lines.push(
      "detalhe_vendedor,cr,parcela,nf,pedido,cliente,baixa,valor_recebido,base_rateada,comissao_liberada"
    );
    for (const d of summary.details) {
      lines.push(
        [
          `"${d.sellerName.replace(/"/g, '""')}"`,
          d.nomusReceivableId ?? "",
          d.installmentNumber ?? "",
          d.nfeNumber ?? "",
          d.orderCode ?? "",
          `"${(d.customerName ?? "").replace(/"/g, '""')}"`,
          d.settlementDate?.slice(0, 10) ?? "",
          d.receivedAmount.toFixed(2),
          d.allocatedBaseAmount.toFixed(2),
          d.releasedCommissionAmount.toFixed(2),
        ].join(",")
      );
    }
  }

  return lines.join("\n");
}
