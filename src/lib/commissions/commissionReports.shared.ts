/**
 * Relatórios de comissão — tipos e lógica pura (seguro para frontend).
 * Fonte oficial: linhas do ledger de Fechamento por recebimento (settlementDate).
 */
import * as XLSX from "xlsx";
import { roundMoney } from "./commission-money.shared.js";
import {
  RECEIPT_CLOSING_NO_SELLER_GROUP_KEY,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY,
  RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL,
  resolveReceiptClosingSellerGroupKey,
  type ReceiptClosingApiLine,
} from "./commissionReceiptClosingApi.shared.js";
import {
  COMMISSION_SOURCE_MISMATCH_STATUS,
  lineFinalCommissionForDiagnosis,
} from "./commissionReportOfficialReconcile.js";

export const COMMISSION_REPORTS_UNRESOLVED_SELLER_KEY = "unresolved" as const;
export const COMMISSION_REPORTS_NO_SELLER_KEY = "no-seller" as const;

export const COMMISSION_REPORT_ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type CommissionReportPeriodStatus = "CLOSED" | "PREVIEW";

/** `all` = janeiro–dezembro; array = meses específicos (1–12). */
export type CommissionReportsMonthsFilter = number[] | "all";

export type CommissionReportsQuery = {
  year: number;
  months: CommissionReportsMonthsFilter;
  sellerId: string | "all";
  status: string | "all";
  search: string | null;
  page: number;
  pageSize: number;
};

export function resolveCommissionReportMonths(
  months: CommissionReportsMonthsFilter
): number[] {
  if (months === "all") return [...COMMISSION_REPORT_ALL_MONTHS];
  const unique = [...new Set(months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))];
  return unique.sort((a, b) => a - b);
}

export function isCommissionReportAllMonths(months: CommissionReportsMonthsFilter): boolean {
  if (months === "all") return true;
  const resolved = resolveCommissionReportMonths(months);
  return (
    resolved.length === 12 &&
    COMMISSION_REPORT_ALL_MONTHS.every((m, idx) => resolved[idx] === m)
  );
}

const MONTH_FILE_SLUGS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

export function formatCommissionReportMonthsLabel(
  months: CommissionReportsMonthsFilter
): string {
  if (isCommissionReportAllMonths(months)) return "Todos os meses";
  const resolved = resolveCommissionReportMonths(months);
  if (resolved.length === 0) return "Todos os meses";
  const labels = resolved.map((m) => {
    const full = [
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
    ][m - 1];
    return full ?? String(m);
  });
  if (labels.length <= 2) return labels.join(", ");
  if (labels.length === 3) return labels.join(", ");
  return `${labels.length} meses selecionados`;
}

export type CommissionReportRecord = {
  lineKey: string;
  year: number;
  month: number;
  settlementDate: string | null;
  periodStatus: CommissionReportPeriodStatus;
  closingId: string | null;
  sellerGroupKey: string;
  sellerId: string | null;
  sellerName: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  orderCode: string | null;
  /** UUID do SalesOrder local, quando resolvido de forma única e confiável. */
  localOrderId: string | null;
  /** Origem do vínculo pedido↔título (auditoria). */
  linkResolutionSource:
    | import("./commissionSalesOrderNfeLinkResolution.js").CommissionOrderLinkResolutionSource
    | null;
  linkResolutionStatus:
    | import("./commissionSalesOrderNfeLinkResolution.js").CommissionOrderLinkResolutionStatus
    | null;
  nfeNumber: string | null;
  receivableNumber: string | null;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  receivedAmount: number;
  uniqueReceivedAmount: number;
  commissionableBaseAmount: number;
  /** null = percentual não auditável (linha reconciliada pelo snapshot sem percentual derivável). */
  ratePercent: number | null;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  finalCommissionAmount: number;
  lineStatus: string;
  statusReason: string | null;
  exclusionReason: string | null;
  isCustomerExcluded: boolean;
  isGroupCompany: boolean;
  isSellerUnresolved: boolean;
  isNoSeller: boolean;
  isZeroCommission: boolean;
  isPayable: boolean;
  /** Linha diverge do CommissionOrderSnapshot oficial (schedule zerado / desatualizado). */
  divergesFromOrderSnapshot: boolean;
  source: string;
};

