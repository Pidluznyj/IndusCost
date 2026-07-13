/**
 * Cliente UI — Status Pedidos (Conciliação de Carteira).
 * Monta query string; não recalcula consolidação (API/backend).
 */

import {
  PORTFOLIO_ORDER_STATUS_API_PATH,
  PORTFOLIO_ORDER_STATUS_DEFAULT_PAGE_SIZE,
  PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_BY,
  PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_DIRECTION,
  PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE,
  PORTFOLIO_ORDER_STATUS_SORT_WHITELIST,
  type PortfolioOrderStatusApiSortBy,
  type PortfolioOrderStatusApiSortDirection,
  type PortfolioOrderStatusListPayload,
} from "./portfolioOrderStatusApi.js";
import {
  PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS,
  type PortfolioOrderStatusConsolidated,
  type PortfolioOrderStatusPrimaryCardId,
} from "./portfolioOrderStatusService.js";

export const ORDER_STATUS_TAB_TITLE = "Status Pedidos";

export const ORDER_STATUS_TAB_SUBTITLE =
  "Visão consolidada por pedido de venda, baseada na auditoria Pedido → Caixa.";

export const ORDER_STATUS_GRAIN_BADGE = "Grão: Pedido de Venda";

export const ORDER_STATUS_INFO_BANNER =
  "Os cards contam pedidos distintos. A auditoria detalhada continua item a item.";

export const ORDER_STATUS_SELECT_MESSAGE =
  "Informe o ano e clique em Aplicar. Cliente é opcional: sem cliente, a API usa a run geral materializada.";

export const ORDER_STATUS_LOADING_MESSAGE = "Carregando status dos pedidos…";

export const ORDER_STATUS_EMPTY_NO_RUN_MESSAGE =
  "Nenhuma run de auditoria materializada.";

export const ORDER_STATUS_EMPTY_FILTERED_MESSAGE =
  "Nenhum pedido encontrado para os filtros.";

export const ORDER_STATUS_ERROR_MESSAGE =
  "Não foi possível carregar o Status Pedidos agora.";

export const ORDER_STATUS_API_PATH = PORTFOLIO_ORDER_STATUS_API_PATH;

export const ORDER_STATUS_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

export const ORDER_STATUS_CONSOLIDATED_OPTIONS: ReadonlyArray<{
  value: PortfolioOrderStatusConsolidated;
  label: string;
}> = [
  { value: "COMPLETO_RECEBIDO", label: "Completo recebido" },
  { value: "COMPLETO_CR_ABERTO", label: "Completo CR aberto" },
  { value: "COMPLETO_SEM_CR", label: "Completo sem CR" },
  { value: "PARCIAL_RECEBIDO", label: "Parcial recebido" },
  { value: "PARCIAL_CR_ABERTO", label: "Parcial CR aberto" },
  { value: "PARCIAL_SEM_CR", label: "Parcial sem CR" },
  { value: "SEM_ATENDIMENTO_FUTURO", label: "Sem atendimento (futuro)" },
  { value: "SEM_ATENDIMENTO_ATRASADO", label: "Sem atendimento (atrasado)" },
  { value: "NF_SEM_CR", label: "NF sem CR" },
  { value: "BLOQUEADO_REVISAO", label: "Bloqueado / revisão" },
  { value: "CANCELADO", label: "Cancelado" },
];

export const ORDER_STATUS_FINANCIAL_OPTIONS = [
  { value: "CR_OPEN", label: "CR aberto" },
  { value: "CR_RECEIVED", label: "Recebido" },
  { value: "NO_CR", label: "Sem CR" },
] as const;

export const ORDER_STATUS_TEMPERATURE_OPTIONS = [
  { value: "QUENTE", label: "Quente" },
  { value: "AMARELO", label: "Âmbar" },
  { value: "CONGELADO", label: "Congelado" },
] as const;

export const ORDER_STATUS_ALERT_OPTIONS = [
  ...PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS,
  "CR_VENCIDO",
  "PEDIDO_ANTIGO_SEM_EVOLUCAO",
] as const;

export const ORDER_STATUS_STATUS_LABEL: Record<
  PortfolioOrderStatusConsolidated,
  string
> = Object.fromEntries(
  ORDER_STATUS_CONSOLIDATED_OPTIONS.map((o) => [o.value, o.label])
) as Record<PortfolioOrderStatusConsolidated, string>;

