/**
 * Helpers browser-safe da tela Comercial → Fluxo de Pedidos.
 */
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  isSalesOrderFlowStage,
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGES,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog.js";

export const SALES_ORDER_FLOW_MODULE_ID = "sales-order-flow" as const;
export const SALES_ORDER_FLOW_ROUTE_PATH = "/commercial/sales-order-flow";
export const SALES_ORDER_FLOW_PAGE_TITLE = "Fluxo de Pedidos";
export const SALES_ORDER_FLOW_PAGE_SUBTITLE =
  "Kanban operacional dos pedidos de venda.";
export const SALES_ORDER_FLOW_BREADCRUMB = "Comercial / Fluxo de Pedidos";
export const SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION =
  "sales_orders.flow.view" as const;

/** Viewports de validação visual OP-77 (zoom 100%). */
export const SALES_ORDER_FLOW_VIEWPORTS = [
  { id: "1366" as const, width: 1366, height: 768, label: "1366×768" },
  { id: "1920" as const, width: 1920, height: 1080, label: "1920×1080" },
] as const;

export function salesOrderFlowViewportClass(
  viewport: "1366" | "1920"
): string {
  return viewport === "1366" ? "w-[1366px] max-w-full" : "w-[1920px] max-w-full";
}

/** Espelha SALES_ORDER_FLOW_SUMMARY_PRIORITIES sem importar módulo de contrato/server. */
export const SALES_ORDER_FLOW_UI_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export type SalesOrderFlowUiPriority =
  (typeof SALES_ORDER_FLOW_UI_PRIORITIES)[number];

export type SalesOrderFlowIndicatorSummary = {
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  columns: Array<{
    stage: SalesOrderFlowStage;
    label: string;
    isCanceledColumn: boolean;
    orderCount: number;
    orderValue: number | null;
    activeResidualValue: number | null;
  }>;
};

export type SalesOrderFlowIndicatorList = {
  inconsistenciesVisible: boolean;
  columns: Array<{
    stage: SalesOrderFlowStage;
    total: number;
    totals: {
      overdueCount: number;
      blockedCount: number;
      inconsistentCount: number | null;
      partiallyShippedCount: number;
      withCutCount: number;
    };
  }>;
};

export type SalesOrderFlowColumnIndicator = {
  stage: SalesOrderFlowStage;
  label: string;
  orderCount: number;
  orderValue: number | null;
  activeResidualValue: number | null;
  overdueCount: number;
  blockedCount: number;
  inconsistentCount: number | null;
  partiallyShippedCount: number;
  withCutCount: number;
};

export type SalesOrderFlowExecutiveIndicators = {
  activeOrderCount: number;
  processValue: number | null;
  activeResidualValue: number | null;
  overdueCount: number;
  blockedCount: number;
  inconsistentCount: number | null;
  partiallyShippedCount: number;
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  columns: SalesOrderFlowColumnIndicator[];
};

export type SalesOrderFlowUiFilters = {
  q: string;
  customerId: string;
  sellerKey: string;
  company: string;
  product: string;
  sector: string;
  issueFrom: string;
  issueTo: string;
  promisedFrom: string;
  promisedTo: string;
  overdue: boolean | null;
  blocked: boolean | null;
  inconsistent: boolean | null;
  partiallyShipped: boolean | null;
  withCut: boolean | null;
  withActiveResidual: boolean | null;
  priority: SalesOrderFlowUiPriority | null;
  /** Vazio = todas as etapas. */
  stages: SalesOrderFlowStage[];
};

export const EMPTY_SALES_ORDER_FLOW_FILTERS: SalesOrderFlowUiFilters = {
  q: "",
  customerId: "",
  sellerKey: "",
  company: "",
  product: "",
  sector: "",
  issueFrom: "",
  issueTo: "",
  promisedFrom: "",
  promisedTo: "",
  overdue: null,
  blocked: null,
  inconsistent: null,
  partiallyShipped: null,
  withCut: null,
  withActiveResidual: null,
  priority: null,
  stages: [],
};