export type CommissionReportSellerRow = {
  sellerGroupKey: string;
  sellerId: string | null;
  sellerName: string;
  recordCount: number;
  receivedAmount: number;
  commissionableBase: number;
  grossCommission: number;
  excludedCommission: number;
  finalCommission: number;
  avgRatePercent: number | null;
  primaryStatus: string;
};

export type CommissionReportSummary = {
  totalCommission: number;
  commissionableBase: number;
  receivedAmount: number;
  recordCount: number;
  sellerCount: number;
  excludedCustomerCount: number;
  groupCompanyExcludedCount: number;
  unresolvedSellerCount: number;
  excludedCommission: number;
  closedMonthCount: number;
  previewMonthCount: number;
};

export type CommissionReportSellerOption = {
  value: string;
  label: string;
};

export type CommissionReportsPayload = {
  summary: CommissionReportSummary;
  sellers: CommissionReportSellerRow[];
  records: CommissionReportRecord[];
  sellerOptions: CommissionReportSellerOption[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filtersApplied: {
    year: number;
    months: CommissionReportsMonthsFilter;
    sellerId: string | "all";
    status: string | "all";
    search: string | null;
  };
  monthsIncluded: Array<{
    year: number;
    month: number;
    periodStatus: CommissionReportPeriodStatus;
    closingId: string | null;
  }>;
};

export type CommissionReportSourceLine = Omit<ReceiptClosingApiLine, "ratePercent"> & {
  /** null = percentual não auditável (nunca inventar 0% ao reconciliar com o snapshot oficial). */
  ratePercent: number | null;
  year: number;
  month: number;
  periodStatus: CommissionReportPeriodStatus;
  closingId: string | null;
};

function round2(n: number): number {
  return roundMoney(n);
}

function lineGross(line: ReceiptClosingApiLine): number {
  if (line.grossCommissionAmount > 0) return round2(line.grossCommissionAmount);
  if (line.status === "COMMISSIONABLE") {
    const released = round2(line.releasedCommissionAmount);
    return released > 0 ? released : round2(line.expectedCommissionAmount);
  }
  if (line.status === COMMISSION_SOURCE_MISMATCH_STATUS) {
    return round2(line.expectedCommissionAmount);
  }
  // Proteção: legado NO_MARGIN com expected já reconciliado.
  if (
    (line.status === "NO_MARGIN" || line.status === "ZERO_AMOUNT") &&
    line.expectedCommissionAmount > 0.009
  ) {
    return round2(line.expectedCommissionAmount);
  }
  return 0;
}

function lineFinalCommission(line: ReceiptClosingApiLine): number {
  const diagnosed = lineFinalCommissionForDiagnosis({
    status: line.status,
    expectedCommissionAmount: line.expectedCommissionAmount,
    releasedCommissionAmount: line.releasedCommissionAmount,
    grossCommissionAmount: line.grossCommissionAmount,
  });
  if (diagnosed > 0) return diagnosed;
  // COMMISSIONABLE com release 0 ainda pode ter expected (prévia).
  if (line.status === "COMMISSIONABLE" && line.expectedCommissionAmount > 0.009) {
    return round2(line.expectedCommissionAmount);
  }
  if (
    (line.status === "NO_MARGIN" || line.status === "ZERO_AMOUNT") &&
    line.expectedCommissionAmount > 0.009
  ) {
    return round2(line.expectedCommissionAmount);
  }
  return 0;
}

export function resolveCommissionReportSellerLabel(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId?: number | null;
  rawSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
  if (line.status === "CUSTOMER_EXCLUDED") {
    return (
      line.canonicalSellerName?.trim() ||
      line.rawSellerName?.trim() ||
      RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL
    );
  }
  const key = resolveReceiptClosingSellerGroupKey(line);
  if (key === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY) {
    return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL;
  }
  if (key === RECEIPT_CLOSING_NO_SELLER_GROUP_KEY) {
    return "Sem vendedor";
  }
  if (line.sellerResolutionStatus === "SELLER_UNRESOLVED") {
    return line.rawSellerName?.trim() || "Vendedor não resolvido";
  }
  return (
    line.canonicalSellerName?.trim() ||
    line.rawSellerName?.trim() ||
    "Vendedor não resolvido"
  );
}

export function mapSourceLineToReportRecord(line: CommissionReportSourceLine): CommissionReportRecord {
  const sellerGroupKey = resolveReceiptClosingSellerGroupKey(line);
  const isCustomerExcluded = line.status === "CUSTOMER_EXCLUDED";
  const isGroupCompany = line.status === "GROUP_COMPANY_EXCLUDED";
  const isSellerUnresolved =
    line.status === "SELLER_UNRESOLVED" || line.sellerResolutionStatus === "SELLER_UNRESOLVED";
  const isNoSeller =
    line.status === "NO_SELLER" || line.sellerResolutionStatus === "NO_SELLER";
  const gross = lineGross(line);
  const excluded = isCustomerExcluded || isGroupCompany ? gross : 0;
  const final = lineFinalCommission(line);
  const divergesFromOrderSnapshot =
    line.status === COMMISSION_SOURCE_MISMATCH_STATUS ||
    line.source === "ORDER_SNAPSHOT" ||
    line.source === "RECEIVABLE_SCHEDULE" ||
    (line.statusReason ?? "").includes("COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT") ||
    (line.statusReason ?? "").includes("snapshot do pedido diverge");

  return {
    lineKey: line.lineKey,
    year: line.year,
    month: line.month,
    settlementDate: line.settlementDate,
    periodStatus: line.periodStatus,
    closingId: line.closingId,
    sellerGroupKey,
    sellerId: line.canonicalSellerId,
    sellerName: resolveCommissionReportSellerLabel(line),
    customerId: line.customerId,
    customerExternalId: line.customerExternalId,
    customerName: line.customerName,
    orderCode: line.orderCode,
    localOrderId: line.localOrderId,
    linkResolutionSource: line.linkResolutionSource ?? null,
    linkResolutionStatus: line.linkResolutionStatus ?? null,
    nfeNumber: line.nfeNumber,
    receivableNumber: line.receivableNumber,
    nomusReceivableId: line.nomusReceivableId,
    installmentNumber: line.installmentNumber,
    receivedAmount: round2(line.receivedAmount),
    uniqueReceivedAmount: round2(line.uniqueReceivedAmount),
    commissionableBaseAmount: round2(line.commissionableBaseAmount),
    ratePercent: line.ratePercent == null ? null : round2(line.ratePercent),
    grossCommissionAmount: gross,
    excludedCommissionAmount: excluded,
    finalCommissionAmount: final,
    lineStatus: line.status,
    statusReason: line.statusReason,
    exclusionReason: line.exclusionReason,
    isCustomerExcluded,
    isGroupCompany,
    isSellerUnresolved,
    isNoSeller,
    isZeroCommission: final === 0 && gross === 0,
    isPayable: line.status === "COMMISSIONABLE" && final > 0,
    divergesFromOrderSnapshot,
    source: line.source,
  };
}

export function matchesCommissionReportSellerFilter(
  record: CommissionReportRecord,
  sellerId: string | "all"
): boolean {
  if (sellerId === "all" || !sellerId) return true;
  if (sellerId === COMMISSION_REPORTS_UNRESOLVED_SELLER_KEY) {
    return record.isSellerUnresolved || record.sellerGroupKey.startsWith("nomus-unresolved:");
  }
  if (sellerId === COMMISSION_REPORTS_NO_SELLER_KEY) {
    return record.isNoSeller || record.sellerGroupKey === RECEIPT_CLOSING_NO_SELLER_GROUP_KEY;
  }
  if (sellerId === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY) {
    return record.sellerGroupKey === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
  }
  return record.sellerId === sellerId || record.sellerGroupKey === sellerId;
}

export function matchesCommissionReportStatusFilter(
  record: CommissionReportRecord,
  status: string | "all"
): boolean {
  if (status === "all" || !status) return true;
  const normalized = status.trim().toUpperCase();
  if (normalized === "CLOSED" || normalized === "PREVIEW") {
    return record.periodStatus === normalized;
  }
  return record.lineStatus === normalized;
}

export function matchesCommissionReportSearch(
  record: CommissionReportRecord,
  search: string | null
): boolean {
  if (!search?.trim()) return true;
  const needle = search.trim().toLowerCase();
  const haystacks = [
    record.customerName,
    record.orderCode,
    record.nfeNumber,
    record.receivableNumber,
    record.nomusReceivableId != null ? String(record.nomusReceivableId) : null,
    record.sellerName,
    record.lineKey,
  ];
  return haystacks.some((v) => v != null && String(v).toLowerCase().includes(needle));
}

export function filterCommissionReportRecords(
  records: CommissionReportRecord[],
  query: Pick<CommissionReportsQuery, "sellerId" | "status" | "search">
): CommissionReportRecord[] {
  return records.filter(
    (r) =>
      matchesCommissionReportSellerFilter(r, query.sellerId) &&
      matchesCommissionReportStatusFilter(r, query.status) &&
      matchesCommissionReportSearch(r, query.search)
  );
}

export function buildCommissionReportSellerRows(
  records: CommissionReportRecord[]
): CommissionReportSellerRow[] {
  type Acc = CommissionReportSellerRow & {
    rateWeightSum: number;
    rateBaseSum: number;
    statusCounts: Map<string, number>;
    seenReceivables: Set<number>;
  };
  const map = new Map<string, Acc>();

  for (const record of records) {
    if (record.isGroupCompany) continue;
    const isUnassignedBucket =
      record.sellerGroupKey === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
    const row =
      map.get(record.sellerGroupKey) ??
      ({
        sellerGroupKey: record.sellerGroupKey,
        sellerId: isUnassignedBucket ? null : record.sellerId,
        sellerName: isUnassignedBucket
          ? RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL
          : record.sellerName,
        recordCount: 0,
        receivedAmount: 0,
        commissionableBase: 0,
        grossCommission: 0,
        excludedCommission: 0,
        finalCommission: 0,
        avgRatePercent: null,
        primaryStatus: record.lineStatus,
        rateWeightSum: 0,
        rateBaseSum: 0,
        statusCounts: new Map<string, number>(),
        seenReceivables: new Set<number>(),
      } satisfies Acc);

    row.recordCount += 1;
    if (record.nomusReceivableId != null) {
      if (!row.seenReceivables.has(record.nomusReceivableId)) {
        row.seenReceivables.add(record.nomusReceivableId);
        row.receivedAmount = round2(row.receivedAmount + record.receivedAmount);
      }
    } else {
      row.receivedAmount = round2(row.receivedAmount + record.uniqueReceivedAmount);
    }

    if (record.isPayable || record.lineStatus === "COMMISSIONABLE") {
      row.commissionableBase = round2(row.commissionableBase + record.commissionableBaseAmount);
      row.grossCommission = round2(row.grossCommission + record.grossCommissionAmount);
      row.finalCommission = round2(row.finalCommission + record.finalCommissionAmount);
      if (record.commissionableBaseAmount > 0 && record.ratePercent != null) {
        row.rateWeightSum += record.ratePercent * record.commissionableBaseAmount;
        row.rateBaseSum += record.commissionableBaseAmount;
      }
    }
    if (record.isCustomerExcluded) {
      row.excludedCommission = round2(row.excludedCommission + record.excludedCommissionAmount);
      row.grossCommission = round2(row.grossCommission + record.grossCommissionAmount);
    }

    row.statusCounts.set(record.lineStatus, (row.statusCounts.get(record.lineStatus) ?? 0) + 1);
    map.set(record.sellerGroupKey, row);
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
        recordCount: row.recordCount,
        receivedAmount: row.receivedAmount,
        commissionableBase: row.commissionableBase,
        grossCommission: row.grossCommission,
        excludedCommission: row.excludedCommission,
        finalCommission: row.finalCommission,
        avgRatePercent:
          row.rateBaseSum > 0 ? round2(row.rateWeightSum / row.rateBaseSum) : null,
        primaryStatus,
      };
    })
    .sort((a, b) => b.finalCommission - a.finalCommission || a.sellerName.localeCompare(b.sellerName));
}

export function buildCommissionReportSummary(
  records: CommissionReportRecord[],
  sellers: CommissionReportSellerRow[],
  monthsIncluded: CommissionReportsPayload["monthsIncluded"]
): CommissionReportSummary {
  /** Totais monetários = mesma base do "Resumo por vendedor" (sem cálculo paralelo). */
  let totalCommission = 0;
  let commissionableBase = 0;
  let receivedAmount = 0;
  let excludedCommission = 0;
  for (const seller of sellers) {
    totalCommission = round2(totalCommission + seller.finalCommission);
    commissionableBase = round2(commissionableBase + seller.commissionableBase);
    receivedAmount = round2(receivedAmount + seller.receivedAmount);
    excludedCommission = round2(excludedCommission + seller.excludedCommission);
  }

  let excludedCustomerCount = 0;
  let groupCompanyExcludedCount = 0;
  let unresolvedSellerCount = 0;
  const excludedCustomerKeys = new Set<string>();
  for (const record of records) {
    if (record.isCustomerExcluded) {
      const key =
        (record.customerId ? `id:${record.customerId}` : null) ||
        (record.customerExternalId != null ? `ext:${record.customerExternalId}` : null) ||
        (record.customerName?.trim()
          ? `name:${record.customerName.trim().toLowerCase()}`
          : null) ||
        record.lineKey;
      if (!excludedCustomerKeys.has(key)) {
        excludedCustomerKeys.add(key);
        excludedCustomerCount += 1;
      }
    }
    if (record.isGroupCompany) groupCompanyExcludedCount += 1;
    if (record.isSellerUnresolved || record.isNoSeller) unresolvedSellerCount += 1;
  }

  return {
    totalCommission,
    commissionableBase,
    receivedAmount,
    recordCount: records.length,
    sellerCount: sellers.length,
    excludedCustomerCount,
    groupCompanyExcludedCount,
    unresolvedSellerCount,
    excludedCommission,
    closedMonthCount: monthsIncluded.filter((m) => m.periodStatus === "CLOSED").length,
    previewMonthCount: monthsIncluded.filter((m) => m.periodStatus === "PREVIEW").length,
  };
}

