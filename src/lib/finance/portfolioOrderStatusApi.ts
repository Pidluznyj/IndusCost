/**
 * API pura read-only — Status Pedidos (GET …/order-status).
 * Parse de filtros, whitelist de sort, paginação e payload.
 * Sem Prisma; consolidação via portfolioOrderStatusService.
 */

import {
  applyOrderStatusFilters,
  buildDrilldownCards,
  buildOrderStatusSummary,
  buildPortfolioOrderStatus,
  buildPrimaryCards,
  sortOrderStatusRows,
  type BuildPortfolioOrderStatusResult,
  type PortfolioOrderStatusConsolidated,
  type PortfolioOrderStatusFact,
  type PortfolioOrderStatusFilters,
  type PortfolioOrderStatusPrimaryCard,
  type PortfolioOrderStatusPrimaryCardId,
  type PortfolioOrderStatusDrilldownCard,
  type PortfolioOrderStatusRow,
  type PortfolioOrderStatusSortBy,
  type PortfolioOrderStatusSummary,
} from "./portfolioOrderStatusService.js";

export const PORTFOLIO_ORDER_STATUS_API_PATH =
  "/api/finance/portfolio-reconciliation/order-status";

export const PORTFOLIO_ORDER_STATUS_DEFAULT_PAGE_SIZE = 50;
export const PORTFOLIO_ORDER_STATUS_MAX_PAGE_SIZE = 200;
export const PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_BY = "orderIssueDate" as const;
export const PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_DIRECTION = "desc" as const;

export const PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE =
  "Nenhuma run materializada de auditoria Pedido → Caixa encontrada. Execute o rebuild (apply) e tente novamente.";

export const PORTFOLIO_ORDER_STATUS_FILTERED_EMPTY_MESSAGE =
  "A run materializada existe, mas nenhum pedido corresponde aos filtros atuais.";

export const PORTFOLIO_ORDER_STATUS_SOURCE_WARNING =
  "Cards contam pedidos distintos. Auditoria detalhada permanece item a item.";

export const PORTFOLIO_ORDER_STATUS_SORT_WHITELIST = [
  "orderCode",
  "orderIssueDate",
  "orderExpectedDeliveryDate",
  "customerName",
  "orderSellerName",
  "totalOrderValue",
  "allocatedOrderValue",
  "pendingOrderValue",
  "fulfillmentPercent",
  "receivableOpenValue",
  "receivableReceivedValue",
  "consolidatedOrderStatus",
  "temperature",
  "confidenceScore",
] as const satisfies ReadonlyArray<PortfolioOrderStatusSortBy>;

export type PortfolioOrderStatusApiSortBy =
  (typeof PORTFOLIO_ORDER_STATUS_SORT_WHITELIST)[number];

export type PortfolioOrderStatusApiSortDirection = "asc" | "desc";

export type PortfolioOrderStatusListState =
  | "OK"
  | "NO_RUN"
  | "FILTERED_EMPTY";

export class PortfolioOrderStatusApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioOrderStatusApiParseError";
  }
}

export type PortfolioOrderStatusApiFilters = {
  customerExternalId: number | null;
  customerId: string | null;
  customerName: string | null;
  /** Busca inteligente: cliente, pedido, NF ou documento de saída. */
  search: string | null;
  year: number | null;
  from: string | null;
  to: string | null;
  sellerName: string | null;
  responsibleName: string | null;
  orderCode: string | null;
  productOrSku: string | null;
  consolidatedStatus: PortfolioOrderStatusConsolidated | null;
  operationalStatus: string | null;
  financialStatus: string | null;
  temperature: string | null;
  alert: string | null;
  selectedCard: PortfolioOrderStatusPrimaryCardId | null;
  selectedDrilldown: string | null;
  onlyWithOpenCr: boolean;
  onlyWithDivergences: boolean;
  onlyWithPendingBalance: boolean;
  page: number;
  pageSize: number;
  sortBy: PortfolioOrderStatusApiSortBy;
  sortDirection: PortfolioOrderStatusApiSortDirection;
  runId: string | null;
};

export type PortfolioOrderStatusRunMeta = {
  runId: string;
  createdAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  dataSource: "order_to_cash_audit";
  status?: string;
  finishedAt?: string | null;
  isGeneralRun?: boolean;
  year?: number | null;
  customerFilter?: string | null;
  totalOrders?: number;
  totalFacts?: number;
};

export type PortfolioOrderStatusSourceInfo = {
  grain: "sales_order";
  sourceFactGrain: "order_item_evidence";
  warning: string;
};

export type PortfolioOrderStatusListPayload = {
  ok: true;
  state: PortfolioOrderStatusListState;
  message: string | null;
  filters: PortfolioOrderStatusApiFilters;
  runMeta: PortfolioOrderStatusRunMeta | null;
  sourceInfo: PortfolioOrderStatusSourceInfo;
  primaryCards: PortfolioOrderStatusPrimaryCard[];
  drilldownCards: PortfolioOrderStatusDrilldownCard[];
  rows: PortfolioOrderStatusRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  /** Eco do summary seguro (útil para QA; UI pode ignorar). */
  summary: PortfolioOrderStatusSummary | null;
};

