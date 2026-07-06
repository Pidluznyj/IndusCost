/**
 * Drilldown de títulos sem classificação por grupo (fornecedor/causa).
 * Somente leitura — reutiliza listUnclassifiedAccountsPayable e chave de agrupamento da UI.
 */
import {
  classifyFinanceApTitle,
  isFinanceApOpen,
  isFinanceApSettled,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  createDefaultFinanceApAllocationDeps,
  FinanceApAllocationError,
  listUnclassifiedAccountsPayable,
  type BatchAllocationFilters,
  type UnclassifiedCause,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import { resolveAccountsPayableDescriptiveTextWithSource } from "@/src/lib/financeAccountsPayableDescriptiveText.js";
import { FINANCE_AP_STATUS_OPTIONS } from "@/src/lib/financeAccountsPayableDashboardTypes.js";
import { resolveOpenOnlyFromApStatus } from "@/src/lib/financeCostCenterAllocationMetrics.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { resolveUnclassifiedPayableGroupKey } from "@/src/lib/financeUnclassifiedPayablesGrouping.js";
import {
  UNCLASSIFIED_CAUSE_SUGGESTION,
  type UnclassifiedCauseUi,
} from "@/src/lib/financeUnclassifiedPayablesUi.js";
import { prisma } from "@/src/lib/prisma.js";
import type {
  UnclassifiedGroupTitleRow,
  UnclassifiedGroupTitlesAppliedFilters,
  UnclassifiedGroupTitlesPayload,
} from "@/src/lib/financeUnclassifiedGroupTitles.shared.js";

export type UnclassifiedGroupTitlesQuery = {
  groupKey: string;
  cause?: UnclassifiedCause;
  openOnly?: boolean;
  companyName?: string;
  year?: number;
  month?: number;
  status?: string;
  classification?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

const GROUP_TITLE_AP_SELECT = {
  externalId: true,
  personName: true,
  personCnpj: true,
  companyName: true,
  description: true,
  comments: true,
  rawPayload: true,
  documentNumber: true,
  status: true,
  competenceDate: true,
  createdAtNomus: true,
  dueDate: true,
  settlementDate: true,
  paymentDate: true,
  balancePayable: true,
  amountPayable: true,
  suspendPayment: true,
} as const;

type GroupTitleApRow = {
  externalId: number;
  personName: string | null;
  personCnpj: string | null;
  companyName: string | null;
  description: string | null;
  comments: string | null;
  rawPayload: unknown;
  documentNumber: string | null;
  status: boolean | null;
  competenceDate: Date | null;
  createdAtNomus: Date | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  paymentDate: Date | null;
  balancePayable: { toNumber(): number } | null;
  amountPayable: { toNumber(): number } | null;
  suspendPayment: boolean | null;
};

function clampPage(value: number | undefined, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function clampPageSize(value: number | undefined, fallback = 50): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 200);
}

function resolveApStatusLabel(statusKey: string): string {
  const option = FINANCE_AP_STATUS_OPTIONS.find((entry) => entry.value === statusKey);
  return option?.label ?? statusKey;
}

function mapToDashboardRow(row: GroupTitleApRow): FinanceApDashboardRow {
  const balance =
    row.balancePayable != null ? row.balancePayable.toNumber() : null;
  const payable =
    row.amountPayable != null ? row.amountPayable.toNumber() : null;
  return {
    externalId: row.externalId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    companyName: row.companyName,
    documentNumber: row.documentNumber,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    balancePayable: balance,
    amountPayable: payable,
    amountPaid: null,
    suspendPayment: row.suspendPayment,
    status: row.status,
  };
}

function matchesApStatusFilter(
  row: GroupTitleApRow,
  status: string | undefined,
  today: Date
): boolean {
  const normalized = (status ?? "all").trim().toLowerCase();
  if (!normalized || normalized === "all") return true;
  const dashboardRow = mapToDashboardRow(row);
  const classified = classifyFinanceApTitle(dashboardRow, today);
  if (normalized === "open") return isFinanceApOpen(dashboardRow);
  if (normalized === "settled") return isFinanceApSettled(dashboardRow);
  if (normalized === "suspended") return classified === "suspended";
  return classified === normalized;
}

function matchesYearMonth(
  dueDate: Date | null,
  year?: number,
  month?: number
): boolean {
  if (!year && !month) return true;
  if (!dueDate) return false;
  if (year != null && dueDate.getFullYear() !== year) return false;
  if (month != null && dueDate.getMonth() + 1 !== month) return false;
  return true;
}

function resolveIssueDate(row: GroupTitleApRow): string | null {
  return toCivilDateKey(row.competenceDate) ?? toCivilDateKey(row.createdAtNomus);
}

function resolveGroupDisplayName(
  items: Array<{ supplierName: string | null; personName: string | null; externalId: number }>
): string {
  const withSupplier = items.find((item) => item.supplierName?.trim());
  if (withSupplier?.supplierName) return withSupplier.supplierName.trim();
  const withPerson = items.find((item) => item.personName?.trim());
  if (withPerson?.personName) return withPerson.personName.trim();
  return `Grupo (${items.length} título(s))`;
}

export function parseUnclassifiedGroupTitlesQuery(
  raw: Record<string, unknown>
): UnclassifiedGroupTitlesQuery {
  const groupKey = String(raw.groupKey ?? "").trim();
  if (!groupKey) {
    throw new FinanceApAllocationError("INVALID_GROUP_KEY", "groupKey é obrigatório.");
  }

  const status =
    typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : undefined;

  const query: UnclassifiedGroupTitlesQuery = { groupKey };

  if (typeof raw.cause === "string" && raw.cause.trim()) {
    const cause = raw.cause.trim() as UnclassifiedCause;
    query.cause = cause;
  }
  if (typeof raw.companyName === "string" && raw.companyName.trim()) {
    query.companyName = raw.companyName.trim();
  }
  if (raw.openOnly === false || raw.openOnly === "false") {
    query.openOnly = false;
  } else if (raw.openOnly === true || raw.openOnly === "true") {
    query.openOnly = true;
  } else if (status) {
    query.openOnly = resolveOpenOnlyFromApStatus(status);
  }

  const yearRaw = Number(raw.year);
  if (Number.isFinite(yearRaw) && yearRaw > 0) query.year = yearRaw;

  const monthRaw = Number(raw.month);
  if (Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12) query.month = monthRaw;

  if (status) query.status = status;

  if (typeof raw.classification === "string" && raw.classification.trim()) {
    query.classification = raw.classification.trim();
  }
  if (typeof raw.search === "string" && raw.search.trim()) {
    query.search = raw.search.trim();
  }

  query.page = clampPage(Number(raw.page));
  query.pageSize = clampPageSize(Number(raw.pageSize));

  return query;
}

export async function listUnclassifiedGroupTitles(
  query: UnclassifiedGroupTitlesQuery
): Promise<UnclassifiedGroupTitlesPayload> {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const today = new Date();

  const batchFilters: BatchAllocationFilters = {};
  if (query.openOnly === true) batchFilters.openOnly = true;
  if (query.companyName) batchFilters.companyName = query.companyName;

  const deps = createDefaultFinanceApAllocationDeps();
  const unclassified = await listUnclassifiedAccountsPayable(deps, batchFilters);

  let groupItems = unclassified.items.filter(
    (item) => resolveUnclassifiedPayableGroupKey(item) === query.groupKey
  );

  if (query.cause) {
    groupItems = groupItems.filter((item) => item.cause === query.cause);
  }

  const itemByExternalId = new Map(groupItems.map((item) => [item.externalId, item]));
  const externalIds = [...itemByExternalId.keys()];

  if (externalIds.length === 0) {
    return buildEmptyPayload(query, page, pageSize);
  }

  const apRows = await prisma.nomusAccountsPayable.findMany({
    where: { externalId: { in: externalIds } },
    select: GROUP_TITLE_AP_SELECT,
    orderBy: { externalId: "asc" },
  });

  const normalizedSearch = query.search?.trim().toLowerCase() ?? "";

  const filteredRows = apRows.filter((row) => {
    if (!matchesYearMonth(row.dueDate, query.year, query.month)) return false;
    if (!matchesApStatusFilter(row, query.status, today)) return false;
    if (!normalizedSearch) return true;
    const item = itemByExternalId.get(row.externalId);
    const descriptive = resolveAccountsPayableDescriptiveTextWithSource({
      description: row.description,
      comments: row.comments,
      rawPayload: row.rawPayload,
    });
    const haystack = [
      row.documentNumber,
      row.personName,
      row.personCnpj,
      descriptive.text,
      String(row.externalId),
      item?.companyName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = filteredRows.slice(offset, offset + pageSize);

  const supplierDocument =
    groupItems.find((item) => item.personDocument?.trim())?.personDocument?.trim() ?? null;
  const dominantCause = resolveDominantCause(groupItems);
  const supplierName = resolveGroupDisplayName(groupItems);

  const rows: UnclassifiedGroupTitleRow[] = pageRows.map((row) => {
    const item = itemByExternalId.get(row.externalId)!;
    const descriptive = resolveAccountsPayableDescriptiveTextWithSource({
      description: row.description,
      comments: row.comments,
      rawPayload: row.rawPayload,
    });
    const dashboardRow = mapToDashboardRow(row);
    const statusKey = classifyFinanceApTitle(dashboardRow, today);

    return {
      externalId: row.externalId,
      documentNumber: row.documentNumber,
      supplierName: item.supplierName ?? row.personName,
      supplierDocument: item.personDocument ?? row.personCnpj,
      issueDate: resolveIssueDate(row),
      dueDate: toCivilDateKey(row.dueDate),
      settlementDate: toCivilDateKey(row.settlementDate),
      paymentDate: toCivilDateKey(row.paymentDate),
      amount: item.titleAmount,
      status: statusKey,
      statusLabel: resolveApStatusLabel(statusKey),
      cause: item.cause,
      description: descriptive.text,
      rawDescriptionSource: descriptive.source,
    };
  });

  const summaryAmount = filteredRows.reduce((sum, row) => {
    const item = itemByExternalId.get(row.externalId);
    return sum + (item?.titleAmount ?? 0);
  }, 0);

  const appliedFilters: UnclassifiedGroupTitlesAppliedFilters = {
    year: query.year,
    month: query.month,
    companyName: query.companyName,
    status: query.status,
    classification: query.classification,
    cause: query.cause,
    openOnly: query.openOnly,
    search: query.search,
  };

  return {
    group: {
      key: query.groupKey,
      supplierName,
      supplierDocument,
      cause: dominantCause,
      suggestion: dominantCause ? UNCLASSIFIED_CAUSE_SUGGESTION[dominantCause] : "Revisar fornecedor",
    },
    summary: {
      titlesCount: totalRows,
      totalAmount: roundMoney(summaryAmount),
    },
    rows,
    appliedFilters,
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalRows,
    },
  };
}

function resolveDominantCause(
  items: Array<{ cause: UnclassifiedCause }>
): UnclassifiedCauseUi | null {
  if (items.length === 0) return null;
  const counts = new Map<UnclassifiedCause, number>();
  for (const item of items) {
    counts.set(item.cause, (counts.get(item.cause) ?? 0) + 1);
  }
  let best: UnclassifiedCause | null = null;
  let bestCount = 0;
  for (const [cause, count] of counts.entries()) {
    if (count > bestCount) {
      best = cause;
      bestCount = count;
    }
  }
  return best;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function buildEmptyPayload(
  query: UnclassifiedGroupTitlesQuery,
  page: number,
  pageSize: number
): UnclassifiedGroupTitlesPayload {
  return {
    group: {
      key: query.groupKey,
      supplierName: query.groupKey,
      supplierDocument: null,
      cause: query.cause ?? null,
      suggestion: query.cause
        ? UNCLASSIFIED_CAUSE_SUGGESTION[query.cause]
        : "Revisar fornecedor",
    },
    summary: { titlesCount: 0, totalAmount: 0 },
    rows: [],
    appliedFilters: {
      year: query.year,
      month: query.month,
      companyName: query.companyName,
      status: query.status,
      classification: query.classification,
      cause: query.cause,
      openOnly: query.openOnly,
      search: query.search,
    },
    pagination: { page, pageSize, totalPages: 1, totalRows: 0 },
  };
}

export async function listUnclassifiedGroupTitlesDefault(
  query: UnclassifiedGroupTitlesQuery
): Promise<UnclassifiedGroupTitlesPayload> {
  return listUnclassifiedGroupTitles(query);
}
