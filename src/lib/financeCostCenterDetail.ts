import type { Prisma } from "@prisma/client";
import {
  classifyFinanceApTitle,
  decimalFieldToNumber,
  mapPrismaRowToFinanceApDashboardRow,
  parseFinanceApDashboardFilters,
  roundMoney,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import { filterOfficialApTitlesForCostCenter } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import { FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE } from "@/src/lib/financeApAllocationShared.js";
import { isFinanceApCancelledTitle } from "@/src/lib/financeAccountsPayableRules.js";
import {
  isCostCenterTitleInScope,
  resolveCostCenterApScopeFromStatus,
  resolveCostCenterTitleAmount,
  resolveCappedCostCenterAllocationAmount,
  resolveTitleUnallocatedGap,
  type FinanceCostCenterApScope,
} from "@/src/lib/financeCostCenterAllocationMetrics.js";
import type {
  CostCenterExpenseDetailEntry,
  CostCenterExpenseDetailExcludedLine,
  CostCenterExpenseDetailExclusionReason,
  CostCenterExpenseDetailSnapshot,
} from "@/src/lib/financeCostCenterExpenseDetailTypes.js";
import {
  FINANCE_CC_REALLOCATION_AUDIT_ACTION,
  FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT,
  FINANCE_CC_REALLOCATION_REASONS,
  type CostCenterAllocationSource,
  type CostCenterDetailAllocationRow,
  type CostCenterDetailExportPayload,
  type CostCenterDetailListPayload,
  type CostCenterDetailSortDirection,
  type CostCenterDetailSortField,
  type CostCenterDetailSummary,
  type CostCenterReallocationApplyPayload,
  type CostCenterReallocationPreviewItem,
  type CostCenterReallocationPreviewPayload,
  type FinanceCcReallocationReason,
} from "@/src/lib/financeCostCenterDetailShared.js";
import { FinanceCostCenterValidationError } from "@/src/lib/financeCostCenters.js";
import { classificationRuleTypeLabel } from "@/src/lib/financeCostCenterClassificationRuleMatcher.js";
import { FINANCE_CLASSIFICATION_RULE_TYPE_LABEL } from "@/src/lib/financeCostCenterClassificationRulesShared.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceCostCenterDetailError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceCostCenterDetailError";
    this.code = code;
  }
}

export type CostCenterDetailListFilters = FinanceApDashboardFilters & {
  competenceYear?: number;
  competenceMonth?: number;
  supplierId?: string;
  allocationSource?: CostCenterAllocationSource | "all";
  manualOnly?: boolean;
  lockedOnly?: boolean;
  batchOnly?: boolean;
  divergentOnly?: boolean;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  hasPayment?: "all" | "yes" | "no";
  timing?: "all" | "overdue" | "upcoming" | "paid";
  nomusClassification?: string;
  competenceDateFrom?: string;
  competenceDateTo?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
};

export type CostCenterDetailUserContext = {
  userId: string | null;
  userName: string | null;
};