/** Empresas do grupo — select no filtro (contains no backend). */
export const SALES_ORDER_FLOW_COMPANY_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "Lazarios", label: "Lazarios" },
  { value: "Koppetel", label: "Koppetel" },
  { value: "SM", label: "SM" },
];

export function areSalesOrderFlowUiFiltersEqual(
  a: SalesOrderFlowUiFilters,
  b: SalesOrderFlowUiFilters
): boolean {
  return (
    a.q === b.q &&
    a.customerId === b.customerId &&
    a.sellerKey === b.sellerKey &&
    a.company === b.company &&
    a.product === b.product &&
    a.sector === b.sector &&
    a.issueFrom === b.issueFrom &&
    a.issueTo === b.issueTo &&
    a.promisedFrom === b.promisedFrom &&
    a.promisedTo === b.promisedTo &&
    a.overdue === b.overdue &&
    a.blocked === b.blocked &&
    a.inconsistent === b.inconsistent &&
    a.partiallyShipped === b.partiallyShipped &&
    a.withCut === b.withCut &&
    a.withActiveResidual === b.withActiveResidual &&
    a.priority === b.priority &&
    a.stages.length === b.stages.length &&
    a.stages.every((stage, index) => stage === b.stages[index])
  );
}

export const SALES_ORDER_FLOW_PRIORITY_OPTIONS: ReadonlyArray<{
  value: SalesOrderFlowUiPriority;
  label: string;
}> = [
  { value: "LOW", label: "Baixa" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

export const SALES_ORDER_FLOW_STAGE_FILTER_OPTIONS: ReadonlyArray<{
  value: SalesOrderFlowStage;
  label: string;
}> = SALES_ORDER_FLOW_STAGES.map((stage) => ({
  value: stage,
  label: SALES_ORDER_FLOW_STAGE_LABELS[stage],
}));

const TERMINAL_SALES_ORDER_FLOW_STAGES = new Set<SalesOrderFlowStage>([
  "SHIPPED_COMPLETED",
  "CANCELED",
]);

/**
 * Deriva cards e cabeçalhos somente dos payloads já carregados.
 * `list.columns` define as etapas filtradas; `summary.columns` fornece valores.
 */
export function resolveSalesOrderFlowExecutiveIndicators(
  summary: SalesOrderFlowIndicatorSummary,
  list: SalesOrderFlowIndicatorList
): SalesOrderFlowExecutiveIndicators {
  const summaryByStage = new Map(
    summary.columns.map((column) => [column.stage, column] as const)
  );
  const columns = list.columns.map((column) => {
    const summaryColumn = summaryByStage.get(column.stage);
    return {
      stage: column.stage,
      label: summaryColumn?.label ?? SALES_ORDER_FLOW_STAGE_LABELS[column.stage],
      orderCount: column.total,
      orderValue: summary.valuesVisible
        ? (summaryColumn?.orderValue ?? 0)
        : null,
      activeResidualValue: summary.valuesVisible
        ? (summaryColumn?.activeResidualValue ?? 0)
        : null,
      overdueCount: column.totals.overdueCount,
      blockedCount: column.totals.blockedCount,
      inconsistentCount:
        list.inconsistenciesVisible && summary.inconsistenciesVisible
          ? (column.totals.inconsistentCount ?? 0)
          : null,
      partiallyShippedCount: column.totals.partiallyShippedCount,
      withCutCount: column.totals.withCutCount,
    };
  });
  const activeColumns = columns.filter(
    (column) => !TERMINAL_SALES_ORDER_FLOW_STAGES.has(column.stage)
  );
  const sum = (
    selector: (column: SalesOrderFlowColumnIndicator) => number
  ): number => columns.reduce((total, column) => total + selector(column), 0);

  return {
    activeOrderCount: activeColumns.reduce(
      (total, column) => total + column.orderCount,
      0
    ),
    processValue: summary.valuesVisible
      ? activeColumns.reduce(
          (total, column) => total + (column.orderValue ?? 0),
          0
        )
      : null,
    activeResidualValue: summary.valuesVisible
      ? activeColumns.reduce(
          (total, column) => total + (column.activeResidualValue ?? 0),
          0
        )
      : null,
    overdueCount: sum((column) => column.overdueCount),
    blockedCount: sum((column) => column.blockedCount),
    inconsistentCount:
      list.inconsistenciesVisible && summary.inconsistenciesVisible
        ? sum((column) => column.inconsistentCount ?? 0)
        : null,
    partiallyShippedCount: sum(
      (column) => column.partiallyShippedCount
    ),
    valuesVisible: summary.valuesVisible,
    inconsistenciesVisible:
      list.inconsistenciesVisible && summary.inconsistenciesVisible,
    columns,
  };
}

export function canViewSalesOrderFlow(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.(SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION)
  );
}

export function canAccessSalesOrderFlowModule(
  check: PermissionChecker
): boolean {
  return check.hasPermission(SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION);
}

export function classifySalesOrderFlowListError(error: unknown): {
  kind: "access_denied" | "feature_disabled" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar o Fluxo de Pedidos.",
      };
    }
    if (error.status === 404) {
      return {
        kind: "feature_disabled",
        message: "Fluxo de Pedidos não está habilitado neste ambiente.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API do Fluxo de Pedidos indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar o Fluxo de Pedidos.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API do Fluxo de Pedidos indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar o Fluxo de Pedidos.",
  };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSalesOrderFlowDateParam(
  value: string | null | undefined
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (DATE_ONLY_RE.test(trimmed)) return trimmed;
  // ISO completo → dia local/UTC seguro via prefixo YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return "";
}

export function parseSalesOrderFlowPriorityParam(
  value: string | null | undefined
): SalesOrderFlowUiPriority | null {
  const raw = value?.trim().toUpperCase() ?? "";
  if (!raw) return null;
  return (SALES_ORDER_FLOW_UI_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as SalesOrderFlowUiPriority)
    : null;
}

export function parseSalesOrderFlowStagesParam(
  value: string | null | undefined
): SalesOrderFlowStage[] {
  if (value == null || value.trim() === "") return [];
  const stages: SalesOrderFlowStage[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const stage = part.trim().toUpperCase();
    if (!stage || seen.has(stage)) continue;
    if (!isSalesOrderFlowStage(stage)) continue;
    seen.add(stage);
    stages.push(stage);
  }
  return stages;
}

export function parseSalesOrderFlowBooleanParam(
  value: string | null | undefined
): boolean | null {
  if (value == null || value === "") return null;
  const folded = value.trim().toLowerCase();
  if (folded === "true" || folded === "1") return true;
  if (folded === "false" || folded === "0") return false;
  return null;
}

/**
 * Lê URL e normaliza valores inválidos (descarta em vez de falhar).
 */
export function parseSalesOrderFlowFiltersFromSearchParams(
  params: URLSearchParams
): SalesOrderFlowUiFilters {
  return {
    q: params.get("q")?.trim() ?? "",
    customerId: params.get("customerId")?.trim() ?? "",
    sellerKey:
      params.get("sellerKey")?.trim() ||
      params.get("seller")?.trim() ||
      "",
    company: params.get("company")?.trim() ?? "",
    product: params.get("product")?.trim() ?? "",
    sector: params.get("sector")?.trim() ?? "",
    issueFrom: normalizeSalesOrderFlowDateParam(params.get("issueFrom")),
    issueTo: normalizeSalesOrderFlowDateParam(params.get("issueTo")),
    promisedFrom: normalizeSalesOrderFlowDateParam(params.get("promisedFrom")),
    promisedTo: normalizeSalesOrderFlowDateParam(params.get("promisedTo")),
    overdue: parseSalesOrderFlowBooleanParam(params.get("overdue")),
    blocked: parseSalesOrderFlowBooleanParam(params.get("blocked")),
    inconsistent: parseSalesOrderFlowBooleanParam(params.get("inconsistent")),
    partiallyShipped: parseSalesOrderFlowBooleanParam(
      params.get("partiallyShipped")
    ),
    withCut: parseSalesOrderFlowBooleanParam(params.get("withCut")),
    withActiveResidual: parseSalesOrderFlowBooleanParam(
      params.get("withActiveResidual")
    ),
    priority: parseSalesOrderFlowPriorityParam(params.get("priority")),
    stages: parseSalesOrderFlowStagesParam(params.get("stages")),
  };
}

export function buildSalesOrderFlowSearchParams(
  filters: SalesOrderFlowUiFilters,
  drawer?: { orderId?: string | null; orderCode?: string | null } | null
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.customerId.trim()) params.set("customerId", filters.customerId.trim());
  if (filters.sellerKey.trim()) params.set("sellerKey", filters.sellerKey.trim());
  if (filters.company.trim()) params.set("company", filters.company.trim());
  if (filters.product.trim()) params.set("product", filters.product.trim());
  if (filters.sector.trim()) params.set("sector", filters.sector.trim());
  if (filters.issueFrom) params.set("issueFrom", filters.issueFrom);
  if (filters.issueTo) params.set("issueTo", filters.issueTo);
  if (filters.promisedFrom) params.set("promisedFrom", filters.promisedFrom);
  if (filters.promisedTo) params.set("promisedTo", filters.promisedTo);
  if (filters.overdue === true) params.set("overdue", "true");
  if (filters.blocked === true) params.set("blocked", "true");
  if (filters.inconsistent === true) params.set("inconsistent", "true");
  if (filters.partiallyShipped === true) {
    params.set("partiallyShipped", "true");
  }
  if (filters.withCut === true) params.set("withCut", "true");
  if (filters.withActiveResidual === true) {
    params.set("withActiveResidual", "true");
  }
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.stages.length > 0) {
    params.set("stages", filters.stages.join(","));
  }
  const drawerSelection = parseSalesOrderFlowDrawerSelection({
    orderId: drawer?.orderId ?? null,
    orderCode: drawer?.orderCode ?? null,
  });
  if (drawerSelection.orderId) params.set("orderId", drawerSelection.orderId);
  if (drawerSelection.orderCode) params.set("order", drawerSelection.orderCode);
  return params;
}

