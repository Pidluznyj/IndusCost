/**
 * Orquestração da materialização de comissão (snapshot + schedule por CR).
 * Lógica pura — persistência e descoberta em commissionMaterializationOrchestrator.server.ts.
 */
import type { CommissionOrderMaterializationAction, CommissionOrderMaterializationPreview } from "./commissionOrderMaterializer.js";
import type { CommissionReceivableScheduleRebuildResult } from "./commissionReceivableScheduler.js";

/** Orquestrador grava apenas snapshot/schedule — nunca muta fechamento CLOSED. */
export const COMMISSION_MATERIALIZATION_CLOSING_GUARD =
  "Orchestrator does not write CommissionMonthlyClosing or CommissionReceiptLedgerLine";

export type AffectedSalesOrderSource =
  | "SALES_ORDER"
  | "NFE"
  | "RECEIVABLE"
  | "CUSTOMER"
  | "SELLER"
  | "COMMISSION_RULE"
  | "CUSTOMER_EXCLUSION";

export type AffectedSalesOrderRef = {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
};

export type CommissionMaterializationOrderResult = {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
  snapshotAction: CommissionOrderMaterializationAction | "skipped" | "error";
  scheduleAction: CommissionReceivableScheduleRebuildResult["action"] | "skipped" | "error";
  snapshotId: string | null;
  schedulesCreated: number;
  schedulesSuperseded: number;
  schedulesStaled: number;
  schedulesUnchanged: number;
  changed: boolean;
  excludedCustomerItems: number;
  unresolvedSeller: boolean;
  receivablesWithoutLink: number;
  error?: string;
};

export type CommissionMaterializationArtifactCounts = {
  activeSnapshots: number;
  activeSchedules: number;
};

export type CommissionMaterializationClosedClosingRef = {
  closingId: string;
  year: number;
  month: number;
};

export type CommissionMaterializationRunSummary = {
  dryRun: boolean;
  since: string | null;
  year: number | null;
  month: number | null;
  sellerFilter: string | null;
  customerFilter: string | null;
  limit: number | null;
  ordersEvaluated: number;
  ordersChanged: number;
  ordersProcessed: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  snapshotsUnchanged: number;
  snapshotsSuperseded: number;
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesStaled: number;
  schedulesUnchanged: number;
  receivablesWithoutLink: number;
  excludedCustomers: number;
  unresolvedSellers: number;
  errors: Array<{ salesOrderId: string; message: string }>;
  closedClosingsPreserved: CommissionMaterializationClosedClosingRef[];
  baseline: CommissionMaterializationArtifactCounts;
  after: CommissionMaterializationArtifactCounts;
  orders: CommissionMaterializationOrderResult[];
};

export const COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION = "REBUILD COMMISSION";

const SOURCE_PRIORITY: Record<AffectedSalesOrderSource, number> = {
  SALES_ORDER: 1,
  NFE: 2,
  RECEIVABLE: 3,
  CUSTOMER: 4,
  SELLER: 5,
  COMMISSION_RULE: 6,
  CUSTOMER_EXCLUSION: 7,
};

export function mergeAffectedSalesOrderRefs(
  refs: AffectedSalesOrderRef[]
): AffectedSalesOrderRef[] {
  const map = new Map<string, Set<AffectedSalesOrderSource>>();

  for (const ref of refs) {
    const set = map.get(ref.salesOrderId) ?? new Set<AffectedSalesOrderSource>();
    for (const source of ref.sources) set.add(source);
    map.set(ref.salesOrderId, set);
  }

  return [...map.entries()]
    .map(([salesOrderId, sources]) => ({
      salesOrderId,
      sources: [...sources].sort(
        (a, b) => SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b]
      ),
    }))
    .sort((a, b) => a.salesOrderId.localeCompare(b.salesOrderId));
}

export function isMaterializationOrderChanged(
  order: Pick<CommissionMaterializationOrderResult, "snapshotAction" | "scheduleAction">
): boolean {
  const snapshotChanged =
    order.snapshotAction !== "unchanged" &&
    order.snapshotAction !== "skipped" &&
    order.snapshotAction !== "error";
  const scheduleChanged =
    order.scheduleAction !== "unchanged" &&
    order.scheduleAction !== "skipped" &&
    order.scheduleAction !== "error";
  return snapshotChanged || scheduleChanged;
}