export type OrderStatusUiFilters = {
  customerId: string;
  customerExternalId: string;
  customerName: string;
  year: string;
  from: string;
  to: string;
  consolidatedStatus: string;
  financialStatus: string;
  temperature: string;
  alert: string;
  selectedCard: string;
  selectedDrilldown: string;
  page: number;
  pageSize: number;
  sortBy: PortfolioOrderStatusApiSortBy;
  sortDirection: PortfolioOrderStatusApiSortDirection;
  orderCode: string;
  sellerName: string;
};

export function createDefaultOrderStatusUiFilters(): OrderStatusUiFilters {
  return {
    customerId: "",
    customerExternalId: "",
    customerName: "",
    year: String(new Date().getFullYear()),
    from: "",
    to: "",
    consolidatedStatus: "",
    financialStatus: "",
    temperature: "",
    alert: "",
    selectedCard: "",
    selectedDrilldown: "",
    page: 1,
    pageSize: PORTFOLIO_ORDER_STATUS_DEFAULT_PAGE_SIZE,
    sortBy: PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_BY,
    sortDirection: PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_DIRECTION,
    orderCode: "",
    sellerName: "",
  };
}

export function canSearchOrderStatus(filters: OrderStatusUiFilters): boolean {
  const year = Number(filters.year);
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

export function buildOrderStatusListQuery(filters: OrderStatusUiFilters): string {
  const params = new URLSearchParams();
  if (filters.customerExternalId.trim()) {
    params.set("customerExternalId", filters.customerExternalId.trim());
  }
  if (filters.customerId.trim()) params.set("customerId", filters.customerId.trim());
  if (filters.customerName.trim()) params.set("customerName", filters.customerName.trim());
  if (filters.year.trim()) params.set("year", filters.year.trim());
  if (filters.from.trim()) params.set("from", filters.from.trim());
  if (filters.to.trim()) params.set("to", filters.to.trim());
  if (filters.consolidatedStatus.trim()) {
    params.set("consolidatedStatus", filters.consolidatedStatus.trim());
  }
  if (filters.financialStatus.trim()) {
    params.set("financialStatus", filters.financialStatus.trim());
  }
  if (filters.temperature.trim()) params.set("temperature", filters.temperature.trim());
  if (filters.alert.trim()) params.set("alert", filters.alert.trim());
  if (filters.selectedCard.trim()) {
    params.set("selectedCard", filters.selectedCard.trim());
  }
  if (filters.selectedDrilldown.trim()) {
    params.set("selectedDrilldown", filters.selectedDrilldown.trim());
  }
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
  if (filters.sellerName.trim()) params.set("sellerName", filters.sellerName.trim());
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  return params.toString();
}

export function nextOrderStatusSort(
  current: OrderStatusUiFilters,
  columnSortKey: string
): OrderStatusUiFilters {
  const allowed = PORTFOLIO_ORDER_STATUS_SORT_WHITELIST as readonly string[];
  if (!allowed.includes(columnSortKey)) return current;
  const sortBy = columnSortKey as PortfolioOrderStatusApiSortBy;
  if (current.sortBy === sortBy) {
    return {
      ...current,
      sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
      page: 1,
    };
  }
  return { ...current, sortBy, sortDirection: "desc", page: 1 };
}

export function yearOptionsForOrderStatus(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3, y - 4];
}

const PRIMARY_CARD_CONTEXT_LABEL: Record<string, string> = {
  total: "Total",
  completos: "Completos",
  parciais: "Parciais",
  sem_atendimento: "Sem atendimento",
  com_divergencia: "Com divergência",
  cr_aberto: "CR aberto",
  recebidos: "Recebidos",
  bloqueados: "Bloqueados",
};

/** Barra de contexto: "Parciais > Produto fora do pedido". */
export function formatOrderStatusFilterContext(args: {
  selectedCard: string;
  selectedDrilldown: string;
  drilldownCards: ReadonlyArray<{ id: string; label: string }>;
}): string | null {
  const cardLabel = args.selectedCard
    ? PRIMARY_CARD_CONTEXT_LABEL[args.selectedCard] ?? args.selectedCard
    : null;
  const drill = args.drilldownCards.find((c) => c.id === args.selectedDrilldown);
  const drillLabel = drill?.label ?? (args.selectedDrilldown || null);

  if (cardLabel && drillLabel) return `${cardLabel} > ${drillLabel}`;
  if (cardLabel) return cardLabel;
  if (drillLabel) return drillLabel;
  return null;
}

export type { PortfolioOrderStatusListPayload, PortfolioOrderStatusPrimaryCardId };
export { PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE };
