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

export const COMMISSION_REPORTS_UNRESOLVED_SELLER_KEY = "unresolved" as const;
export const COMMISSION_REPORTS_NO_SELLER_KEY = "no-seller" as const;

export type CommissionReportPeriodStatus = "CLOSED" | "PREVIEW";

export type CommissionReportsQuery = {
  year: number;
  month: number | "all";
  sellerId: string | "all";
  status: string | "all";
  search: string | null;
  page: number;
  pageSize: number;
};

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
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  receivableNumber: string | null;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
  receivedAmount: number;
  uniqueReceivedAmount: number;
  commissionableBaseAmount: number;
  ratePercent: number;
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
    month: number | "all";
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

export type CommissionReportSourceLine = ReceiptClosingApiLine & {
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
  if (line.status === "COMMISSIONABLE") return round2(line.releasedCommissionAmount);
  return 0;
}

export function resolveCommissionReportSellerLabel(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
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
  const final = line.status === "COMMISSIONABLE" ? round2(line.releasedCommissionAmount) : 0;

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
    customerName: line.customerName,
    orderCode: line.orderCode,
    nfeNumber: line.nfeNumber,
    receivableNumber: line.receivableNumber,
    nomusReceivableId: line.nomusReceivableId,
    installmentNumber: line.installmentNumber,
    receivedAmount: round2(line.receivedAmount),
    uniqueReceivedAmount: round2(line.uniqueReceivedAmount),
    commissionableBaseAmount: round2(line.commissionableBaseAmount),
    ratePercent: round2(line.ratePercent),
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
    const row =
      map.get(record.sellerGroupKey) ??
      ({
        sellerGroupKey: record.sellerGroupKey,
        sellerId: record.sellerId,
        sellerName: record.sellerName,
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
      if (record.commissionableBaseAmount > 0) {
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
  const seenReceivables = new Set<number>();
  let receivedAmount = 0;
  let commissionableBase = 0;
  let totalCommission = 0;
  let excludedCommission = 0;
  let excludedCustomerCount = 0;
  let groupCompanyExcludedCount = 0;
  let unresolvedSellerCount = 0;

  for (const record of records) {
    if (record.nomusReceivableId != null) {
      if (!seenReceivables.has(record.nomusReceivableId)) {
        seenReceivables.add(record.nomusReceivableId);
        receivedAmount = round2(receivedAmount + record.receivedAmount);
      }
    } else {
      receivedAmount = round2(receivedAmount + record.uniqueReceivedAmount);
    }
    if (record.lineStatus === "COMMISSIONABLE") {
      commissionableBase = round2(commissionableBase + record.commissionableBaseAmount);
      totalCommission = round2(totalCommission + record.finalCommissionAmount);
    }
    if (record.isCustomerExcluded) {
      excludedCommission = round2(excludedCommission + record.excludedCommissionAmount);
      excludedCustomerCount += 1;
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
      month: query.month,
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
  const filtered = filterCommissionReportRecords(allRecords, query);
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
      month: query.month,
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
  month: number | "all";
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
      "Comissão R$",
      "Status período",
      "Status linha",
      "Cliente excluído",
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
      r.ratePercent,
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

  const meta = XLSX.utils.aoa_to_sheet([
    ["Relatório de comissões"],
    ["Ano", input.year],
    ["Mês", input.month === "all" ? "Todos" : input.month],
    ["Gerado em", new Date().toISOString()],
    ["Observação", "Valores oficiais do ledger de Fechamento (settlementDate). Exclusões identificadas."],
    ["Comissão total formatada (amostra)", formatCurrencyBr(
      input.sellers.reduce((acc, s) => acc + s.finalCommission, 0)
    )],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, "Filtros");

  return wb;
}

export function buildCommissionReportsExportFilename(
  year: number,
  month: number | "all"
): string {
  const monthPart = month === "all" ? "todos-meses" : String(month).padStart(2, "0");
  return `comissao-relatorio-${year}-${monthPart}.xlsx`;
}