const CONSOLIDATED_STATUSES: PortfolioOrderStatusConsolidated[] = [
  "COMPLETO_RECEBIDO",
  "COMPLETO_CR_ABERTO",
  "COMPLETO_SEM_CR",
  "COMPLETO_COM_CANCELAMENTO",
  "RECEBIDO_COM_CANCELAMENTO",
  "PARCIAL_RECEBIDO",
  "PARCIAL_CR_ABERTO",
  "PARCIAL_SEM_CR",
  "PARCIAL_COM_CANCELAMENTO",
  "SEM_ATENDIMENTO_FUTURO",
  "SEM_ATENDIMENTO_ATRASADO",
  "NF_SEM_CR",
  "BLOQUEADO_REVISAO",
  "CANCELADO",
];

const PRIMARY_CARDS: PortfolioOrderStatusPrimaryCardId[] = [
  "total",
  "completos",
  "parciais",
  "sem_atendimento",
  "com_divergencia",
  "cr_aberto",
  "recebidos",
  "com_cancelamento",
  "bloqueados",
];

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asPositiveInt(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new PortfolioOrderStatusApiParseError(`${label} inválido.`);
  }
  return n;
}

function asYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new PortfolioOrderStatusApiParseError("year inválido.");
  }
  return n;
}

function asBool(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "on";
  }
  return false;
}

function clampPageSize(value: unknown): number {
  if (value == null || value === "") return PORTFOLIO_ORDER_STATUS_DEFAULT_PAGE_SIZE;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new PortfolioOrderStatusApiParseError("pageSize inválido.");
  }
  return Math.min(n, PORTFOLIO_ORDER_STATUS_MAX_PAGE_SIZE);
}

function clampPage(value: unknown): number {
  if (value == null || value === "") return 1;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new PortfolioOrderStatusApiParseError("page inválido.");
  }
  return n;
}

export function resolvePortfolioOrderStatusSort(
  sortByRaw: unknown,
  sortDirectionRaw: unknown
): {
  sortBy: PortfolioOrderStatusApiSortBy;
  sortDirection: PortfolioOrderStatusApiSortDirection;
} {
  const sortBy = String(sortByRaw ?? PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_BY).trim();
  const allowed = PORTFOLIO_ORDER_STATUS_SORT_WHITELIST as readonly string[];
  if (!allowed.includes(sortBy)) {
    throw new PortfolioOrderStatusApiParseError(`sortBy inválido: ${sortBy}`);
  }
  const dir = String(
    sortDirectionRaw ?? PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_DIRECTION
  )
    .trim()
    .toLowerCase();
  if (dir !== "asc" && dir !== "desc") {
    throw new PortfolioOrderStatusApiParseError("sortDirection inválido.");
  }
  return {
    sortBy: sortBy as PortfolioOrderStatusApiSortBy,
    sortDirection: dir,
  };
}

export function parsePortfolioOrderStatusFilters(
  query: Record<string, unknown>
): PortfolioOrderStatusApiFilters {
  const { sortBy, sortDirection } = resolvePortfolioOrderStatusSort(
    query.sortBy,
    query.sortDirection
  );

  const consolidatedRaw = asString(query.consolidatedStatus)?.toUpperCase() ?? null;
  let consolidatedStatus: PortfolioOrderStatusConsolidated | null = null;
  if (consolidatedRaw) {
    if (!(CONSOLIDATED_STATUSES as string[]).includes(consolidatedRaw)) {
      throw new PortfolioOrderStatusApiParseError(
        `consolidatedStatus inválido: ${consolidatedRaw}`
      );
    }
    consolidatedStatus = consolidatedRaw as PortfolioOrderStatusConsolidated;
  }

  const cardRaw = asString(query.selectedCard);
  let selectedCard: PortfolioOrderStatusPrimaryCardId | null = null;
  if (cardRaw) {
    if (!(PRIMARY_CARDS as string[]).includes(cardRaw)) {
      throw new PortfolioOrderStatusApiParseError(`selectedCard inválido: ${cardRaw}`);
    }
    selectedCard = cardRaw as PortfolioOrderStatusPrimaryCardId;
  }

  return {
    customerExternalId: asPositiveInt(query.customerExternalId, "customerExternalId"),
    customerId: asString(query.customerId),
    customerName: asString(query.customerName),
    search: asString(query.search),
    year: asYear(query.year),
    from: asString(query.from),
    to: asString(query.to),
    sellerName: asString(query.sellerName),
    responsibleName: asString(query.responsibleName),
    orderCode: asString(query.orderCode),
    productOrSku: asString(query.productOrSku),
    consolidatedStatus,
    operationalStatus: asString(query.operationalStatus),
    financialStatus: asString(query.financialStatus),
    temperature: asString(query.temperature),
    alert: asString(query.alert),
    selectedCard,
    selectedDrilldown: asString(query.selectedDrilldown),
    onlyWithOpenCr: asBool(query.onlyWithOpenCr),
    onlyWithDivergences: asBool(query.onlyWithDivergences),
    onlyWithPendingBalance: asBool(query.onlyWithPendingBalance),
    page: clampPage(query.page),
    pageSize: clampPageSize(query.pageSize),
    sortBy,
    sortDirection,
    runId: asString(query.runId),
  };
}