/** UUID v1–v5 (browser-safe). */
export function isSalesOrderFlowUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

export type SalesOrderFlowDrawerSelection = {
  orderId: string | null;
  orderCode: string | null;
  /** true quando orderId veio inválido e foi descartado */
  invalidOrderId: boolean;
};

/**
 * Deep link do drawer: `orderId` (UUID) e/ou `order` (código).
 * Rota inválida de UUID é descartada sem quebrar filtros.
 */
export function parseSalesOrderFlowDrawerFromSearchParams(
  params: URLSearchParams
): SalesOrderFlowDrawerSelection {
  const rawId = params.get("orderId")?.trim() || "";
  const rawCode =
    params.get("order")?.trim() ||
    params.get("orderCode")?.trim() ||
    "";
  if (rawId && !isSalesOrderFlowUuidLike(rawId)) {
    return {
      orderId: null,
      orderCode: rawCode || null,
      invalidOrderId: true,
    };
  }
  return {
    orderId: rawId || null,
    orderCode: rawCode || null,
    invalidOrderId: false,
  };
}

export function parseSalesOrderFlowDrawerSelection(input: {
  orderId?: string | null;
  orderCode?: string | null;
}): { orderId: string | null; orderCode: string | null } {
  const orderIdRaw = input.orderId?.trim() || "";
  const orderCode = input.orderCode?.trim() || "";
  const orderId =
    orderIdRaw && isSalesOrderFlowUuidLike(orderIdRaw) ? orderIdRaw : null;
  return {
    orderId,
    orderCode: orderCode || null,
  };
}

