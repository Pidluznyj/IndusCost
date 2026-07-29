/**
 * OP-60 — Contrato puro da lista paginada do Kanban de Pedidos.
 * Sem I/O. Reutiliza filtros da OP-59.
 */

import {
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
  SALES_ORDER_FLOW_STAGES,
  isSalesOrderFlowStage,
  maxSalesOrderFlowInconsistencySeverity,
  resolveSalesOrderFlowOfficialStage,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
} from "./salesOrderFlowCatalog.js";
import { calculateDaysInCurrentStage } from "./salesOrderFlowDaysInStage.js";
import {
  parseSalesOrderFlowSummaryQuery,
  serializeSalesOrderFlowSummaryFilters,
  type SalesOrderFlowSummaryFilters,
  SalesOrderFlowSummaryQueryError,
} from "./salesOrderFlowSummary.js";
import { buildSalesOrderFlowCardStayReason } from "./salesOrderFlowStayReason.js";

export class SalesOrderFlowListQueryError extends SalesOrderFlowSummaryQueryError {
  constructor(message: string) {
    super(message);
    this.name = "SalesOrderFlowListQueryError";
  }
}

export const SALES_ORDER_FLOW_LIST_DEFAULT_LIMIT = 20;
export const SALES_ORDER_FLOW_LIST_MAX_LIMIT = 50;
/** Cap defensivo do índice de ordenação por coluna (não carrega cards completos). */
export const SALES_ORDER_FLOW_LIST_SORT_INDEX_CAP = 5000;

export const SALES_ORDER_FLOW_PRIORITY_RANK = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
} as const;

export type SalesOrderFlowListQuery = {
  filters: SalesOrderFlowSummaryFilters;
  stages: SalesOrderFlowStage[];
  limit: number;
  cursors: Partial<Record<SalesOrderFlowStage, string | null>>;
};

export type SalesOrderFlowListInconsistency = {
  code: string;
  severity: string;
  detail: string | null;
};

export type SalesOrderFlowListCard = {
  orderId: string;
  orderCode: string;
  customerName: string | null;
  sellerName: string | null;
  companyIssuer: string | null;
  stage: SalesOrderFlowStage;
  stageEnteredAt: string | null;
  daysInStage: number | null;
  issueDate: string | null;
  promisedDeliveryAt: string | null;
  isOverdue: boolean;
  orderValue: number | null;
  fulfilledValue: number | null;
  activeResidualValue: number | null;
  cutValue: number | null;
  canceledValue: number | null;
  totalItems: number;
  activeItems: number;
  completedItems: number;
  pendingItems: number;
  inconsistentItems: number | null;
  canceledItems: number;
  progressProductionOrder: number | null;
  progressProduced: number | null;
  progressDocumented: number;
  progressInvoiced: number;
  progressShipped: number;
  /** Motivo bruto do gargalo (stageReason do item bottleneck). */
  bottleneckReason: string | null;
  /** Por que o card permanece nesta coluna (texto humano). */
  stayReason: string;
  /** O que falta para sair da coluna. */
  missingToLeave: string;
  nextAction: string | null;
  responsibleArea: string | null;
  priority: string;
  isBlocked: boolean;
  blockReason: string | null;
  inconsistencies: SalesOrderFlowListInconsistency[];
  badges: string[];
};

export type SalesOrderFlowListColumnTotals = {
  overdueCount: number;
  blockedCount: number;
  inconsistentCount: number | null;
  partiallyShippedCount: number;
  withCutCount: number;
};

export type SalesOrderFlowListColumn = {
  stage: SalesOrderFlowStage;
  total: number;
  cards: SalesOrderFlowListCard[];
  hasMore: boolean;
  nextCursor: string | null;
  totals: SalesOrderFlowListColumnTotals;
  sortIndexTruncated: boolean;
};

export type SalesOrderFlowListPayload = {
  filters: ReturnType<typeof serializeSalesOrderFlowSummaryFilters> & {
    stages: SalesOrderFlowStage[];
    limit: number;
  };
  columns: SalesOrderFlowListColumn[];
  valuesVisible: boolean;
  productionVisible: boolean;
  inconsistenciesVisible: boolean;
  generatedAt: string;
};

export type SalesOrderFlowSortRow = {
  salesOrderId: string;
  orderCode: string;
  issueDate: Date | null;
  promisedDeliveryAt: Date | null;
  isOverdue: boolean;
  priority: string;
  stageEnteredAt: Date | null;
  hasCriticalInconsistency: boolean;
};

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseLimit(value: unknown): number {
  if (value == null || value === "") return SALES_ORDER_FLOW_LIST_DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new SalesOrderFlowListQueryError("limit inválido.");
  }
  return Math.min(Math.trunc(n), SALES_ORDER_FLOW_LIST_MAX_LIMIT);
}