export function toServiceFilters(
  filters: PortfolioOrderStatusApiFilters
): PortfolioOrderStatusFilters {
  return {
    customerExternalId: filters.customerExternalId,
    customerName: filters.customerName,
    search: filters.search,
    sellerName: filters.sellerName,
    responsibleName: filters.responsibleName,
    productOrSku: filters.productOrSku,
    consolidatedStatus: filters.consolidatedStatus,
    operationalStatus: filters.operationalStatus,
    financialStatus: filters.financialStatus,
    temperature: filters.temperature,
    alert: filters.alert,
    selectedCard: filters.selectedCard,
    selectedDrilldown: filters.selectedDrilldown,
    onlyWithOpenCr: filters.onlyWithOpenCr,
    onlyWithDivergences: filters.onlyWithDivergences,
    onlyWithPendingBalance: filters.onlyWithPendingBalance,
    year: filters.year,
    from: filters.from,
    to: filters.to,
  };
}

export function applyOrderCodeFilter(
  rows: readonly PortfolioOrderStatusRow[],
  orderCode: string | null
): PortfolioOrderStatusRow[] {
  if (!orderCode?.trim()) return [...rows];
  const needle = orderCode.trim().toLowerCase();
  return rows.filter((r) => (r.orderCode ?? "").toLowerCase().includes(needle));
}

export function paginatePortfolioOrderStatusRows(
  rows: readonly PortfolioOrderStatusRow[],
  page: number,
  pageSize: number
): {
  pageRows: PortfolioOrderStatusRow[];
  totalPages: number;
  page: number;
  totalRows: number;
} {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
    page: safePage,
    totalRows,
  };
}

function emptyCards(): PortfolioOrderStatusPrimaryCard[] {
  return buildPrimaryCards([]);
}

function sourceInfo(): PortfolioOrderStatusSourceInfo {
  return {
    grain: "sales_order",
    sourceFactGrain: "order_item_evidence",
    warning: PORTFOLIO_ORDER_STATUS_SOURCE_WARNING,
  };
}

export function buildPortfolioOrderStatusNoRunPayload(
  filters: PortfolioOrderStatusApiFilters
): PortfolioOrderStatusListPayload {
  return {
    ok: true,
    state: "NO_RUN",
    message: PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE,
    filters,
    runMeta: null,
    sourceInfo: sourceInfo(),
    primaryCards: emptyCards(),
    drilldownCards: [],
    rows: [],
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalRows: 0,
      totalPages: 1,
    },
    summary: null,
  };
}

/**
 * Consolida facts → filtra → ordena → pagina → payload.
 * Usado pelo loader Prisma e pelos testes (sem HTTP).
 */
export function buildPortfolioOrderStatusListFromFacts(args: {
  facts: readonly PortfolioOrderStatusFact[];
  filters: PortfolioOrderStatusApiFilters;
  runMeta: PortfolioOrderStatusRunMeta | null;
  asOf?: Date | string | null;
}): PortfolioOrderStatusListPayload {
  const { filters, runMeta } = args;

  if (!runMeta) {
    return buildPortfolioOrderStatusNoRunPayload(filters);
  }

  // orderCode não está no service filters — aplica no universo base antes dos cards
  const serviceFilters = toServiceFilters({
    ...filters,
    selectedCard: null,
    selectedDrilldown: null,
  });
  const baseBuilt: BuildPortfolioOrderStatusResult = buildPortfolioOrderStatus({
    facts: args.facts,
    asOf: args.asOf,
    filters: serviceFilters,
    sort: {
      sortBy: filters.sortBy,
      sortDirection: filters.sortDirection,
    },
    selectedCard: null,
  });

  let baseRows = applyOrderCodeFilter(baseBuilt.rows, filters.orderCode);
  const primaryCards = buildPrimaryCards(baseRows);
  const drilldownCards = buildDrilldownCards(baseRows, filters.selectedCard);

  let rows = applyOrderStatusFilters(baseRows, {
    selectedCard: filters.selectedCard,
    selectedDrilldown: filters.selectedDrilldown,
  });
  rows = sortOrderStatusRows(rows, {
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  });
  const summary = buildOrderStatusSummary(rows);

  const paged = paginatePortfolioOrderStatusRows(
    rows,
    filters.page,
    filters.pageSize
  );

  const state: PortfolioOrderStatusListState =
    paged.totalRows === 0 ? "FILTERED_EMPTY" : "OK";

  return {
    ok: true,
    state,
    message:
      state === "FILTERED_EMPTY" ? PORTFOLIO_ORDER_STATUS_FILTERED_EMPTY_MESSAGE : null,
    filters,
    runMeta,
    sourceInfo: sourceInfo(),
    primaryCards,
    drilldownCards,
    rows: paged.pageRows,
    pagination: {
      page: paged.page,
      pageSize: filters.pageSize,
      totalRows: paged.totalRows,
      totalPages: paged.totalPages,
    },
    summary,
  };
}