/** Compara search params sem depender da ordem das chaves. */
export function areSalesOrderFlowSearchParamsEqual(
  a: URLSearchParams,
  b: URLSearchParams
): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    if ((a.get(key) ?? "") !== (b.get(key) ?? "")) return false;
  }
  return true;
}

/**
 * Resolve deep link orderId/código contra cards já carregados no Kanban.
 * Com orderId válido, abre mesmo se o card ainda não estiver na página.
 */
export function resolveSalesOrderFlowDrawerFromCards(
  cards: ReadonlyArray<{ orderId: string; orderCode: string }>,
  selection: { orderId?: string | null; orderCode?: string | null }
): { id: string; code: string } | null {
  const parsed = parseSalesOrderFlowDrawerSelection(selection);
  if (parsed.orderId) {
    const byId = cards.find((card) => card.orderId === parsed.orderId);
    return {
      id: parsed.orderId,
      code: byId?.orderCode ?? parsed.orderCode ?? "",
    };
  }
  if (!parsed.orderCode) return null;
  const needle = parsed.orderCode.toLowerCase();
  const byCode = cards.find(
    (card) => card.orderCode.trim().toLowerCase() === needle
  );
  return byCode ? { id: byCode.orderId, code: byCode.orderCode } : null;
}

export function collectSalesOrderFlowCardsFromColumnStates(
  columnStates: Record<string, { cards: ReadonlyArray<{ orderId: string; orderCode: string }> }>
): Array<{ orderId: string; orderCode: string }> {
  const out: Array<{ orderId: string; orderCode: string }> = [];
  const seen = new Set<string>();
  for (const state of Object.values(columnStates)) {
    for (const card of state.cards) {
      if (seen.has(card.orderId)) continue;
      seen.add(card.orderId);
      out.push({ orderId: card.orderId, orderCode: card.orderCode });
    }
  }
  return out;
}