function parseStages(query: Record<string, unknown>): SalesOrderFlowStage[] {
  const raw = query.stages ?? query.stage;
  let parts: string[] = [];
  if (Array.isArray(raw)) {
    parts = raw.flatMap((v) => String(v).split(","));
  } else if (typeof raw === "string") {
    parts = raw.split(",");
  } else if (raw == null || raw === "") {
    return [...SALES_ORDER_FLOW_STAGES];
  } else {
    throw new SalesOrderFlowListQueryError("stages inválido.");
  }

  const stages: SalesOrderFlowStage[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const stage = part.trim().toUpperCase();
    if (!stage) continue;
    if (!isSalesOrderFlowStage(stage)) {
      throw new SalesOrderFlowListQueryError(`Etapa inválida: ${stage}`);
    }
    if (seen.has(stage)) continue;
    seen.add(stage);
    stages.push(stage);
  }
  if (stages.length === 0) {
    throw new SalesOrderFlowListQueryError("Informe ao menos uma etapa.");
  }
  return stages;
}

function parseCursors(
  query: Record<string, unknown>,
  stages: SalesOrderFlowStage[]
): Partial<Record<SalesOrderFlowStage, string | null>> {
  const cursors: Partial<Record<SalesOrderFlowStage, string | null>> = {};
  for (const stage of stages) {
    const specific =
      parseOptionalString(query[`cursor.${stage}`]) ??
      parseOptionalString(query[`cursor_${stage}`]);
    cursors[stage] = specific;
  }
  if (stages.length === 1) {
    const single = parseOptionalString(query.cursor);
    if (single) cursors[stages[0]!] = single;
  }
  return cursors;
}

export function parseSalesOrderFlowListQuery(
  query: Record<string, unknown>
): SalesOrderFlowListQuery {
  const filters = parseSalesOrderFlowSummaryQuery(query);
  const stages = parseStages(query);
  return {
    filters,
    stages,
    limit: parseLimit(query.limit ?? query.pageSize),
    cursors: parseCursors(query, stages),
  };
}

