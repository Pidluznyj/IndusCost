import type { FinanceArTitleListItem, FinanceArTitlesQuery } from "./financeAccountsReceivableTitles.js";
import {
  buildOfficialAccountsReceivableRulesResult,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildFinanceArTitlesPayload,
  isFinanceArHorizonTitlesQuery,
  parseFinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import type {
  AccountsReceivableOpenHorizon,
  AccountsReceivableOpenHorizonBucketKey,
} from "./financeAccountsReceivableHorizon.js";
import {
  resolveFinanceAgingBucketMeta,
  type FinanceAgingBucketSelectionMeta,
} from "./financeDashboardAgingBuckets.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { roundHorizonMoney } from "./financeHorizonBuckets.js";

export type FinanceArHorizonAppliedFilterLine = {
  label: string;
  value: string;
};

export type FinanceArHorizonExportSummary = {
  totalOpenBalance: number;
  titlesCount: number;
  overdueAmount: number;
  upcomingAmount: number;
  maxTitleAmount: number;
  averageTicket: number;
  topCustomerName: string | null;
};

export type FinanceArHorizonExportTitleRow = FinanceArTitleListItem & {
  bucketLabel?: string;
};

export type FinanceArHorizonExportPayload = {
  generatedAt: string;
  operationalBaseDate: string;
  scope: "bucket" | "full";
  bucket?: FinanceAgingBucketSelectionMeta;
  horizon: Pick<
    AccountsReceivableOpenHorizon,
    "title" | "subtitle" | "scopeNote" | "overdueNote" | "today"
  >;
  summary: FinanceArHorizonExportSummary;
  bucketSummaries: Array<{ key: string; label: string; amount: number; titlesCount: number }>;
  appliedFilters: FinanceArHorizonAppliedFilterLine[];
  items: FinanceArHorizonExportTitleRow[];
  bucketTotals?: { openBalanceAmount: number; titlesCount: number };
  userName: string | null;
};

export function parseFinanceArHorizonExportQuery(
  query: Record<string, unknown>
): FinanceArTitlesQuery & { scope: "bucket" | "full" } {
  const scopeRaw = typeof query.scope === "string" ? query.scope.trim() : "bucket";
  const scope = scopeRaw === "full" ? "full" : "bucket";
  const parsed = parseFinanceArTitlesQuery({
    ...query,
    page: "1",
    limit: "50000",
  });
  if (scope === "full") {
    return { ...parsed, agingBucket: undefined, scope: "full" };
  }
  if (!parsed.agingBucket || !isFinanceArHorizonTitlesQuery(parsed)) {
    throw new FinanceArHorizonExportError("MISSING_BUCKET", "Faixa do horizonte é obrigatória.");
  }
  return { ...parsed, scope: "bucket" };
}

export class FinanceArHorizonExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceArHorizonExportError";
    this.code = code;
  }
}

function summarizeHorizonItems(items: FinanceArHorizonExportTitleRow[]): FinanceArHorizonExportSummary {
  let totalOpenBalance = 0;
  let overdueAmount = 0;
  let upcomingAmount = 0;
  let maxTitleAmount = 0;
  const customerTotals = new Map<string, number>();

  for (const item of items) {
    totalOpenBalance += item.balanceReceivable;
    if (item.daysOverdue > 0 || item.calculatedStatus === "overdue") {
      overdueAmount += item.balanceReceivable;
    } else {
      upcomingAmount += item.balanceReceivable;
    }
    if (item.balanceReceivable > maxTitleAmount) maxTitleAmount = item.balanceReceivable;
    const customer = item.personName?.trim() || "Sem cliente";
    customerTotals.set(customer, (customerTotals.get(customer) ?? 0) + item.balanceReceivable);
  }

  const titlesCount = items.length;
  const topCustomerName =
    [...customerTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    totalOpenBalance: roundHorizonMoney(totalOpenBalance),
    titlesCount,
    overdueAmount: roundHorizonMoney(overdueAmount),
    upcomingAmount: roundHorizonMoney(upcomingAmount),
    maxTitleAmount: roundHorizonMoney(maxTitleAmount),
    averageTicket: titlesCount > 0 ? roundHorizonMoney(totalOpenBalance / titlesCount) : 0,
    topCustomerName: topCustomerName === "Sem cliente" ? null : topCustomerName,
  };
}

function buildBucketSummaries(
  horizon: AccountsReceivableOpenHorizon
): FinanceArHorizonExportPayload["bucketSummaries"] {
  return [horizon.overdue, ...horizon.buckets, horizon.total60].map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    amount: bucket.amount,
    titlesCount: bucket.titlesCount,
  }));
}