export function extractMaterializationOrderIssues(input: {
  snapshotPreview: CommissionOrderMaterializationPreview | null;
  schedulePreview: CommissionReceivableScheduleRebuildResult["preview"] | null;
  nfeId: number | null;
}): {
  excludedCustomerItems: number;
  unresolvedSeller: boolean;
  receivablesWithoutLink: number;
} {
  let excludedCustomerItems = 0;
  let unresolvedSeller = false;

  if (input.snapshotPreview) {
    excludedCustomerItems = input.snapshotPreview.items.filter(
      (item) => item.status === "CUSTOMER_EXCLUDED"
    ).length;
    unresolvedSeller = input.snapshotPreview.items.some(
      (item) => item.status === "SELLER_UNRESOLVED"
    );
  }

  let receivablesWithoutLink = 0;
  if (input.nfeId != null) {
    const scheduleCount = input.schedulePreview?.length ?? 0;
    if (scheduleCount === 0) receivablesWithoutLink = 1;
  }

  if (input.schedulePreview) {
    const scheduleExcluded = input.schedulePreview.filter(
      (row) => row.status === "CUSTOMER_EXCLUDED"
    ).length;
    if (scheduleExcluded > excludedCustomerItems) {
      excludedCustomerItems = scheduleExcluded;
    }
  }

  return { excludedCustomerItems, unresolvedSeller, receivablesWithoutLink };
}

export function aggregateMaterializationRunSummary(input: {
  dryRun: boolean;
  since: Date | null;
  year?: number | null;
  month?: number | null;
  sellerFilter?: string | null;
  customerFilter?: string | null;
  limit?: number | null;
  closedClosingsPreserved?: CommissionMaterializationClosedClosingRef[];
  baseline?: CommissionMaterializationArtifactCounts;
  after?: CommissionMaterializationArtifactCounts;
  orders: CommissionMaterializationOrderResult[];
}): CommissionMaterializationRunSummary {
  let snapshotsCreated = 0;
  let snapshotsUnchanged = 0;
  let snapshotsSuperseded = 0;
  let schedulesCreated = 0;
  let schedulesUpdated = 0;
  let schedulesStaled = 0;
  let schedulesUnchanged = 0;
  let ordersChanged = 0;
  let receivablesWithoutLink = 0;
  let excludedCustomers = 0;
  let unresolvedSellers = 0;
  const errors: Array<{ salesOrderId: string; message: string }> = [];

  for (const order of input.orders) {
    if (order.snapshotAction === "created") snapshotsCreated += 1;
    if (order.snapshotAction === "unchanged") snapshotsUnchanged += 1;
    if (order.snapshotAction === "superseded") snapshotsSuperseded += 1;

    schedulesCreated += order.schedulesCreated;
    schedulesStaled += order.schedulesStaled;
    schedulesUnchanged += order.schedulesUnchanged;
    if (
      order.scheduleAction === "updated" ||
      order.scheduleAction === "mixed" ||
      order.scheduleAction === "created"
    ) {
      schedulesUpdated += 1;
    }

    if (order.changed) ordersChanged += 1;
    receivablesWithoutLink += order.receivablesWithoutLink;
    if (order.excludedCustomerItems > 0) excludedCustomers += 1;
    if (order.unresolvedSeller) unresolvedSellers += 1;

    if (order.error) {
      errors.push({ salesOrderId: order.salesOrderId, message: order.error });
    }
  }

  return {
    dryRun: input.dryRun,
    since: input.since?.toISOString() ?? null,
    year: input.year ?? null,
    month: input.month ?? null,
    sellerFilter: input.sellerFilter ?? null,
    customerFilter: input.customerFilter ?? null,
    limit: input.limit ?? null,
    ordersEvaluated: input.orders.length,
    ordersChanged,
    ordersProcessed: input.orders.length,
    snapshotsCreated,
    snapshotsUpdated: snapshotsSuperseded,
    snapshotsUnchanged,
    snapshotsSuperseded,
    schedulesCreated,
    schedulesUpdated,
    schedulesStaled,
    schedulesUnchanged,
    receivablesWithoutLink,
    excludedCustomers,
    unresolvedSellers,
    errors,
    closedClosingsPreserved: input.closedClosingsPreserved ?? [],
    baseline: input.baseline ?? { activeSnapshots: 0, activeSchedules: 0 },
    after: input.after ?? { activeSnapshots: 0, activeSchedules: 0 },
    orders: input.orders,
  };
}