type AllocationWithAp = {
  allocation: {
    id: string;
    accountsPayableId: number;
    supplierId: string | null;
    costCenterId: string;
    amount: Prisma.Decimal | null;
    percentage: Prisma.Decimal;
    source: CostCenterAllocationSource;
    lockedManual: boolean;
    classificationRuleId: string | null;
    classificationRuleType: string | null;
    classificationRuleName: string | null;
    classificationRuleReason: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  ap: FinanceApDashboardRow & {
    classification: string | null;
    comments: string | null;
    competenceDate: Date | null;
  };
  supplierName: string | null;
  costCenterCode: string;
  costCenterName: string;
};

const AP_DETAIL_SELECT = {
  externalId: true,
  companyName: true,
  personName: true,
  personCnpj: true,
  description: true,
  comments: true,
  classification: true,
  dueDate: true,
  competenceDate: true,
  scheduleDate: true,
  type: true,
  settlementDate: true,
  paymentDate: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  documentNumber: true,
  suspendPayment: true,
  status: true,
  syncedAt: true,
} as const;

function finiteMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveAllocatedLineAmount(
  allocation: AllocationWithAp["allocation"],
  titleAmount: number
): number {
  return resolveCappedCostCenterAllocationAmount(
    {
      amount: allocation.amount,
      percentage: allocation.percentage,
    },
    titleAmount
  ).allocatedAmount;
}

function resolveStatusLabel(row: FinanceApDashboardRow, referenceDate: Date): {
  key: string;
  label: string;
} {
  const status = classifyFinanceApTitle(row, referenceDate);
  const labels: Record<string, string> = {
    open: "Em aberto",
    overdue: "Vencido",
    dueToday: "Vence hoje",
    upcoming: "A vencer",
    settled: "Liquidado",
    suspended: "Suspenso",
    unknown: "—",
  };
  return { key: status, label: labels[status] ?? status };
}

function resolveAllocationRuleSourceLabel(entry: AllocationWithAp): string | null {
  if (entry.allocation.classificationRuleType) {
    const typed = entry.allocation.classificationRuleType as keyof typeof FINANCE_CLASSIFICATION_RULE_TYPE_LABEL;
    return FINANCE_CLASSIFICATION_RULE_TYPE_LABEL[typed] ?? classificationRuleTypeLabel(typed as never);
  }
  if (entry.allocation.ruleId) return "Regra por fornecedor";
  if (entry.allocation.source === "MANUAL") return "Manual";
  if (entry.allocation.source === "BATCH") return "Lote";
  return null;
}

export function buildCostCenterDetailAllocationRow(
  entry: AllocationWithAp,
  referenceDate: Date = new Date(),
  apScope: FinanceCostCenterApScope = "open_only",
  allocatedAmountOverride?: number
): CostCenterDetailAllocationRow {
  const titleAmount = resolveCostCenterTitleAmount(entry.ap, apScope);
  const gap = resolveTitleUnallocatedGap(
    [{ amount: entry.allocation.amount, percentage: entry.allocation.percentage }],
    resolveCostCenterTitleAmount(entry.ap, "all_in_filter")
  );
  const allocatedAmount =
    allocatedAmountOverride ??
    resolveAllocatedLineAmount(entry.allocation, titleAmount);
  const status = resolveStatusLabel(entry.ap, referenceDate);

  return {
    allocationId: entry.allocation.id,
    accountsPayableId: entry.ap.externalId,
    companyName: entry.ap.companyName,
    personName: entry.ap.personName,
    personCnpj: entry.ap.personCnpj,
    nomusClassification: entry.ap.classification,
    description: entry.ap.description,
    comments: entry.ap.comments,
    documentNumber: entry.ap.documentNumber,
    sourceInvoiceId: entry.ap.sourceInvoiceId,
    dueDate: isoDate(entry.ap.dueDate),
    competenceDate: isoDate(entry.ap.competenceDate),
    paymentDate: isoDate(entry.ap.paymentDate),
    settlementDate: isoDate(entry.ap.settlementDate),
    statusKey: status.key,
    statusLabel: status.label,
    amountPayable: finiteMoney(Math.abs(entry.ap.amountPayable)),
    balancePayable: finiteMoney(Math.abs(entry.ap.balancePayable)),
    allocatedAmount,
    allocatedPercentage: finiteMoney(decimalFieldToNumber(entry.allocation.percentage)),
    allocationSource: entry.allocation.source,
    lockedManual: entry.allocation.lockedManual,
    allocationRuleSourceLabel: resolveAllocationRuleSourceLabel(entry),
    allocationRuleName: entry.allocation.classificationRuleName,
    allocationRuleType: entry.allocation.classificationRuleType,
    allocationRuleReason:
      entry.allocation.classificationRuleReason ?? entry.allocation.notes,
    costCenterId: entry.allocation.costCenterId,
    costCenterCode: entry.costCenterCode,
    costCenterName: entry.costCenterName,
    supplierId: entry.allocation.supplierId,
    supplierName: entry.supplierName,
    allocationNotes: entry.allocation.notes,
    allocationCreatedAt: entry.allocation.createdAt.toISOString(),
    allocationUpdatedAt: entry.allocation.updatedAt.toISOString(),
    isPartialTitle: gap > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE,
  };
}

function parseIsoDateFilter(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(`${value.trim()}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function rowDateInRange(
  isoDate: string | null,
  from?: string | Date,
  to?: string | Date
): boolean {
  if (!from && !to) return true;
  if (!isoDate) return false;
  const time = new Date(isoDate).getTime();
  const fromTime =
    from instanceof Date ? from.getTime() : parseIsoDateFilter(from)?.getTime();
  const toTime = to instanceof Date ? to.getTime() : parseIsoDateFilter(to)?.getTime();
  if (fromTime != null && time < fromTime) return false;
  if (toTime != null && time > toTime) return false;
  return true;
}

function isPaidAllocationRow(row: CostCenterDetailAllocationRow): boolean {
  return Boolean(
    row.paymentDate ||
      row.settlementDate ||
      row.balancePayable <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE ||
      row.statusKey === "settled"
  );
}

export function matchesCostCenterDetailFilters(
  row: CostCenterDetailAllocationRow,
  filters: CostCenterDetailListFilters,
  referenceDate: Date = new Date()
): boolean {
  if (filters.supplierId && row.supplierId !== filters.supplierId) return false;

  if (filters.allocationSource && filters.allocationSource !== "all") {
    if (row.allocationSource !== filters.allocationSource) return false;
  }
  if (filters.manualOnly && row.allocationSource !== "MANUAL") return false;
  if (filters.lockedOnly && !row.lockedManual) return false;
  if (filters.batchOnly && row.allocationSource !== "BATCH") return false;
  if (filters.divergentOnly && !row.isPartialTitle) return false;

  if (filters.minAmount != null && row.allocatedAmount < filters.minAmount) return false;
  if (filters.maxAmount != null && row.allocatedAmount > filters.maxAmount) return false;

  if (filters.hasPayment === "yes" && !row.paymentDate && !row.settlementDate) return false;
  if (filters.hasPayment === "no" && (row.paymentDate || row.settlementDate)) return false;

  if (filters.timing === "overdue" && row.statusKey !== "overdue") return false;
  if (filters.timing === "upcoming" && row.statusKey !== "upcoming" && row.statusKey !== "dueToday") {
    return false;
  }
  if (filters.timing === "paid" && !isPaidAllocationRow(row)) return false;

  if (filters.nomusClassification?.trim()) {
    const needle = normalizeSearch(filters.nomusClassification);
    if (!normalizeSearch(row.nomusClassification).includes(needle)) return false;
  }

  if (!rowDateInRange(row.dueDate, filters.dueDateFrom, filters.dueDateTo)) return false;
  if (!rowDateInRange(row.competenceDate, filters.competenceDateFrom, filters.competenceDateTo)) {
    return false;
  }
  const paymentIso = row.paymentDate ?? row.settlementDate;
  if (!rowDateInRange(paymentIso, filters.paymentDateFrom, filters.paymentDateTo)) return false;

  if (filters.competenceYear != null) {
    if (!row.competenceDate) return false;
    const d = new Date(row.competenceDate);
    if (d.getFullYear() !== filters.competenceYear) return false;
    if (filters.competenceMonth != null && d.getMonth() + 1 !== filters.competenceMonth) return false;
  }

  const search = normalizeSearch(filters.search);
  if (search) {
    const haystack = [
      row.personName,
      row.companyName,
      row.personCnpj,
      row.description,
      row.comments,
      row.documentNumber,
      row.nomusClassification,
      row.supplierName,
      String(row.accountsPayableId),
    ]
      .map(normalizeSearch)
      .join(" ");
    if (!haystack.includes(search)) return false;
  }

  void referenceDate;
  return true;
}

export function sortCostCenterDetailRows(
  rows: CostCenterDetailAllocationRow[],
  sortBy: CostCenterDetailSortField,
  sortDirection: CostCenterDetailSortDirection
): CostCenterDetailAllocationRow[] {
  const dir = sortDirection === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const compareString = (left: string | null | undefined, right: string | null | undefined) =>
      (left ?? "").localeCompare(right ?? "", "pt-BR", { sensitivity: "base" });
    const compareNumber = (left: number, right: number) => left - right;
    const compareDate = (left: string | null, right: string | null) =>
      (left ? new Date(left).getTime() : 0) - (right ? new Date(right).getTime() : 0);

    let cmp = 0;
    switch (sortBy) {
      case "supplier":
        cmp = compareString(a.personName ?? a.supplierName, b.personName ?? b.supplierName);
        break;
      case "company":
        cmp = compareString(a.companyName, b.companyName);
        break;
      case "dueDate":
        cmp = compareDate(a.dueDate, b.dueDate);
        break;
      case "competenceDate":
        cmp = compareDate(a.competenceDate, b.competenceDate);
        break;
      case "amountPayable":
        cmp = compareNumber(a.amountPayable, b.amountPayable);
        break;
      case "balancePayable":
        cmp = compareNumber(a.balancePayable, b.balancePayable);
        break;
      case "allocatedAmount":
        cmp = compareNumber(a.allocatedAmount, b.allocatedAmount);
        break;
      case "classification":
        cmp = compareString(a.nomusClassification, b.nomusClassification);
        break;
      case "source":
        cmp = compareString(a.allocationSource, b.allocationSource);
        break;
      case "status":
        cmp = compareString(a.statusLabel, b.statusLabel);
        break;
      default:
        cmp = 0;
    }
    if (cmp === 0) cmp = a.accountsPayableId - b.accountsPayableId;
    return cmp * dir;
  });
}

export function paginateRows<T>(rows: T[], page: number, limit: number): {
  items: T[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
} {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const safePage = Math.max(1, page);
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
  const offset = (safePage - 1) * safeLimit;
  return {
    items: rows.slice(offset, offset + safeLimit),
    page: safePage,
    limit: safeLimit,
    totalItems,
    totalPages,
  };
}

export function buildCostCenterDetailSummaryFromRows(
  costCenter: {
    id: string;
    code: string;
    name: string;
    parentId: string | null;
    parentCode: string | null;
    parentName: string | null;
    status: string;
  },
  rows: CostCenterDetailAllocationRow[]
): CostCenterDetailSummary {
  const supplierTotals = new Map<string, { name: string; amount: number }>();
  const classificationTotals = new Map<string, number>();
  const sourceBreakdown = { AUTO_RULE: 0, BATCH: 0, MANUAL: 0 };
  let overdueAmount = 0;
  let upcomingAmount = 0;
  let paidAmount = 0;
  let totalAllocated = 0;
  let lastAllocationUpdateAt: string | null = null;
  const titleIds = new Set<number>();

  for (const row of rows) {
    titleIds.add(row.accountsPayableId);
    totalAllocated += row.allocatedAmount;
    sourceBreakdown[row.allocationSource] += row.allocatedAmount;
    if (row.statusKey === "overdue") overdueAmount += row.allocatedAmount;
    if (row.statusKey === "upcoming" || row.statusKey === "dueToday") {
      upcomingAmount += row.allocatedAmount;
    }
    if (isPaidAllocationRow(row)) paidAmount += row.allocatedAmount;
    if (!lastAllocationUpdateAt || row.allocationUpdatedAt > lastAllocationUpdateAt) {
      lastAllocationUpdateAt = row.allocationUpdatedAt;
    }
    const supplierKey = row.supplierId ?? row.personName ?? `ap:${row.accountsPayableId}`;
    const supplierName = row.supplierName ?? row.personName ?? "—";
    const supplierRow = supplierTotals.get(supplierKey) ?? { name: supplierName, amount: 0 };
    supplierRow.amount += row.allocatedAmount;
    supplierTotals.set(supplierKey, supplierRow);
    if (row.nomusClassification) {
      classificationTotals.set(
        row.nomusClassification,
        (classificationTotals.get(row.nomusClassification) ?? 0) + row.allocatedAmount
      );
    }
  }

  const topSupplier = [...supplierTotals.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;
  const topClassification = [...classificationTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    costCenterId: costCenter.id,
    code: costCenter.code,
    name: costCenter.name,
    parentId: costCenter.parentId,
    parentCode: costCenter.parentCode,
    parentName: costCenter.parentName,
    status: costCenter.status,
    totalAllocatedAmount: finiteMoney(totalAllocated),
    titlesCount: titleIds.size,
    suppliersCount: supplierTotals.size,
    overdueAmount: finiteMoney(overdueAmount),
    upcomingAmount: finiteMoney(upcomingAmount),
    topSupplierName: topSupplier?.name ?? null,
    topSupplierAmount: finiteMoney(topSupplier?.amount ?? 0),
    topNomusClassification: topClassification,
    paidAmount: finiteMoney(paidAmount),
    averageAllocatedPerTitle: finiteMoney(
      titleIds.size > 0 ? totalAllocated / titleIds.size : 0
    ),
    lastAllocationUpdateAt,
    allocationSourceBreakdown: {
      AUTO_RULE: finiteMoney(sourceBreakdown.AUTO_RULE),
      BATCH: finiteMoney(sourceBreakdown.BATCH),
      MANUAL: finiteMoney(sourceBreakdown.MANUAL),
    },
  };
}

function parseReason(value: unknown): FinanceCcReallocationReason {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  const allowed = new Set(FINANCE_CC_REALLOCATION_REASONS.map((r) => r.value));
  if (!allowed.has(raw as FinanceCcReallocationReason)) {
    throw new FinanceCostCenterDetailError("INVALID_REASON", "Motivo de realocação inválido.");
  }
  return raw as FinanceCcReallocationReason;
}

export function parseCostCenterDetailListQuery(
  query: Record<string, unknown>
): CostCenterDetailListFilters & {
  page: number;
  limit: number;
  sortBy: CostCenterDetailSortField;
  sortDirection: CostCenterDetailSortDirection;
} {
  const base = parseFinanceApDashboardFilters(query);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const sortByRaw = typeof query.sortBy === "string" ? query.sortBy.trim() : "dueDate";
  const allowedSort = new Set<CostCenterDetailSortField>([
    "supplier",
    "company",
    "dueDate",
    "competenceDate",
    "amountPayable",
    "balancePayable",
    "allocatedAmount",
    "classification",
    "source",
    "status",
  ]);
  const sortBy = allowedSort.has(sortByRaw as CostCenterDetailSortField)
    ? (sortByRaw as CostCenterDetailSortField)
    : "dueDate";
  const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";
  const parseBool = (key: string) => query[key] === true || query[key] === "true";

  return {
    ...base,
    page,
    limit,
    sortBy,
    sortDirection,
    competenceYear: query.competenceYear ? Number(query.competenceYear) : undefined,
    competenceMonth: query.competenceMonth ? Number(query.competenceMonth) : undefined,
    supplierId: typeof query.supplierId === "string" ? query.supplierId.trim() : undefined,
    allocationSource:
      typeof query.allocationSource === "string" &&
      ["AUTO_RULE", "BATCH", "MANUAL", "all"].includes(query.allocationSource)
        ? (query.allocationSource as CostCenterAllocationSource | "all")
        : undefined,
    manualOnly: parseBool("manualOnly"),
    lockedOnly: parseBool("lockedOnly"),
    batchOnly: parseBool("batchOnly"),
    divergentOnly: parseBool("divergentOnly"),
    minAmount: query.minAmount != null ? Number(query.minAmount) : undefined,
    maxAmount: query.maxAmount != null ? Number(query.maxAmount) : undefined,
    search: typeof query.search === "string" ? query.search : undefined,
    hasPayment:
      query.hasPayment === "yes" || query.hasPayment === "no" ? query.hasPayment : "all",
    timing:
      query.timing === "overdue" || query.timing === "upcoming" || query.timing === "paid"
        ? query.timing
        : "all",
    nomusClassification:
      typeof query.nomusClassification === "string" ? query.nomusClassification : undefined,
    competenceDateFrom:
      typeof query.competenceDateFrom === "string" ? query.competenceDateFrom : undefined,
    competenceDateTo:
      typeof query.competenceDateTo === "string" ? query.competenceDateTo : undefined,
    paymentDateFrom:
      typeof query.paymentDateFrom === "string" ? query.paymentDateFrom : undefined,
    paymentDateTo: typeof query.paymentDateTo === "string" ? query.paymentDateTo : undefined,
  };
}

export function parseCostCenterReallocationBody(body: unknown): {
  allocationIds: string[];
  targetCostCenterId: string;
  reason: FinanceCcReallocationReason;
  reasonNote: string | null;
  confirmManualOverride: boolean;
  manualConfirmationText: string;
} {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new FinanceCostCenterDetailError("INVALID_BODY", "Body inválido.");
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.allocationIds) || record.allocationIds.length === 0) {
    throw new FinanceCostCenterDetailError("MISSING_ALLOCATIONS", "allocationIds é obrigatório.");
  }
  const allocationIds = record.allocationIds
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const targetCostCenterId =
    typeof record.targetCostCenterId === "string" ? record.targetCostCenterId.trim() : "";
  if (!targetCostCenterId) {
    throw new FinanceCostCenterDetailError("MISSING_TARGET", "targetCostCenterId é obrigatório.");
  }
  return {
    allocationIds,
    targetCostCenterId,
    reason: parseReason(record.reason),
    reasonNote:
      typeof record.reasonNote === "string" && record.reasonNote.trim()
        ? record.reasonNote.trim()
        : null,
    confirmManualOverride: record.confirmManualOverride === true,
    manualConfirmationText:
      typeof record.manualConfirmationText === "string" ? record.manualConfirmationText : "",
  };
}

function appendReallocationNote(
  existing: string | null,
  reason: FinanceCcReallocationReason,
  reasonNote: string | null,
  fromLabel: string,
  toLabel: string,
  userName: string | null
): string {
  const reasonLabel =
    FINANCE_CC_REALLOCATION_REASONS.find((r) => r.value === reason)?.label ?? reason;
  const parts = [
    `[Realocação ${new Date().toISOString()}]`,
    `${fromLabel} → ${toLabel}`,
    `Motivo: ${reasonLabel}`,
    reasonNote ? `Obs: ${reasonNote}` : null,
    userName ? `Por: ${userName}` : null,
  ].filter(Boolean);
  const line = parts.join(" | ");
  return existing ? `${existing}\n${line}` : line;
}

export async function loadCostCenterDetailEntries(
  costCenterId: string
): Promise<AllocationWithAp[]> {
  const center = await prisma.financialCostCenter.findUnique({
    where: { id: costCenterId },
    select: { id: true, code: true, name: true },
  });
  if (!center) {
    throw new FinanceCostCenterValidationError("NOT_FOUND", "Centro de custo não encontrado.");
  }

  const allocations = await prisma.accountsPayableCostCenterAllocation.findMany({
    where: { costCenterId },
    orderBy: { updatedAt: "desc" },
  });
  if (allocations.length === 0) return [];

  const externalIds = [...new Set(allocations.map((row) => row.accountsPayableId))];
  const apRows = await prisma.nomusAccountsPayable.findMany({
    where: { externalId: { in: externalIds } },
    select: AP_DETAIL_SELECT,
  });
  const apById = new Map(
    apRows.map((row) => [
      row.externalId,
      {
        ...mapPrismaRowToFinanceApDashboardRow(row),
        classification: row.classification,
        comments: row.comments,
        competenceDate: row.competenceDate,
      },
    ])
  );

  const supplierIds = [
    ...new Set(allocations.map((row) => row.supplierId).filter((id): id is string => Boolean(id))),
  ];
  const suppliers =
    supplierIds.length > 0
      ? await prisma.financialSupplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, displayName: true },
        })
      : [];
  const supplierById = new Map(suppliers.map((row) => [row.id, row.displayName]));

  return allocations
    .map((allocation) => {
      const ap = apById.get(allocation.accountsPayableId);
      if (!ap) return null;
      return {
        allocation: {
          id: allocation.id,
          accountsPayableId: allocation.accountsPayableId,
          supplierId: allocation.supplierId,
          costCenterId: allocation.costCenterId,
          amount: allocation.amount,
          percentage: allocation.percentage,
          source: allocation.source as CostCenterAllocationSource,
          lockedManual: allocation.lockedManual,
          classificationRuleId: allocation.classificationRuleId,
          classificationRuleType: allocation.classificationRuleType,
          classificationRuleName: allocation.classificationRuleName,
          classificationRuleReason: allocation.classificationRuleReason,
          notes: allocation.notes,
          createdAt: allocation.createdAt,
          updatedAt: allocation.updatedAt,
        },
        ap,
        supplierName: allocation.supplierId
          ? (supplierById.get(allocation.supplierId) ?? null)
          : null,
        costCenterCode: center.code,
        costCenterName: center.name,
      } satisfies AllocationWithAp;
    })
    .filter((row): row is AllocationWithAp => row != null);
}

async function loadCostCenterMeta(costCenterId: string) {
  const center = await prisma.financialCostCenter.findUnique({
    where: { id: costCenterId },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
      status: true,
      parent: { select: { id: true, code: true, name: true } },
    },
  });
  if (!center) {
    throw new FinanceCostCenterValidationError("NOT_FOUND", "Centro de custo não encontrado.");
  }
  return {
    id: center.id,
    code: center.code,
    name: center.name,
    parentId: center.parentId,
    parentCode: center.parent?.code ?? null,
    parentName: center.parent?.name ?? null,
    status: center.status,
  };
}

function sumCostCenterDetailRowTotals(rows: CostCenterDetailAllocationRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.allocatedAmount += row.allocatedAmount;
      acc.balancePayable += row.balancePayable;
      acc.amountPayable += row.amountPayable;
      return acc;
    },
    { allocatedAmount: 0, balancePayable: 0, amountPayable: 0 }
  );
}

/** Garante que resumo, totals e linhas usam a mesma base agregada. */
export function buildCostCenterDetailViewFromRows(
  center: Parameters<typeof buildCostCenterDetailSummaryFromRows>[0],
  rows: CostCenterDetailAllocationRow[]
): {
  summary: CostCenterDetailSummary;
  totals: CostCenterDetailListPayload["totals"];
} {
  const summary = buildCostCenterDetailSummaryFromRows(center, rows);
  const totals = sumCostCenterDetailRowTotals(rows);
  const alignedTotals = {
    allocatedAmount: finiteMoney(totals.allocatedAmount),
    balancePayable: finiteMoney(totals.balancePayable),
    amountPayable: finiteMoney(totals.amountPayable),
  };
  return {
    summary: {
      ...summary,
      totalAllocatedAmount: alignedTotals.allocatedAmount,
      titlesCount: new Set(rows.map((row) => row.accountsPayableId)).size,
    },
    totals: alignedTotals,
  };
}

function isApEligibleForCostCenterExpenseDetail(
  ap: FinanceApDashboardRow,
  officialApIds: Set<number>,
  scope: FinanceCostCenterApScope
): { eligible: boolean; reason: CostCenterExpenseDetailExclusionReason | null } {
  if (!officialApIds.has(ap.externalId)) {
    return { eligible: false, reason: "AP_NOT_OFFICIAL" };
  }
  if (isFinanceApCancelledTitle(ap)) {
    return { eligible: false, reason: "AP_CANCELLED" };
  }
  if (!isCostCenterTitleInScope(ap, scope)) {
    return { eligible: false, reason: "AP_OUT_OF_SCOPE" };
  }
  return { eligible: true, reason: null };
}

/** Fonte única: linhas exibíveis do detalhe a partir de AP atual + alocação válida. */
export function buildCostCenterExpenseDetailSnapshot(input: {
  entries: CostCenterExpenseDetailEntry[];
  filters: CostCenterDetailListFilters;
  referenceDate?: Date;
}): CostCenterExpenseDetailSnapshot {
  const referenceDate = input.referenceDate ?? new Date();
  const apScope = resolveCostCenterApScopeFromStatus(input.filters.status);
  const apFilters: FinanceApDashboardFilters = {
    ...input.filters,
    status: input.filters.status ?? "all",
  };
  const officialApRows = filterOfficialApTitlesForCostCenter(
    input.entries.map((entry) => entry.ap),
    apFilters,
    referenceDate
  );
  const officialApIds = new Set(officialApRows.map((row) => row.externalId));

  const displayRows: CostCenterDetailAllocationRow[] = [];
  const excluded: CostCenterExpenseDetailExcludedLine[] = [];
  const overAllocatedLines: CostCenterExpenseDetailSnapshot["audit"]["overAllocatedLines"] =
    [];

  for (const entry of input.entries) {
    const titleAmount = resolveCostCenterTitleAmount(entry.ap, apScope);
    const capped = resolveCappedCostCenterAllocationAmount(entry.allocation, titleAmount);
    const baseExcluded: Omit<CostCenterExpenseDetailExcludedLine, "reason"> = {
      allocationId: entry.allocation.id,
      accountsPayableId: entry.ap.externalId,
      rawAllocatedAmount: capped.rawAllocatedAmount,
      currentTitleAmount: titleAmount,
      personName: entry.ap.personName,
      description: entry.ap.description,
    };

    const eligibility = isApEligibleForCostCenterExpenseDetail(entry.ap, officialApIds, apScope);
    if (isFinanceApCancelledTitle(entry.ap)) {
      excluded.push({ ...baseExcluded, reason: "AP_CANCELLED" });
      continue;
    }
    if (!eligibility.eligible) {
      excluded.push({ ...baseExcluded, reason: eligibility.reason! });
      continue;
    }

    if (capped.staleExcludedAmount > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
      overAllocatedLines.push({
        allocationId: entry.allocation.id,
        accountsPayableId: entry.ap.externalId,
        rawAllocatedAmount: capped.rawAllocatedAmount,
        currentTitleAmount: titleAmount,
        excludedStaleAmount: capped.staleExcludedAmount,
      });
    }

    if (capped.allocatedAmount <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE) {
      excluded.push({
        ...baseExcluded,
        reason:
          titleAmount <= FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE
            ? "ZERO_CURRENT_TITLE"
            : "STALE_ALLOCATION_ONLY",
      });
      continue;
    }

    const row = buildCostCenterDetailAllocationRow(
      entry as AllocationWithAp,
      referenceDate,
      apScope,
      capped.allocatedAmount
    );

    if (!matchesCostCenterDetailFilters(row, input.filters, referenceDate)) {
      excluded.push({ ...baseExcluded, reason: "DETAIL_FILTER" });
      continue;
    }

    displayRows.push(row);
  }

  const totals = displayRows.reduce(
    (acc, row) => {
      acc.allocatedAmount += row.allocatedAmount;
      acc.titleIds.add(row.accountsPayableId);
      return acc;
    },
    { allocatedAmount: 0, titleIds: new Set<number>() }
  );
  const rowTotals = sumCostCenterDetailRowTotals(displayRows);
  const headerAllocatedTotal = finiteMoney(totals.allocatedAmount);

  return {
    apScope,
    displayRows,
    excluded,
    totals: {
      allocatedAmount: headerAllocatedTotal,
      balancePayable: finiteMoney(rowTotals.balancePayable),
      amountPayable: finiteMoney(rowTotals.amountPayable),
      titlesCount: totals.titleIds.size,
    },
    audit: {
      headerAllocatedTotal,
      linesAllocatedSum: headerAllocatedTotal,
      difference: 0,
      orphanAllocations: excluded.filter((line) => line.reason === "ORPHAN_ALLOCATION"),
      staleAllocationAmountExcluded: finiteMoney(
        overAllocatedLines.reduce((sum, line) => sum + line.excludedStaleAmount, 0) +
          excluded
            .filter(
              (line) =>
                line.reason === "STALE_ALLOCATION_ONLY" || line.reason === "ZERO_CURRENT_TITLE"
            )
            .reduce((sum, line) => sum + line.rawAllocatedAmount, 0)
      ),
      cancelledApAllocations: excluded.filter((line) => line.reason === "AP_CANCELLED"),
      overAllocatedLines,
    },
  };
}

export async function loadCostCenterDetailOrphanAllocations(costCenterId: string) {
  const center = await prisma.financialCostCenter.findUnique({
    where: { id: costCenterId },
    select: { id: true, code: true, name: true },
  });
  if (!center) {
    throw new FinanceCostCenterValidationError("NOT_FOUND", "Centro de custo não encontrado.");
  }

  const allocations = await prisma.accountsPayableCostCenterAllocation.findMany({
    where: { costCenterId },
    select: {
      id: true,
      accountsPayableId: true,
      amount: true,
      percentage: true,
      updatedAt: true,
    },
  });
  if (allocations.length === 0) return [];

  const externalIds = [...new Set(allocations.map((row) => row.accountsPayableId))];
  const apRows = await prisma.nomusAccountsPayable.findMany({
    where: { externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const existing = new Set(apRows.map((row) => row.externalId));

  return allocations
    .filter((allocation) => !existing.has(allocation.accountsPayableId))
    .map((allocation) => ({
      allocationId: allocation.id,
      accountsPayableId: allocation.accountsPayableId,
      rawAllocatedAmount: finiteMoney(decimalFieldToNumber(allocation.amount)),
      updatedAt: allocation.updatedAt.toISOString(),
    }));
}

/** Linhas filtradas do detalhe (sem paginação) — base única para grid, resumo e exportação. */
export async function resolveCostCenterDetailFilteredRows(
  costCenterId: string,
  filters: CostCenterDetailListFilters,
  referenceDate: Date = new Date()
): Promise<{
  center: Awaited<ReturnType<typeof loadCostCenterMeta>>;
  rows: CostCenterDetailAllocationRow[];
  summary: CostCenterDetailSummary;
  totals: CostCenterDetailListPayload["totals"];
}> {
  const center = await loadCostCenterMeta(costCenterId);
  const entries = await loadCostCenterDetailEntries(costCenterId);
  const snapshot = buildCostCenterExpenseDetailSnapshot({
    entries: entries as CostCenterExpenseDetailEntry[],
    filters,
    referenceDate,
  });

  const view = buildCostCenterDetailViewFromRows(center, snapshot.displayRows);
  return {
    center,
    rows: snapshot.displayRows,
    summary: view.summary,
    totals: view.totals,
  };
}

export async function buildCostCenterDetailSummaryDefault(
  costCenterId: string,
  filters: CostCenterDetailListFilters,
  referenceDate: Date = new Date()
): Promise<CostCenterDetailSummary> {
  const { summary } = await resolveCostCenterDetailFilteredRows(
    costCenterId,
    filters,
    referenceDate
  );
  return summary;
}

export async function listCostCenterDetailAllocationsDefault(
  costCenterId: string,
  query: ReturnType<typeof parseCostCenterDetailListQuery>,
  referenceDate: Date = new Date()
): Promise<CostCenterDetailListPayload> {
  const { page, limit, sortBy, sortDirection, ...filters } = query;
  const { rows: allRows, summary, totals } = await resolveCostCenterDetailFilteredRows(
    costCenterId,
    filters,
    referenceDate
  );

  const sorted = sortCostCenterDetailRows(allRows, sortBy, sortDirection);
  const pageResult = paginateRows(sorted, page, limit);

  return {
    items: pageResult.items,
    page: pageResult.page,
    limit: pageResult.limit,
    totalItems: pageResult.totalItems,
    totalPages: pageResult.totalPages,
    summary,
    totals,
  };
}

export async function buildCostCenterDetailExportPayloadDefault(
  costCenterId: string,
  query: ReturnType<typeof parseCostCenterDetailListQuery>,
  userContext: CostCenterDetailUserContext,
  referenceDate: Date = new Date(),
  appliedFilters: CostCenterDetailExportPayload["appliedFilters"] = []
): Promise<CostCenterDetailExportPayload> {
  const { sortBy, sortDirection, ...filters } = query;
  const { center, rows: unsorted, summary, totals } = await resolveCostCenterDetailFilteredRows(
    costCenterId,
    filters,
    referenceDate
  );
  const rows = sortCostCenterDetailRows(unsorted, sortBy, sortDirection);

  return {
    generatedAt: new Date().toISOString(),
    center: {
      id: center.id,
      code: center.code,
      name: center.name,
      parentCode: center.parentCode,
      parentName: center.parentName,
    },
    summary,
    rows,
    totals,
    sortBy,
    sortDirection,
    appliedFilters,
    userName: userContext.userName,
  };
}

export async function previewCostCenterReallocationDefault(input: {
  allocationIds: string[];
  targetCostCenterId: string;
  reason: FinanceCcReallocationReason;
  reasonNote: string | null;
  confirmManualOverride: boolean;
}): Promise<CostCenterReallocationPreviewPayload> {
  const target = await prisma.financialCostCenter.findUnique({
    where: { id: input.targetCostCenterId },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!target || target.status !== "ACTIVE") {
    throw new FinanceCostCenterDetailError("INVALID_TARGET", "Centro de destino inválido ou inativo.");
  }

  const allocations = await prisma.accountsPayableCostCenterAllocation.findMany({
    where: { id: { in: input.allocationIds } },
  });
  if (allocations.length === 0) {
    throw new FinanceCostCenterDetailError("NOT_FOUND", "Nenhuma alocação encontrada.");
  }

  const sourceIds = new Set(allocations.map((row) => row.costCenterId));
  if (sourceIds.size !== 1) {
    throw new FinanceCostCenterDetailError(
      "MULTIPLE_SOURCES",
      "Selecione alocações de um único centro de origem."
    );
  }
  const sourceCostCenterId = [...sourceIds][0]!;
  if (sourceCostCenterId === input.targetCostCenterId) {
    throw new FinanceCostCenterDetailError(
      "SAME_TARGET",
      "Centro de destino deve ser diferente do centro de origem."
    );
  }

  const sourceCenter = await loadCostCenterMeta(sourceCostCenterId);
  const sourceLabel = `${sourceCenter.code} — ${sourceCenter.name}`;
  const targetLabel = `${target.code} — ${target.name}`;

  const payableIds = allocations.map((row) => row.accountsPayableId);
  const conflicts = await prisma.accountsPayableCostCenterAllocation.findMany({
    where: {
      accountsPayableId: { in: payableIds },
      costCenterId: input.targetCostCenterId,
    },
    select: { id: true, accountsPayableId: true },
  });
  const conflictByPayable = new Map(conflicts.map((row) => [row.accountsPayableId, row.id]));

  const apRows = await prisma.nomusAccountsPayable.findMany({
    where: { externalId: { in: payableIds } },
    select: AP_DETAIL_SELECT,
  });
  const apById = new Map(apRows.map((row) => [row.externalId, mapPrismaRowToFinanceApDashboardRow(row)]));

  const items: CostCenterReallocationPreviewItem[] = [];
  let skippedManualLocked = 0;
  let skippedManualSource = 0;
  let skippedConflict = 0;
  let wouldMove = 0;
  let totalAmount = 0;
  let requiresManualConfirmation = false;

  for (const allocation of allocations) {
    const ap = apById.get(allocation.accountsPayableId);
    const titleAmount = ap ? resolveCostCenterTitleAmount(ap, "open_only") : 0;
    const amount = resolveAllocatedLineAmount(
      {
        id: allocation.id,
        accountsPayableId: allocation.accountsPayableId,
        supplierId: allocation.supplierId,
        costCenterId: allocation.costCenterId,
        amount: allocation.amount,
        percentage: allocation.percentage,
        source: allocation.source as CostCenterAllocationSource,
        lockedManual: allocation.lockedManual,
        notes: allocation.notes,
        createdAt: allocation.createdAt,
        updatedAt: allocation.updatedAt,
      },
      titleAmount
    );

    let action: "move" | "skip" = "move";
    let skipReason: string | null = null;

    if (allocation.lockedManual) {
      action = "skip";
      skipReason = "Alocação manual bloqueada (lockedManual).";
      skippedManualLocked += 1;
      requiresManualConfirmation = true;
    } else if (allocation.source === "MANUAL" && !input.confirmManualOverride) {
      action = "skip";
      skipReason = "Alocação manual — confirmação especial necessária.";
      skippedManualSource += 1;
      requiresManualConfirmation = true;
    } else if (conflictByPayable.has(allocation.accountsPayableId)) {
      action = "skip";
      skipReason = "Título já possui alocação no centro de destino.";
      skippedConflict += 1;
    }

    if (action === "move") {
      wouldMove += 1;
      totalAmount += amount;
    }

    items.push({
      allocationId: allocation.id,
      accountsPayableId: allocation.accountsPayableId,
      personName: ap?.personName ?? null,
      allocatedAmount: amount,
      source: allocation.source as CostCenterAllocationSource,
      lockedManual: allocation.lockedManual,
      action,
      skipReason,
    });
  }

  const sourceBefore = await prisma.accountsPayableCostCenterAllocation.aggregate({
    where: { costCenterId: sourceCostCenterId },
    _sum: { amount: true },
  });
  const targetBefore = await prisma.accountsPayableCostCenterAllocation.aggregate({
    where: { costCenterId: input.targetCostCenterId },
    _sum: { amount: true },
  });
  const sourceBeforeAmount = finiteMoney(decimalFieldToNumber(sourceBefore._sum.amount));
  const targetBeforeAmount = finiteMoney(decimalFieldToNumber(targetBefore._sum.amount));

  const warnings: string[] = [];
  if (skippedManualLocked > 0) {
    warnings.push(`${skippedManualLocked} alocação(ões) manual bloqueada(s) não serão movidas.`);
  }
  if (skippedManualSource > 0) {
    warnings.push(`${skippedManualSource} alocação(ões) manuais exigem confirmação explícita.`);
  }
  if (skippedConflict > 0) {
    warnings.push(`${skippedConflict} título(s) já possuem alocação no centro de destino.`);
  }

  return {
    sourceCostCenterId,
    sourceCostCenterLabel: sourceLabel,
    targetCostCenterId: input.targetCostCenterId,
    targetCostCenterLabel: targetLabel,
    reason: input.reason,
    reasonNote: input.reasonNote,
    items,
    summary: {
      selected: allocations.length,
      wouldMove,
      skipped: allocations.length - wouldMove,
      skippedManualLocked,
      skippedManualSource,
      skippedConflict,
      totalAmount: finiteMoney(totalAmount),
      sourceAmountBefore: sourceBeforeAmount,
      sourceAmountAfter: finiteMoney(sourceBeforeAmount - totalAmount),
      targetAmountBefore: targetBeforeAmount,
      targetAmountAfter: finiteMoney(targetBeforeAmount + totalAmount),
    },
    warnings,
    requiresManualConfirmation,
    requiredManualConfirmationText: requiresManualConfirmation
      ? FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT
      : null,
  };
}

export async function applyCostCenterReallocationDefault(
  input: ReturnType<typeof parseCostCenterReallocationBody>,
  user: CostCenterDetailUserContext
): Promise<CostCenterReallocationApplyPayload> {
  const preview = await previewCostCenterReallocationDefault(input);
  if (preview.requiresManualConfirmation && !input.confirmManualOverride) {
    throw new FinanceCostCenterDetailError(
      "MANUAL_CONFIRMATION_REQUIRED",
      "Confirmação manual obrigatória para alocações protegidas."
    );
  }
  if (
    preview.requiresManualConfirmation &&
    input.confirmManualOverride &&
    input.manualConfirmationText !== FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT
  ) {
    throw new FinanceCostCenterDetailError(
      "INVALID_MANUAL_CONFIRMATION",
      "Texto de confirmação manual inválido."
    );
  }

  const movable = preview.items.filter((item) => item.action === "move");
  if (movable.length === 0) {
    throw new FinanceCostCenterDetailError("NOTHING_TO_APPLY", "Nenhuma alocação elegível para mover.");
  }

  const result = await prisma.$transaction(async (tx) => {
    let moved = 0;
    let totalMoved = 0;

    for (const item of movable) {
      const allocation = await tx.accountsPayableCostCenterAllocation.findUnique({
        where: { id: item.allocationId },
      });
      if (!allocation) continue;
      if (allocation.lockedManual) continue;
      if (allocation.source === "MANUAL" && !input.confirmManualOverride) continue;

      const conflict = await tx.accountsPayableCostCenterAllocation.findFirst({
        where: {
          accountsPayableId: allocation.accountsPayableId,
          costCenterId: input.targetCostCenterId,
          NOT: { id: allocation.id },
        },
      });
      if (conflict) continue;

      const sourceCenter = await tx.financialCostCenter.findUnique({
        where: { id: allocation.costCenterId },
        select: { code: true, name: true },
      });
      const targetCenter = await tx.financialCostCenter.findUnique({
        where: { id: input.targetCostCenterId },
        select: { code: true, name: true },
      });
      const fromLabel = sourceCenter ? `${sourceCenter.code} — ${sourceCenter.name}` : allocation.costCenterId;
      const toLabel = targetCenter ? `${targetCenter.code} — ${targetCenter.name}` : input.targetCostCenterId;

      const before = {
        costCenterId: allocation.costCenterId,
        amount: allocation.amount,
        percentage: allocation.percentage,
        source: allocation.source,
        lockedManual: allocation.lockedManual,
        notes: allocation.notes,
      };

      const updated = await tx.accountsPayableCostCenterAllocation.update({
        where: { id: allocation.id },
        data: {
          costCenterId: input.targetCostCenterId,
          notes: appendReallocationNote(
            allocation.notes,
            input.reason,
            input.reasonNote,
            fromLabel,
            toLabel,
            user.userName
          ),
        },
      });

      await tx.financialCostCenterAuditLog.create({
        data: {
          entityType: "AccountsPayableCostCenterAllocation",
          entityId: allocation.id,
          action: FINANCE_CC_REALLOCATION_AUDIT_ACTION,
          beforeJson: before,
          afterJson: {
            costCenterId: updated.costCenterId,
            amount: updated.amount,
            percentage: updated.percentage,
            source: updated.source,
            lockedManual: updated.lockedManual,
            notes: updated.notes,
            reason: input.reason,
            reasonNote: input.reasonNote,
          },
          userId: user.userId,
          userName: user.userName,
        },
      });

      moved += 1;
      totalMoved += item.allocatedAmount;
    }

    return { moved, totalMoved: finiteMoney(totalMoved) };
  });

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    moved: result.moved,
    skipped: preview.summary.selected - result.moved,
    totalAmountMoved: result.totalMoved,
    summary: {
      ...preview.summary,
      wouldMove: result.moved,
      skipped: preview.summary.selected - result.moved,
      totalAmount: result.totalMoved,
    },
  };
}