export function hasActiveSalesOrderFlowFilters(
  filters: SalesOrderFlowUiFilters
): boolean {
  return Boolean(
    filters.q.trim() ||
      filters.customerId.trim() ||
      filters.sellerKey.trim() ||
      filters.company.trim() ||
      filters.product.trim() ||
      filters.sector.trim() ||
      filters.issueFrom ||
      filters.issueTo ||
      filters.promisedFrom ||
      filters.promisedTo ||
      filters.overdue === true ||
      filters.blocked === true ||
      filters.inconsistent === true ||
      filters.partiallyShipped === true ||
      filters.withCut === true ||
      filters.withActiveResidual === true ||
      filters.priority ||
      filters.stages.length > 0
  );
}

export function isSalesOrderFlowDateRangeInvalid(
  from: string,
  to: string
): boolean {
  return Boolean(from && to && from > to);
}

export function areSalesOrderFlowFilterDateRangesInvalid(
  filters: Pick<
    SalesOrderFlowUiFilters,
    "issueFrom" | "issueTo" | "promisedFrom" | "promisedTo"
  >
): boolean {
  return (
    isSalesOrderFlowDateRangeInvalid(filters.issueFrom, filters.issueTo) ||
    isSalesOrderFlowDateRangeInvalid(filters.promisedFrom, filters.promisedTo)
  );
}

export function salesOrderFlowFiltersToClientQuery(
  filters: SalesOrderFlowUiFilters
): {
  q: string | null;
  customerId: string | null;
  sellerKey: string | null;
  company: string | null;
  product: string | null;
  sector: string | null;
  issueFrom: string | null;
  issueTo: string | null;
  promisedFrom: string | null;
  promisedTo: string | null;
  overdue: boolean | null;
  blocked: boolean | null;
  inconsistent: boolean | null;
  partiallyShipped: boolean | null;
  withCut: boolean | null;
  withActiveResidual: boolean | null;
  priority: SalesOrderFlowUiPriority | null;
  stages: SalesOrderFlowStage[] | null;
} {
  return {
    q: filters.q.trim() || null,
    customerId: filters.customerId.trim() || null,
    sellerKey: filters.sellerKey.trim() || null,
    company: filters.company.trim() || null,
    product: filters.product.trim() || null,
    sector: filters.sector.trim() || null,
    issueFrom: filters.issueFrom || null,
    issueTo: filters.issueTo || null,
    promisedFrom: filters.promisedFrom || null,
    promisedTo: filters.promisedTo || null,
    overdue: filters.overdue,
    blocked: filters.blocked,
    inconsistent: filters.inconsistent,
    partiallyShipped: filters.partiallyShipped,
    withCut: filters.withCut,
    withActiveResidual: filters.withActiveResidual,
    priority: filters.priority,
    stages: filters.stages.length > 0 ? filters.stages : null,
  };
}
