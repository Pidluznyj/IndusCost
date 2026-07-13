/**
 * Cliente UI — Status Pedidos (Conciliação de Carteira).
 * Monta query e copy; não recalcula agregação (backend).
 */

import {
  ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE,
  type OrderToCashAuditListFilters,
  type OrderToCashAuditRunMeta,
} from "./orderToCashAuditApi.js";
import {
  ORDER_STATUS_PEDIDOS_DEFAULT_SORT_BY,
  ORDER_STATUS_PEDIDOS_DEFAULT_SORT_DIRECTION,
  ORDER_STATUS_PEDIDOS_SORT_WHITELIST,
  type OrderStatusPedidosListPayload,
  type OrderStatusPedidosSortBy,
  type OrderStatusPedidosSortDirection,
  type OrderStatusPedidosStatus,
  type OrderStatusPedidosSummary,
} from "./orderStatusPedidosApi.js";

export const ORDER_STATUS_PEDIDOS_TAB_TITLE = "Status Pedidos";

export const ORDER_STATUS_PEDIDOS_TAB_SUBTITLE =
  "Visão consolidada por Pedido de Venda: atendimento, CR e divergências. Uma linha por pedido — evidências de item ficam no detalhe.";

export const ORDER_STATUS_PEDIDOS_HEAVY_WARNING =
  "Esta visão agrega a run materializada por pedido. Informe o ano e clique em Pesquisar (cliente opcional).";

export const ORDER_STATUS_PEDIDOS_SELECT_MESSAGE =
  "Informe o ano e clique em Pesquisar. Sem cliente, usa a run geral OrderToCashAudit.";

export const ORDER_STATUS_PEDIDOS_LOADING_MESSAGE = "Carregando status dos pedidos…";

export const ORDER_STATUS_PEDIDOS_EMPTY_MESSAGE =
  "Nenhum pedido encontrado para os filtros informados.";

export const ORDER_STATUS_PEDIDOS_EMPTY_NO_RUN_MESSAGE =
  "Nenhuma run materializada de auditoria Pedido → Caixa encontrada. Execute o rebuild (apply) e tente novamente.";

export const ORDER_STATUS_PEDIDOS_ERROR_MESSAGE =
  "Não foi possível carregar o Status Pedidos agora.";

export const ORDER_STATUS_PEDIDOS_API_PATH =
  "/api/finance/portfolio-reconciliation/order-status-pedidos";

export const ORDER_STATUS_PEDIDOS_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

export type OrderStatusPedidosUiFilters = {
  customerId: string;
  customerExternalId: string;
  customerName: string;
  year: string;
  page: number;
  pageSize: number;
  sortBy: OrderStatusPedidosSortBy;
  sortDirection: OrderStatusPedidosSortDirection;
  orderCode: string;
  sellerName: string;
  orderStatus: string;
  onlyWithPendingItems: boolean;
  onlyWithOpenCr: boolean;
  onlyWithDivergences: boolean;
  onlyWithAlerts: boolean;
  runId: string;
};

export function createDefaultOrderStatusPedidosUiFilters(): OrderStatusPedidosUiFilters {
  return {
    customerId: "",
    customerExternalId: "",
    customerName: "",
    year: String(new Date().getFullYear()),
    page: 1,
    pageSize: ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE,
    sortBy: ORDER_STATUS_PEDIDOS_DEFAULT_SORT_BY,
    sortDirection: ORDER_STATUS_PEDIDOS_DEFAULT_SORT_DIRECTION,
    orderCode: "",
    sellerName: "",
    orderStatus: "",
    onlyWithPendingItems: false,
    onlyWithOpenCr: false,
    onlyWithDivergences: false,
    onlyWithAlerts: false,
    runId: "",
  };
}

export function canSearchOrderStatusPedidos(filters: OrderStatusPedidosUiFilters): boolean {
  const year = Number(filters.year);
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

export function buildOrderStatusPedidosListQuery(
  filters: OrderStatusPedidosUiFilters
): string {
  const params = new URLSearchParams();
  if (filters.customerExternalId.trim()) {
    params.set("customerExternalId", filters.customerExternalId.trim());
  }
  if (filters.customerId.trim()) params.set("customerId", filters.customerId.trim());
  if (filters.customerName.trim()) params.set("customerName", filters.customerName.trim());
  if (filters.year.trim()) params.set("year", filters.year.trim());
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
  if (filters.sellerName.trim()) params.set("sellerName", filters.sellerName.trim());
  if (filters.orderStatus.trim()) params.set("orderStatus", filters.orderStatus.trim());
  if (filters.onlyWithPendingItems) params.set("onlyWithPendingItems", "1");
  if (filters.onlyWithOpenCr) params.set("onlyWithOpenCr", "1");
  if (filters.onlyWithDivergences) params.set("onlyWithDivergences", "1");
  if (filters.onlyWithAlerts) params.set("onlyWithAlerts", "1");
  if (filters.runId.trim()) params.set("runId", filters.runId.trim());
  return params.toString();
}

export function nextOrderStatusPedidosSort(
  current: OrderStatusPedidosUiFilters,
  columnSortKey: string
): OrderStatusPedidosUiFilters {
  const allowed = ORDER_STATUS_PEDIDOS_SORT_WHITELIST as readonly string[];
  if (!allowed.includes(columnSortKey)) return current;
  const sortBy = columnSortKey as OrderStatusPedidosSortBy;
  if (current.sortBy === sortBy) {
    return {
      ...current,
      sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
      page: 1,
    };
  }
  return { ...current, sortBy, sortDirection: "desc", page: 1 };
}

export function formatOrderStatusPedidosRunScope(run: OrderToCashAuditRunMeta | null): string {
  if (!run) return "Sem run";
  if (run.isGeneralRun) return "Run geral";
  return run.customerFilter
    ? `Run específica (cliente ${run.customerFilter})`
    : "Run materializada";
}

export type {
  OrderStatusPedidosListPayload,
  OrderStatusPedidosSummary,
  OrderStatusPedidosStatus,
  OrderToCashAuditListFilters,
};