function mapHorizonTitleToExportRow(
  title: AccountsReceivableOpenHorizon["titlesByBucket"][AccountsReceivableOpenHorizonBucketKey][number],
  bucketLabel: string,
  rowsByExternalId: Map<number, FinanceArDashboardRow>,
  referenceDate: Date
): FinanceArHorizonExportTitleRow | null {
  const row = rowsByExternalId.get(title.externalId);
  if (!row) return null;
  const query: FinanceArTitlesQuery = {
    page: 1,
    limit: 1,
    sortBy: "dueDate",
    sortDirection: "asc",
    filters: { status: "all" },
    extended: {},
    localFilter: "all",
    agingBucket: title.bucketKey,
  };
  const payload = buildFinanceArTitlesPayload([row], query, referenceDate);
  const item = payload.items[0];
  if (!item) return null;
  return { ...item, bucketLabel };
}

export function buildFinanceArHorizonAppliedFilterLines(input: {
  scope: "bucket" | "full";
  bucket?: FinanceAgingBucketSelectionMeta;
  search?: string;
  customerName?: string;
}): FinanceArHorizonAppliedFilterLine[] {
  const lines: FinanceArHorizonAppliedFilterLine[] = [];
  lines.push({
    label: "Faixa",
    value: input.scope === "full" ? "Todas as faixas" : (input.bucket?.label ?? "—"),
  });
  lines.push({
    label: "Cliente",
    value: input.customerName?.trim() || "Todos",
  });
  lines.push({
    label: "Escopo",
    value: "Carteira aberta global (ignora filtros de mês/ano da página)",
  });
  lines.push({ label: "Busca", value: input.search?.trim() || "—" });
  return lines;
}

export function buildFinanceArHorizonExportPayloadFromRows(
  rows: FinanceArDashboardRow[],
  syncCutoff: NomusArReportSyncCutoff | null,
  query: ReturnType<typeof parseFinanceArHorizonExportQuery>,
  userContext: { userName: string | null },
  referenceDate: Date = new Date()
): FinanceArHorizonExportPayload {
  const horizon = buildOfficialAccountsReceivableRulesResult({
    rows,
    referenceDate,
    syncCutoff,
    horizonSourceRows: rows,
  }).horizon;
  const rowsByExternalId = new Map(rows.map((row) => [row.externalId, row]));

  let items: FinanceArHorizonExportTitleRow[];
  let bucket: FinanceAgingBucketSelectionMeta | undefined;
  let bucketTotals: FinanceArHorizonExportPayload["bucketTotals"];

  if (query.scope === "full") {
    const bucketOrder: AccountsReceivableOpenHorizonBucketKey[] = [
      "overdue",
      "0_7",
      "8_15",
      "16_30",
      "31_45",
      "46_60",
    ];
    items = [];
    for (const key of bucketOrder) {
      const label = resolveFinanceAgingBucketMeta(key).label;
      for (const title of horizon.titlesByBucket[key]) {
        const mapped = mapHorizonTitleToExportRow(title, label, rowsByExternalId, referenceDate);
        if (mapped) items.push(mapped);
      }
    }
  } else {
    bucket = resolveFinanceAgingBucketMeta(query.agingBucket!);
    const exportPayload = buildFinanceArTitlesPayload(rows, query, referenceDate, syncCutoff);
    const allPayload = buildFinanceArTitlesPayload(
      rows,
      { ...query, limit: Math.max(exportPayload.total, 1) },
      referenceDate,
      syncCutoff
    );
    items = allPayload.items;
    bucketTotals = allPayload.bucketTotals;
  }

  const summary = summarizeHorizonItems(items);
  const customerName =
    query.extended.customerName?.trim() ||
    (typeof query.extended.customerId === "number"
      ? items.find((item) => item.personId === query.extended.customerId)?.personName ?? undefined
      : undefined);
  const appliedFilters = buildFinanceArHorizonAppliedFilterLines({
    scope: query.scope,
    bucket,
    search: query.search,
    customerName,
  });

  return {
    generatedAt: referenceDate.toISOString(),
    operationalBaseDate: horizon.today,
    scope: query.scope,
    bucket,
    horizon: {
      title: horizon.title,
      subtitle: horizon.subtitle,
      scopeNote: horizon.scopeNote,
      overdueNote: horizon.overdueNote,
      today: horizon.today,
    },
    summary,
    bucketSummaries: buildBucketSummaries(horizon),
    appliedFilters,
    items,
    bucketTotals,
    userName: userContext.userName,
  };
}

export function buildFinanceArHorizonExportQueryString(input: {
  agingBucket?: string;
  scope?: "bucket" | "full";
  search?: string;
  customerId?: number;
  customerName?: string;
}): string {
  const qs = new URLSearchParams();
  if (input.scope === "full") {
    qs.set("scope", "full");
  } else if (input.agingBucket?.trim()) {
    qs.set("agingBucket", input.agingBucket.trim());
  }
  if (input.search?.trim()) qs.set("search", input.search.trim());
  if (input.customerId != null && input.customerId > 0) {
    qs.set("customerId", String(input.customerId));
  }
  if (input.customerName?.trim()) qs.set("customerName", input.customerName.trim());
  return qs.toString();
}