export function buildCommissionReportSellerOptions(
  sellers: CommissionReportSellerRow[]
): CommissionReportSellerOption[] {
  const options: CommissionReportSellerOption[] = [
    { value: "all", label: "Todos os vendedores" },
    { value: COMMISSION_REPORTS_NO_SELLER_KEY, label: "Sem vendedor" },
    { value: COMMISSION_REPORTS_UNRESOLVED_SELLER_KEY, label: "Vendedor não resolvido" },
  ];
  const seen = new Set(options.map((o) => o.value));
  for (const seller of sellers) {
    const value = seller.sellerId ?? seller.sellerGroupKey;
    if (seen.has(value)) continue;
    if (
      value === RECEIPT_CLOSING_NO_SELLER_GROUP_KEY ||
      value === RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY ||
      value.startsWith("nomus-unresolved:")
    ) {
      continue;
    }
    seen.add(value);
    options.push({ value, label: seller.sellerName });
  }
  return options;
}

export function paginateCommissionReportRecords(
  records: CommissionReportRecord[],
  page: number,
  pageSize: number
): { records: CommissionReportRecord[]; pagination: CommissionReportsPayload["pagination"] } {
  const total = records.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
  const start = (safePage - 1) * pageSize;
  return {
    records: records.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
}

export function buildEmptyCommissionReportsPayload(
  query: CommissionReportsQuery
): CommissionReportsPayload {
  return {
    summary: {
      totalCommission: 0,
      commissionableBase: 0,
      receivedAmount: 0,
      recordCount: 0,
      sellerCount: 0,
      excludedCustomerCount: 0,
      groupCompanyExcludedCount: 0,
      unresolvedSellerCount: 0,
      excludedCommission: 0,
      closedMonthCount: 0,
      previewMonthCount: 0,
    },
    sellers: [],
    records: [],
    sellerOptions: [
      { value: "all", label: "Todos os vendedores" },
      { value: COMMISSION_REPORTS_NO_SELLER_KEY, label: "Sem vendedor" },
      { value: COMMISSION_REPORTS_UNRESOLVED_SELLER_KEY, label: "Vendedor não resolvido" },
    ],
    pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
    filtersApplied: {
      year: query.year,
      months: query.months,
      sellerId: query.sellerId,
      status: query.status,
      search: query.search,
    },
    monthsIncluded: [],
  };
}

export function assembleCommissionReportsPayload(
  sourceLines: CommissionReportSourceLine[],
  query: CommissionReportsQuery,
  monthsIncluded: CommissionReportsPayload["monthsIncluded"]
): CommissionReportsPayload {
  const allRecords = sourceLines.map(mapSourceLineToReportRecord);
  const filtered = filterCommissionReportRecords(allRecords, query).sort((a, b) => {
    const da = a.settlementDate ? Date.parse(a.settlementDate) : 0;
    const db = b.settlementDate ? Date.parse(b.settlementDate) : 0;
    if (db !== da) return db - da;
    if (b.month !== a.month) return b.month - a.month;
    return a.lineKey.localeCompare(b.lineKey);
  });
  const sellers = buildCommissionReportSellerRows(filtered);
  const summary = buildCommissionReportSummary(filtered, sellers, monthsIncluded);
  const sellerOptions = buildCommissionReportSellerOptions(
    buildCommissionReportSellerRows(allRecords)
  );
  const paged = paginateCommissionReportRecords(filtered, query.page, query.pageSize);

  return {
    summary,
    sellers,
    records: paged.records,
    sellerOptions,
    pagination: paged.pagination,
    filtersApplied: {
      year: query.year,
      months: query.months,
      sellerId: query.sellerId,
      status: query.status,
      search: query.search,
    },
    monthsIncluded,
  };
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function formatCurrencyBr(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildCommissionReportsExportWorkbook(input: {
  sellers: CommissionReportSellerRow[];
  records: CommissionReportRecord[];
  year: number;
  months: CommissionReportsMonthsFilter;
  summary?: CommissionReportSummary;
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const sellerRows = [
    [
      "Vendedor",
      "Registros",
      "Valor recebido",
      "Base comissionável",
      "Comissão bruta",
      "Comissão excluída",
      "Comissão final",
      "% médio",
      "Status principal",
    ],
    ...input.sellers.map((s) => [
      s.sellerName,
      s.recordCount,
      s.receivedAmount,
      s.commissionableBase,
      s.grossCommission,
      s.excludedCommission,
      s.finalCommission,
      s.avgRatePercent ?? "",
      s.primaryStatus,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sellerRows), "Resumo por vendedor");

  const detailRows = [
    [
      "Ano",
      "Mês",
      "Data recebimento",
      "Vendedor",
      "Cliente",
      "Pedido",
      "NF-e",
      "CR / título",
      "Valor recebido",
      "Base comissionável",
      "Comissão %",
      "Comissão bruta R$",
      "Comissão excluída R$",
      "Comissão final R$",
      "Status período",
      "Status linha",
      "Cliente excluído (regra)",
      "Empresa do grupo",
      "Sem vendedor",
      "Motivo",
    ],
    ...input.records.map((r) => [
      r.year,
      r.month,
      formatDateBr(r.settlementDate),
      r.sellerName,
      r.customerName ?? "",
      r.orderCode ?? "",
      r.nfeNumber ?? "",
      r.receivableNumber ?? (r.nomusReceivableId != null ? String(r.nomusReceivableId) : ""),
      r.receivedAmount,
      r.commissionableBaseAmount,
      r.ratePercent ?? "",
      r.grossCommissionAmount,
      r.excludedCommissionAmount,
      r.finalCommissionAmount,
      r.periodStatus,
      r.lineStatus,
      r.isCustomerExcluded ? "Sim" : "Não",
      r.isGroupCompany ? "Sim" : "Não",
      r.isNoSeller || r.isSellerUnresolved ? "Sim" : "Não",
      r.statusReason ?? r.exclusionReason ?? "",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Registros detalhados");

  const summary = input.summary;
  const meta = XLSX.utils.aoa_to_sheet([
    ["Relatório de comissões"],
    ["Ano", input.year],
    ["Meses", formatCommissionReportMonthsLabel(input.months)],
    ["Gerado em", new Date().toISOString()],
    [
      "Observação",
      "Valores oficiais do ledger/prévia de Fechamento (settlementDate). Clientes não comissionáveis (Exceções por cliente) são zerados e identificados.",
    ],
    ["Clientes excluídos (únicos)", summary?.excludedCustomerCount ?? ""],
    ["Comissão excluída por regra", summary?.excludedCommission ?? ""],
    ["Empresas do grupo", summary?.groupCompanyExcludedCount ?? ""],
    [
      "Comissão total formatada (amostra)",
      formatCurrencyBr(input.sellers.reduce((acc, s) => acc + s.finalCommission, 0)),
    ],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, "Filtros");

  return wb;
}

export function buildCommissionReportsExportFilename(
  year: number,
  months: CommissionReportsMonthsFilter
): string {
  if (isCommissionReportAllMonths(months)) {
    return `comissao-relatorio-${year}-todos-os-meses.xlsx`;
  }
  const resolved = resolveCommissionReportMonths(months);
  if (resolved.length === 0) {
    return `comissao-relatorio-${year}-todos-os-meses.xlsx`;
  }
  if (resolved.length <= 3) {
    const slugs = resolved.map((m) => MONTH_FILE_SLUGS[m - 1] ?? String(m));
    return `comissao-relatorio-${year}-${slugs.join("-")}.xlsx`;
  }
  return `comissao-relatorio-${year}-${resolved.length}-meses.xlsx`;
}