export function buildMaterializationOrderResult(input: {
  salesOrderId: string;
  sources: AffectedSalesOrderSource[];
  snapshot: {
    action: CommissionOrderMaterializationAction;
    snapshotId: string | null;
    preview: CommissionOrderMaterializationPreview;
  } | null;
  schedule: CommissionReceivableScheduleRebuildResult | null;
  error?: string;
}): CommissionMaterializationOrderResult {
  const issues = extractMaterializationOrderIssues({
    snapshotPreview: input.snapshot?.preview ?? null,
    schedulePreview: input.schedule?.preview ?? null,
    nfeId: input.snapshot?.preview.nfeId ?? null,
  });
  const result: CommissionMaterializationOrderResult = {
    salesOrderId: input.salesOrderId,
    sources: input.sources,
    snapshotAction: input.error ? "error" : (input.snapshot?.action ?? "skipped"),
    scheduleAction: input.error ? "error" : (input.schedule?.action ?? "skipped"),
    snapshotId: input.snapshot?.snapshotId ?? null,
    schedulesCreated: input.schedule?.schedulesCreated ?? 0,
    schedulesSuperseded: input.schedule?.schedulesSuperseded ?? 0,
    schedulesStaled: input.schedule?.schedulesStaled ?? 0,
    schedulesUnchanged: input.schedule?.schedulesUnchanged ?? 0,
    changed: false,
    excludedCustomerItems: issues.excludedCustomerItems,
    unresolvedSeller: issues.unresolvedSeller,
    receivablesWithoutLink: issues.receivablesWithoutLink,
    error: input.error,
  };
  result.changed = !input.error && isMaterializationOrderChanged(result);
  return result;
}

export function parseMaterializationIdList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[,;]/).map((part) => part.trim()).filter(Boolean))];
}

export function parseMaterializationNumericIdList(value: string | undefined): number[] {
  return [
    ...new Set(
      parseMaterializationIdList(value)
        .map((part) => Number(part))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

export function parseMaterializationSince(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida em --since: ${value}`);
  }
  return parsed;
}

export function resolveMaterializationDryRun(input: {
  preview?: boolean;
  apply?: boolean;
}): boolean {
  if (input.preview && input.apply) {
    throw new Error("Use apenas um modo: --preview ou --apply.");
  }
  return !input.apply;
}

export function parseMaterializationYearMonth(input: {
  year?: string | number | null;
  month?: string | number | null;
}): { year: number; month: number } | null {
  if (input.year == null || input.year === "") return null;
  const year = Number(input.year);
  const month = input.month != null && input.month !== "" ? Number(input.month) : null;
  if (!Number.isFinite(year) || !Number.isInteger(year)) {
    throw new Error("Ano inválido em --year.");
  }
  if (month == null || !Number.isFinite(month) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Informe --month (1-12) junto com --year.");
  }
  return { year, month };
}

export function parseMaterializationLimit(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("Valor inválido em --limit (inteiro >= 1).");
  }
  return limit;
}

export function validateMaterializationRebuildApply(input: {
  apply: boolean;
  confirm?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.apply) return { ok: true };
  if (input.confirm?.trim() !== COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION) {
    return {
      ok: false,
      reason: `Apply exige --confirm="${COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION}".`,
    };
  }
  return { ok: true };
}

export function buildMaterializationRebuildCsv(
  summary: CommissionMaterializationRunSummary
): string {
  const lines = [
    [
      "salesOrderId",
      "sources",
      "changed",
      "snapshotAction",
      "scheduleAction",
      "snapshotId",
      "schedulesCreated",
      "schedulesSuperseded",
      "schedulesStaled",
      "excludedCustomerItems",
      "unresolvedSeller",
      "receivablesWithoutLink",
      "error",
    ].join(","),
  ];

  for (const order of summary.orders) {
    const cols = [
      order.salesOrderId,
      order.sources.join("|"),
      order.changed ? "yes" : "no",
      order.snapshotAction,
      order.scheduleAction,
      order.snapshotId ?? "",
      order.schedulesCreated,
      order.schedulesSuperseded,
      order.schedulesStaled,
      order.excludedCustomerItems,
      order.unresolvedSeller ? "yes" : "no",
      order.receivablesWithoutLink,
      order.error ?? "",
    ];
    lines.push(
      cols
        .map((value) => {
          const s = String(value ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );
  }

  return lines.join("\n");
}
