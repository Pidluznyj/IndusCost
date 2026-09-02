/**
 * Resumo mensal oficial de comissão a pagar por recebimento.
 * Competência = data real do recebimento (receiptDate). `settlementDate` viaja
 * junto apenas como baixa administrativa auditável.
 * Lógica pura — reutiliza linhas da auditoria visual PAYABLE sem recalcular comissão.
 */
import { roundMoney } from "./commission-money.js";
import {
  formatReportSourceCsvHeaders,
  mergeReportWarnings,
  type CommissionReportSourceMeta,
  type CommissionReportSourceMode,
} from "./commissionReportSource.js";
import {
  resolveReceivableUniqueKey,
  type VisualAuditRow,
} from "./commissionVisualAudit.js";

export type CommissionMonthlyPayableQuery = {
  year: number;
  month: number;
  sellerId?: string | null;
  customer?: string | null;
  orderCode?: string | null;
  nfeNumber?: string | null;
  nomusReceivableId?: number | null;
  receivableTitleStatus?: string | null;
  commissionStatus?: string | null;
  onlyDivergences?: boolean;
  nomusReferenceBase?: number | null;
  nomusReferenceCommission?: number | null;
};

export type MonthlyClosingGroupSummary = {
  groupKey: string;
  groupLabel: string;
  lineCount: number;
  receivedTitlesCount: number;
  receivedAmount: number;
  allocatedBaseAmount: number;
  releasedCommissionAmount: number;
  averageCommissionRate: number;
};

export type MonthlyClosingGroupings = {
  bySeller: MonthlyClosingGroupSummary[];
  byCustomer: MonthlyClosingGroupSummary[];
  byNfe: MonthlyClosingGroupSummary[];
  byReceivable: MonthlyClosingGroupSummary[];
  byProduct: MonthlyClosingGroupSummary[];
};

export type MonthlyClosingCards = {
  payableCommissionTotal: number;
  allocatedBaseAmountTotal: number;
  receivedAmountTotal: number;
  uniqueReceivablesCount: number;
  averageCommissionRate: number;
  divergenceCount: number;
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
  reportSource: import("./commissionReportSource.js").CommissionReportDataSource;
  reportStatus: import("./commissionReportSource.js").CommissionReportStatus;
  reportDeprecationNotice: string | null;
  closingId: string | null;
  calculationHash: string | null;
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

function aggregateGroupRows(
  rows: VisualAuditRow[],
  monthKey: string,
  keyFn: (row: VisualAuditRow) => string,
  labelFn: (row: VisualAuditRow) => string
): MonthlyClosingGroupSummary[] {
  const buckets = new Map<string, VisualAuditRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([groupKey, groupRows]) => {
      const agg = aggregateSellerRows(
        groupKey,
        labelFn(groupRows[0]!),
        monthKey,
        groupRows
      );
      return {
        groupKey,
        groupLabel: labelFn(groupRows[0]!),
        lineCount: groupRows.length,
        receivedTitlesCount: agg.receivedTitlesCount,
        receivedAmount: agg.receivedAmount,
        allocatedBaseAmount: agg.allocatedBaseAmount,
        releasedCommissionAmount: agg.releasedCommissionAmount,
        averageCommissionRate: agg.averageCommissionRate,
      };
    })
    .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel, "pt-BR"));
}

export function buildMonthlyClosingGroupings(
  rows: VisualAuditRow[],
  monthKey: string
): MonthlyClosingGroupings {
  return {
    bySeller: aggregateGroupRows(
      rows,
      monthKey,
      (r) => r.commissionPersonId,
      (r) => r.commissionPersonName
    ),
    byCustomer: aggregateGroupRows(
      rows,
      monthKey,
      (r) => r.customerName ?? "—",
      (r) => r.customerName ?? "Sem cliente"
    ),
    byNfe: aggregateGroupRows(
      rows,
      monthKey,
      (r) => nfeKey(r),
      (r) => r.nfeNumber ?? String(r.nomusNfeId ?? "—")
    ),
    byReceivable: aggregateGroupRows(
      rows,
      monthKey,
      (r) => String(r.nomusReceivableId ?? r.scheduleId ?? r.lineId),
      (r) => `CR ${r.nomusReceivableId ?? "—"}`
    ),
    byProduct: aggregateGroupRows(
      rows,
      monthKey,
      (r) => r.productCode ?? "—",
      (r) => r.productCode ?? "Sem produto"
    ),
  };
}

export function buildMonthlyClosingCards(
  summary: CommissionMonthlyPayableSummary,
  divergenceCount: number
): MonthlyClosingCards {
  return {
    payableCommissionTotal: summary.payableCommissionTotal,
    allocatedBaseAmountTotal: summary.allocatedBaseAmountTotal,
    receivedAmountTotal: summary.receivedAmountTotal,
    uniqueReceivablesCount: summary.uniqueReceivablesCount,
    averageCommissionRate: summary.averageCommissionRate,
    divergenceCount,
  };
}

export function aggregateMonthlyPayableFromRows(
  rows: VisualAuditRow[],
  query: CommissionMonthlyPayableQuery
): CommissionMonthlyPayableSummary {
  const monthKey = buildMonthKey(query.year, query.month);
  let filtered = rows;
  if (query.sellerId) {
    filtered = filtered.filter((r) => r.commissionPersonId === query.sellerId);
  }

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
    reportSource: "LEGACY_VISUAL_AUDIT",
    reportStatus: "LEGADO",
    reportDeprecationNotice: null,
    closingId: null,
    calculationHash: null,
  };
}

function csvSummaryHeader(
  summary: CommissionMonthlyPayableSummary,
  meta?: CommissionReportSourceMeta
): string[] {
  const reportMeta: CommissionReportSourceMeta =
    meta ??
    ({
      sourceMode: "auto",
      dataSource: summary.reportSource,
      reportStatus: summary.reportStatus,
      closingId: summary.closingId,
      calculationHash: summary.calculationHash,
      deprecationNotice: summary.reportDeprecationNotice,
      warnings: summary.warnings,
    } satisfies CommissionReportSourceMeta);

  return [
    ...formatReportSourceCsvHeaders(reportMeta),
    `# comissao_a_pagar_mes=${summary.monthKey}`,
    `# total_liberado=${summary.payableCommissionTotal.toFixed(2)}`,
    `# base_rateada=${summary.allocatedBaseAmountTotal.toFixed(2)}`,
    `# valor_recebido=${summary.receivedAmountTotal.toFixed(2)}`,
    `# titulos_recebidos=${summary.uniqueReceivablesCount}`,
    `# percentual_medio=${summary.averageCommissionRate.toFixed(4)}`,
  ];
}

export function enrichMonthlyPayableSummaryWithReportMeta(
  summary: CommissionMonthlyPayableSummary,
  meta: CommissionReportSourceMeta
): CommissionMonthlyPayableSummary {
  return {
    ...summary,
    reportSource: meta.dataSource,
    reportStatus: meta.reportStatus,
    reportDeprecationNotice: meta.deprecationNotice,
    closingId: meta.closingId,
    calculationHash: meta.calculationHash,
    warnings: mergeReportWarnings(meta, summary.warnings),
  };
}

export function resolveLegacyPayableDeprecation(
  summary: CommissionMonthlyPayableSummary,
  sourceMode: CommissionReportSourceMode
): CommissionMonthlyPayableSummary {
  if (summary.reportSource !== "LEGACY_VISUAL_AUDIT") return summary;
  const meta = {
    sourceMode,
    dataSource: "LEGACY_VISUAL_AUDIT" as const,
    reportStatus: "LEGADO" as const,
    closingId: null,
    calculationHash: null,
    deprecationNotice:
      "Este relatório usa cálculo legado (CommissionRecord/CommissionPaymentSchedule). Para pagamento oficial use Fechamento por Recebimento.",
    warnings: [],
  };
  return enrichMonthlyPayableSummaryWithReportMeta(summary, meta);
}

export function buildMonthlyPayableSellerSummaryCsv(
  summary: CommissionMonthlyPayableSummary
): string {
  const lines: string[] = [
    ...csvSummaryHeader(summary),
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

  return lines.join("\n");
}

export function buildMonthlyPayableDetailCsv(summary: CommissionMonthlyPayableSummary): string {
  const lines: string[] = [
    ...csvSummaryHeader(summary),
    "",
    "vendedor,cliente,pedido,nf,produto,cr,parcela,data_nf,vencimento,baixa,valor_recebido,base_rateada,percentual,comissao_liberada,status",
  ];

  for (const d of summary.details) {
    lines.push(
      [
        `"${d.sellerName.replace(/"/g, '""')}"`,
        `"${(d.customerName ?? "").replace(/"/g, '""')}"`,
        d.orderCode ?? "",
        d.nfeNumber ?? "",
        d.productCode ?? "",
        d.nomusReceivableId ?? "",
        d.installmentNumber ?? "",
        d.confirmedAt?.slice(0, 10) ?? "",
        d.dueDate?.slice(0, 10) ?? "",
        d.settlementDate?.slice(0, 10) ?? "",
        d.receivedAmount.toFixed(2),
        d.allocatedBaseAmount.toFixed(2),
        d.itemRatePercent.toFixed(4),
        d.releasedCommissionAmount.toFixed(2),
        d.alerts.length > 0 ? `"${d.alerts.join("; ").replace(/"/g, '""')}"` : "",
      ].join(",")
    );
  }

  return lines.join("\n");
}

/** Resumo por vendedor + detalhe (compatível com script CLI). */
export function buildMonthlyPayableCsv(summary: CommissionMonthlyPayableSummary): string {
  return `${buildMonthlyPayableSellerSummaryCsv(summary)}\n\n${buildMonthlyPayableDetailCsv(summary)}`;
}