export function encodeSalesOrderFlowListCursor(input: {
  stage: SalesOrderFlowStage;
  afterOrderId: string;
}): string {
  const payload = JSON.stringify({
    v: 1,
    s: input.stage,
    a: input.afterOrderId,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeSalesOrderFlowListCursor(
  raw: string | null | undefined,
  expectedStage: SalesOrderFlowStage
): { afterOrderId: string } | null {
  if (raw == null || raw === "") return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as {
      v?: unknown;
      s?: unknown;
      a?: unknown;
    };
    if (parsed.v !== 1) {
      throw new SalesOrderFlowListQueryError("Cursor inválido (versão).");
    }
    if (parsed.s !== expectedStage) {
      throw new SalesOrderFlowListQueryError(
        "Cursor inválido para a etapa solicitada."
      );
    }
    if (typeof parsed.a !== "string" || !parsed.a.trim()) {
      throw new SalesOrderFlowListQueryError("Cursor inválido.");
    }
    return { afterOrderId: parsed.a };
  } catch (error) {
    if (error instanceof SalesOrderFlowListQueryError) throw error;
    throw new SalesOrderFlowListQueryError("Cursor inválido.");
  }
}

export function parseSalesOrderFlowInconsistencies(
  value: unknown
): SalesOrderFlowListInconsistency[] {
  if (!Array.isArray(value)) return [];
  const out: SalesOrderFlowListInconsistency[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const code = typeof (row as { code?: unknown }).code === "string"
      ? (row as { code: string }).code
      : null;
    if (!code) continue;
    const severityRaw =
      typeof (row as { severity?: unknown }).severity === "string"
        ? (row as { severity: string }).severity
        : SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE[
            code as SalesOrderFlowInconsistencyCode
          ] ?? "WARNING";
    const detail =
      typeof (row as { detail?: unknown }).detail === "string"
        ? (row as { detail: string }).detail
        : null;
    out.push({ code, severity: severityRaw, detail });
  }
  return out;
}

export function parseSalesOrderFlowBadges(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function hasCriticalSalesOrderFlowInconsistency(
  inconsistencies: ReadonlyArray<{ code: string; severity?: string }>
): boolean {
  if (
    inconsistencies.some(
      (i) => String(i.severity ?? "").toUpperCase() === "CRITICAL"
    )
  ) {
    return true;
  }
  const codes = inconsistencies
    .map((i) => i.code)
    .filter((c): c is SalesOrderFlowInconsistencyCode =>
      Object.prototype.hasOwnProperty.call(
        SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
        c
      )
    );
  return maxSalesOrderFlowInconsistencySeverity(codes) === "CRITICAL";
}

function priorityRank(priority: string | null | undefined): number {
  const key = String(priority ?? "NORMAL").toUpperCase();
  if (key in SALES_ORDER_FLOW_PRIORITY_RANK) {
    return SALES_ORDER_FLOW_PRIORITY_RANK[
      key as keyof typeof SALES_ORDER_FLOW_PRIORITY_RANK
    ];
  }
  return SALES_ORDER_FLOW_PRIORITY_RANK.NORMAL;
}

function compareNullableDateAsc(
  a: Date | null | undefined,
  b: Date | null | undefined
): number {
  const aOk = a != null && !Number.isNaN(a.getTime());
  const bOk = b != null && !Number.isNaN(b.getTime());
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return a!.getTime() - b!.getTime();
}

/**
 * Ordenação canônica do Kanban (determinística).
 * 1 crítica → 2 atraso → 3 prioridade → 4 tempo na etapa →
 * 5 entrega → 6 emissão → 7 código → 8 id.
 */
export function compareSalesOrderFlowSortRows(
  a: SalesOrderFlowSortRow,
  b: SalesOrderFlowSortRow
): number {
  if (a.hasCriticalInconsistency !== b.hasCriticalInconsistency) {
    return a.hasCriticalInconsistency ? -1 : 1;
  }
  if (a.isOverdue !== b.isOverdue) {
    return a.isOverdue ? -1 : 1;
  }
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff !== 0) return priorityDiff;

  // Maior tempo na etapa = stageEnteredAt mais antigo primeiro.
  const stageDiff = compareNullableDateAsc(a.stageEnteredAt, b.stageEnteredAt);
  if (stageDiff !== 0) return stageDiff;

  const promisedDiff = compareNullableDateAsc(
    a.promisedDeliveryAt,
    b.promisedDeliveryAt
  );
  if (promisedDiff !== 0) return promisedDiff;

  const issueDiff = compareNullableDateAsc(a.issueDate, b.issueDate);
  if (issueDiff !== 0) return issueDiff;

  const codeDiff = a.orderCode.localeCompare(b.orderCode, "pt-BR");
  if (codeDiff !== 0) return codeDiff;

  return a.salesOrderId.localeCompare(b.salesOrderId);
}

export function paginateSalesOrderFlowSortRows(input: {
  rows: SalesOrderFlowSortRow[];
  cursor: string | null | undefined;
  stage: SalesOrderFlowStage;
  limit: number;
}): {
  page: SalesOrderFlowSortRow[];
  hasMore: boolean;
  nextCursor: string | null;
} {
  const decoded = decodeSalesOrderFlowListCursor(input.cursor, input.stage);
  const sorted = [...input.rows].sort(compareSalesOrderFlowSortRows);
  let start = 0;
  if (decoded) {
    const idx = sorted.findIndex(
      (row) => row.salesOrderId === decoded.afterOrderId
    );
    if (idx < 0) {
      throw new SalesOrderFlowListQueryError(
        "Cursor inválido (pedido fora do resultado filtrado)."
      );
    }
    start = idx + 1;
  }
  const page = sorted.slice(start, start + input.limit);
  const hasMore = start + input.limit < sorted.length;
  const last = page[page.length - 1];
  return {
    page,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeSalesOrderFlowListCursor({
            stage: input.stage,
            afterOrderId: last.salesOrderId,
          })
        : null,
  };
}

function decimalNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type SalesOrderFlowCardSource = {
  salesOrderId: string;
  currentStage: string;
  bottleneckStage?: string | null;
  nextAction: string | null;
  responsibleArea: string | null;
  bottleneckReason?: string | null;
  totalItems: number;
  activeItems: number;
  completedItems: number;
  pendingItems: number;
  inconsistentItems: number;
  canceledItems: number;
  progressProductionOrder: unknown;
  progressProduced: unknown;
  progressDocumented: unknown;
  progressInvoiced: unknown;
  progressShipped: unknown;
  orderValue: unknown;
  fulfilledValue: unknown;
  activeResidualValue: unknown;
  cutValue: unknown;
  canceledValue: unknown;
  promisedDeliveryAt: Date | null;
  isOverdue: boolean;
  inconsistenciesJson: unknown;
  badgesJson: unknown;
  stageEnteredAt: Date | null;
  salesOrder: {
    orderCode: string;
    issueDate: Date;
    nomusSellerName: string | null;
    responsible: string | null;
    companyIssuer: string | null;
    Customer: {
      companyName: string | null;
      tradeName: string | null;
    } | null;
    flowManagement: {
      priority: string;
      isBlocked: boolean;
      blockReason: string | null;
    } | null;
  };
};

export function mapSalesOrderFlowListCard(
  row: SalesOrderFlowCardSource,
  options: {
    canViewValues: boolean;
    canViewProduction?: boolean;
    canViewInconsistencies?: boolean;
    now?: Date;
  }
): SalesOrderFlowListCard {
  const stage =
    resolveSalesOrderFlowOfficialStage({
      currentStage: row.currentStage,
      bottleneckStage: row.bottleneckStage,
    }) ?? "WAITING_RELEASE";
  const management = row.salesOrder.flowManagement;
  const customer = row.salesOrder.Customer;
  const customerName =
    customer?.tradeName?.trim() ||
    customer?.companyName?.trim() ||
    null;
  const inconsistencies = parseSalesOrderFlowInconsistencies(
    row.inconsistenciesJson
  );
  const values = options.canViewValues;
  const production = options.canViewProduction !== false;
  const inconsistencyDetails = options.canViewInconsistencies !== false;
  const stay = buildSalesOrderFlowCardStayReason({
    stage,
    bottleneckReason: row.bottleneckReason,
    nextAction: row.nextAction,
  });
  return {
    orderId: row.salesOrderId,
    orderCode: row.salesOrder.orderCode,
    customerName,
    sellerName:
      row.salesOrder.nomusSellerName?.trim() ||
      row.salesOrder.responsible?.trim() ||
      null,
    companyIssuer: row.salesOrder.companyIssuer,
    stage,
    stageEnteredAt: dateIso(row.stageEnteredAt),
    daysInStage: calculateDaysInCurrentStage(
      row.stageEnteredAt,
      options.now ?? new Date()
    ),
    issueDate: dateIso(row.salesOrder.issueDate),
    promisedDeliveryAt: dateIso(row.promisedDeliveryAt),
    isOverdue: row.isOverdue,
    orderValue: values ? decimalNumber(row.orderValue) : null,
    fulfilledValue: values ? decimalNumber(row.fulfilledValue) : null,
    activeResidualValue: values
      ? decimalNumber(row.activeResidualValue)
      : null,
    cutValue: values ? decimalNumber(row.cutValue) : null,
    canceledValue: values ? decimalNumber(row.canceledValue) : null,
    totalItems: row.totalItems,
    activeItems: row.activeItems,
    completedItems: row.completedItems,
    pendingItems: row.pendingItems,
    inconsistentItems: inconsistencyDetails ? row.inconsistentItems : null,
    canceledItems: row.canceledItems,
    progressProductionOrder: production
      ? decimalNumber(row.progressProductionOrder)
      : null,
    progressProduced:
      !production || row.progressProduced == null
        ? null
        : decimalNumber(row.progressProduced),
    progressDocumented: decimalNumber(row.progressDocumented),
    progressInvoiced: decimalNumber(row.progressInvoiced),
    progressShipped: decimalNumber(row.progressShipped),
    bottleneckReason: stay.bottleneckReason,
    stayReason: stay.whyHere,
    missingToLeave: stay.missingToLeave,
    nextAction: row.nextAction,
    responsibleArea: row.responsibleArea,
    priority: management?.priority ?? "NORMAL",
    isBlocked: management?.isBlocked === true,
    blockReason: management?.blockReason ?? null,
    inconsistencies: inconsistencyDetails ? inconsistencies : [],
    badges: parseSalesOrderFlowBadges(row.badgesJson),
  };
}

export function buildSalesOrderFlowListColumnTotals(
  rows: ReadonlyArray<{
    isOverdue: boolean;
    isBlocked: boolean;
    inconsistentItems: number;
    badges: string[];
    cutValue: number;
  }>
): SalesOrderFlowListColumnTotals {
  let overdueCount = 0;
  let blockedCount = 0;
  let inconsistentCount = 0;
  let partiallyShippedCount = 0;
  let withCutCount = 0;
  for (const row of rows) {
    if (row.isOverdue) overdueCount += 1;
    if (row.isBlocked) blockedCount += 1;
    if (row.inconsistentItems > 0) inconsistentCount += 1;
    if (row.badges.includes("PARTIAL")) partiallyShippedCount += 1;
    if (row.cutValue > 0) withCutCount += 1;
  }
  return {
    overdueCount,
    blockedCount,
    inconsistentCount,
    partiallyShippedCount,
    withCutCount,
  };
}
