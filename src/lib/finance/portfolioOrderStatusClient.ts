/**
 * Cliente UI — Status Pedidos (Conciliação de Carteira).
 * Monta query string; não recalcula consolidação (API/backend).
 */

import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
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
  "Nenhuma auditoria Pedido → Caixa materializada.";

export const ORDER_STATUS_EMPTY_FILTERED_MESSAGE =
  "Nenhum pedido encontrado com esses filtros.";

export const ORDER_STATUS_ERROR_MESSAGE =
  "Não foi possível carregar Status Pedidos.";

export const ORDER_STATUS_PERMISSION_MESSAGE =
  "Você não tem permissão para acessar esta aba.";

export const ORDER_STATUS_API_PATH = PORTFOLIO_ORDER_STATUS_API_PATH;

export const ORDER_STATUS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

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

export const ORDER_STATUS_OPERATIONAL_OPTIONS = [
  { value: "FULLY_FULFILLED", label: "Atendido" },
  { value: "PARTIALLY_FULFILLED", label: "Parcial" },
  { value: "NOT_FULFILLED", label: "Sem atendimento" },
] as const;

export const ORDER_STATUS_FINANCIAL_OPTIONS = [
  { value: "CR_OPEN", label: "CR aberto" },
  { value: "CR_RECEIVED", label: "Recebido" },
  { value: "NO_CR", label: "Sem CR" },
] as const;

export const ORDER_STATUS_TEMPERATURE_OPTIONS = [
  { value: "QUENTE", label: "Quente" },
  { value: "MORNO", label: "Morno" },
  { value: "FRIO", label: "Frio" },
  { value: "CONGELADO", label: "Congelado" },
] as const;

export type OrderStatusPeriodPreset =
  | ""
  | "current_year"
  | "last_30"
  | "last_90"
  | "this_month"
  | "last_month"
  | "custom";

export const ORDER_STATUS_PERIOD_PRESETS: ReadonlyArray<{
  value: OrderStatusPeriodPreset;
  label: string;
}> = [
  { value: "current_year", label: "Ano atual" },
  { value: "last_30", label: "Últimos 30 dias" },
  { value: "last_90", label: "Últimos 90 dias" },
  { value: "this_month", label: "Mês atual" },
  { value: "last_month", label: "Mês anterior" },
  { value: "custom", label: "Personalizado" },
];

export const ORDER_STATUS_OPERATIONAL_LABEL: Record<string, string> = {
  FULLY_FULFILLED: "Atendido",
  PARTIALLY_FULFILLED: "Parcial",
  NOT_FULFILLED: "Sem atendimento",
};

export const ORDER_STATUS_FINANCIAL_LABEL: Record<string, string> = {
  CR_OPEN: "CR aberto",
  CR_RECEIVED: "Recebido",
  NO_CR: "Sem CR",
};

export function formatOrderStatusOperationalLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  return ORDER_STATUS_OPERATIONAL_LABEL[value] ?? value;
}

export function formatOrderStatusFinancialLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  return ORDER_STATUS_FINANCIAL_LABEL[value] ?? value;
}

export function formatOrderStatusTemperatureLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const v = value.trim().toUpperCase();
  if (v === "AMARELO" || v === "ÂMBAR" || v === "AMBAR") return "MORNO";
  if (v === "VERDE" || v === "GREEN") return "FRIO";
  if (v === "VERMELHO" || v === "RED") return "QUENTE";
  return v;
}

export function formatOrderStatusAlertLabel(alert: string): string {
  const map: Record<string, string> = {
    DOCUMENTO_COM_EXCEDENTE: "Excedente",
    PRODUTO_FORA_DO_PEDIDO: "Fora do pedido",
    NF_CABECALHO_MAIOR_PEDIDO: "NF > pedido",
    DIVERGENCIA_PRECO: "Preço",
    DOCUMENTO_PARCIAL: "Doc. parcial",
    DOCUMENTO_SEM_CR: "Doc. sem CR",
    CR_SEM_RATEIO_SEGURO: "CR sem rateio",
    CR_VENCIDO: "CR vencido",
    PEDIDO_ANTIGO_SEM_EVOLUCAO: "Antigo s/ evolução",
    SEM_CONDICAO_PAGAMENTO: "Sem cond. pagto",
    SEM_VENDEDOR_NOMUS: "Sem vendedor",
    SEM_RESPONSAVEL_COMERCIAL: "Sem responsável",
    ENTREGA_VENCIDA: "Entrega vencida",
    SEM_DOCUMENTO_SAIDA: "Sem doc. saída",
  };
  return map[alert] ?? alert;
}

export const ORDER_STATUS_ALERT_OPTIONS = [
  ...PORTFOLIO_ORDER_STATUS_DIVERGENCE_ALERTS,
  "CR_VENCIDO",
  "PEDIDO_ANTIGO_SEM_EVOLUCAO",
  "ENTREGA_VENCIDA",
  "SEM_VENDEDOR_NOMUS",
  "SEM_RESPONSAVEL_COMERCIAL",
  "SEM_CONDICAO_PAGAMENTO",
] as const;

export const ORDER_STATUS_STATUS_LABEL: Record<
  PortfolioOrderStatusConsolidated,
  string
> = Object.fromEntries(
  ORDER_STATUS_CONSOLIDATED_OPTIONS.map((o) => [o.value, o.label])
) as Record<PortfolioOrderStatusConsolidated, string>;

export const ORDER_STATUS_PRIMARY_CARD_LABEL: Record<string, string> = {
  total: "Total",
  completos: "Completos",
  parciais: "Parciais",
  sem_atendimento: "Sem atendimento",
  com_divergencia: "Com divergência",
  cr_aberto: "CR aberto",
  recebidos: "Recebidos",
  bloqueados: "Bloqueados",
};

export type OrderStatusUiFilters = {
  customerId: string;
  customerExternalId: string;
  customerName: string;
  year: string;
  periodPreset: OrderStatusPeriodPreset;
  from: string;
  to: string;
  consolidatedStatus: string;
  operationalStatus: string;
  financialStatus: string;
  temperature: string;
  alert: string;
  responsibleName: string;
  sellerName: string;
  productOrSku: string;
  onlyWithOpenCr: boolean;
  onlyWithDivergences: boolean;
  onlyWithPendingBalance: boolean;
  selectedCard: string;
  selectedDrilldown: string;
  page: number;
  pageSize: number;
  sortBy: PortfolioOrderStatusApiSortBy;
  sortDirection: PortfolioOrderStatusApiSortDirection;
  orderCode: string;
};

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function resolveOrderStatusPeriodPreset(
  preset: OrderStatusPeriodPreset,
  today = startOfToday()
): { from: string; to: string; year: string } | null {
  if (!preset || preset === "custom") return null;
  const todayYmd = formatYmdLocal(today);
  const year = String(today.getFullYear());

  if (preset === "current_year") {
    return {
      from: formatYmdLocal(new Date(today.getFullYear(), 0, 1)),
      to: todayYmd,
      year,
    };
  }
  if (preset === "last_30") {
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    return { from: formatYmdLocal(start), to: todayYmd, year };
  }
  if (preset === "last_90") {
    const start = new Date(today);
    start.setDate(start.getDate() - 90);
    return { from: formatYmdLocal(start), to: todayYmd, year };
  }
  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: formatYmdLocal(start), to: formatYmdLocal(end), year };
  }
  if (preset === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      from: formatYmdLocal(start),
      to: formatYmdLocal(end),
      year: String(start.getFullYear()),
    };
  }
  return null;
}

export function applyOrderStatusPeriodPreset(
  filters: OrderStatusUiFilters,
  preset: OrderStatusPeriodPreset
): OrderStatusUiFilters {
  if (preset === "custom") {
    return { ...filters, periodPreset: "custom" };
  }
  if (!preset) {
    return { ...filters, periodPreset: "", from: "", to: "" };
  }
  const range = resolveOrderStatusPeriodPreset(preset);
  if (!range) return { ...filters, periodPreset: preset };
  return {
    ...filters,
    periodPreset: preset,
    from: range.from,
    to: range.to,
    year: range.year,
  };
}

export function createDefaultOrderStatusUiFilters(): OrderStatusUiFilters {
  return {
    customerId: "",
    customerExternalId: "",
    customerName: "",
    year: String(new Date().getFullYear()),
    periodPreset: "",
    from: "",
    to: "",
    consolidatedStatus: "",
    operationalStatus: "",
    financialStatus: "",
    temperature: "",
    alert: "",
    responsibleName: "",
    sellerName: "",
    productOrSku: "",
    onlyWithOpenCr: false,
    onlyWithDivergences: false,
    onlyWithPendingBalance: false,
    selectedCard: "",
    selectedDrilldown: "",
    page: 1,
    pageSize: PORTFOLIO_ORDER_STATUS_DEFAULT_PAGE_SIZE,
    sortBy: PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_BY,
    sortDirection: PORTFOLIO_ORDER_STATUS_DEFAULT_SORT_DIRECTION,
    orderCode: "",
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
  if (filters.operationalStatus.trim()) {
    params.set("operationalStatus", filters.operationalStatus.trim());
  }
  if (filters.financialStatus.trim()) {
    params.set("financialStatus", filters.financialStatus.trim());
  }
  if (filters.temperature.trim()) params.set("temperature", filters.temperature.trim());
  if (filters.alert.trim()) params.set("alert", filters.alert.trim());
  if (filters.responsibleName.trim()) {
    params.set("responsibleName", filters.responsibleName.trim());
  }
  if (filters.sellerName.trim()) params.set("sellerName", filters.sellerName.trim());
  if (filters.productOrSku.trim()) params.set("productOrSku", filters.productOrSku.trim());
  if (filters.onlyWithOpenCr) params.set("onlyWithOpenCr", "1");
  if (filters.onlyWithDivergences) params.set("onlyWithDivergences", "1");
  if (filters.onlyWithPendingBalance) params.set("onlyWithPendingBalance", "1");
  if (filters.selectedCard.trim()) {
    params.set("selectedCard", filters.selectedCard.trim());
  }
  if (filters.selectedDrilldown.trim()) {
    params.set("selectedDrilldown", filters.selectedDrilldown.trim());
  }
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
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

/** Barra de contexto: "Parciais > Produto fora do pedido". */
export function formatOrderStatusFilterContext(args: {
  selectedCard: string;
  selectedDrilldown: string;
  drilldownCards: ReadonlyArray<{ id: string; label: string }>;
}): string | null {
  const cardLabel = args.selectedCard
    ? ORDER_STATUS_PRIMARY_CARD_LABEL[args.selectedCard] ?? args.selectedCard
    : null;
  const drill = args.drilldownCards.find((c) => c.id === args.selectedDrilldown);
  const drillLabel = drill?.label ?? (args.selectedDrilldown || null);

  if (cardLabel && drillLabel) return `${cardLabel} > ${drillLabel}`;
  if (cardLabel) return cardLabel;
  if (drillLabel) return drillLabel;
  return null;
}

export type OrderStatusChipField =
  | keyof OrderStatusUiFilters
  | "customer"
  | "period";

function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Chips dos filtros aplicados (inclui card/drilldown). */
export function buildOrderStatusFilterChips(
  filters: OrderStatusUiFilters,
  onRemove: (field: OrderStatusChipField) => void,
  extras?: {
    drilldownLabel?: string | null;
  }
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];

  if (filters.customerName.trim() || filters.customerExternalId.trim()) {
    chips.push({
      id: "customer",
      label: `Cliente: ${filters.customerName.trim() || filters.customerExternalId}`,
      onRemove: () => onRemove("customer"),
    });
  }
  if (filters.year.trim()) {
    chips.push({
      id: "year",
      label: `Ano: ${filters.year}`,
      onRemove: () => onRemove("year"),
    });
  }
  if (
    filters.periodPreset &&
    filters.periodPreset !== "custom" &&
    filters.periodPreset !== "current_year"
  ) {
    chips.push({
      id: "periodPreset",
      label: `Período: ${optionLabel(ORDER_STATUS_PERIOD_PRESETS, filters.periodPreset)}`,
      onRemove: () => onRemove("periodPreset"),
    });
  } else if (filters.from || filters.to) {
    chips.push({
      id: "period",
      label: `Período: ${filters.from || "…"} → ${filters.to || "…"}`,
      onRemove: () => onRemove("period"),
    });
  }
  if (filters.selectedCard.trim()) {
    chips.push({
      id: "selectedCard",
      label: `Card: ${ORDER_STATUS_PRIMARY_CARD_LABEL[filters.selectedCard] ?? filters.selectedCard}`,
      onRemove: () => onRemove("selectedCard"),
    });
  }
  if (filters.selectedDrilldown.trim()) {
    chips.push({
      id: "selectedDrilldown",
      label: `Drilldown: ${extras?.drilldownLabel ?? filters.selectedDrilldown}`,
      onRemove: () => onRemove("selectedDrilldown"),
    });
  }
  if (filters.consolidatedStatus.trim()) {
    chips.push({
      id: "consolidatedStatus",
      label: `Status: ${optionLabel(ORDER_STATUS_CONSOLIDATED_OPTIONS, filters.consolidatedStatus)}`,
      onRemove: () => onRemove("consolidatedStatus"),
    });
  }
  if (filters.operationalStatus.trim()) {
    chips.push({
      id: "operationalStatus",
      label: `Operacional: ${formatOrderStatusOperationalLabel(filters.operationalStatus)}`,
      onRemove: () => onRemove("operationalStatus"),
    });
  }
  if (filters.financialStatus.trim()) {
    chips.push({
      id: "financialStatus",
      label: `Financeiro: ${formatOrderStatusFinancialLabel(filters.financialStatus)}`,
      onRemove: () => onRemove("financialStatus"),
    });
  }
  if (filters.temperature.trim()) {
    chips.push({
      id: "temperature",
      label: `Temperatura: ${formatOrderStatusTemperatureLabel(filters.temperature)}`,
      onRemove: () => onRemove("temperature"),
    });
  }
  if (filters.alert.trim()) {
    chips.push({
      id: "alert",
      label: `Alerta: ${formatOrderStatusAlertLabel(filters.alert)}`,
      onRemove: () => onRemove("alert"),
    });
  }
  if (filters.responsibleName.trim()) {
    chips.push({
      id: "responsibleName",
      label: `Responsável: ${filters.responsibleName}`,
      onRemove: () => onRemove("responsibleName"),
    });
  }
  if (filters.sellerName.trim()) {
    chips.push({
      id: "sellerName",
      label: `Vendedor: ${filters.sellerName}`,
      onRemove: () => onRemove("sellerName"),
    });
  }
  if (filters.productOrSku.trim()) {
    chips.push({
      id: "productOrSku",
      label: `Produto/SKU: ${filters.productOrSku}`,
      onRemove: () => onRemove("productOrSku"),
    });
  }
  if (filters.onlyWithOpenCr) {
    chips.push({
      id: "onlyWithOpenCr",
      label: "Somente CR aberto",
      onRemove: () => onRemove("onlyWithOpenCr"),
    });
  }
  if (filters.onlyWithDivergences) {
    chips.push({
      id: "onlyWithDivergences",
      label: "Somente divergências",
      onRemove: () => onRemove("onlyWithDivergences"),
    });
  }
  if (filters.onlyWithPendingBalance) {
    chips.push({
      id: "onlyWithPendingBalance",
      label: "Somente saldo pendente",
      onRemove: () => onRemove("onlyWithPendingBalance"),
    });
  }

  return chips;
}

export function clearOrderStatusChipField(
  filters: OrderStatusUiFilters,
  field: OrderStatusChipField
): OrderStatusUiFilters {
  const defaults = createDefaultOrderStatusUiFilters();
  const next = { ...filters, page: 1 };

  switch (field) {
    case "customer":
      next.customerId = "";
      next.customerExternalId = "";
      next.customerName = "";
      break;
    case "year":
      next.year = defaults.year;
      break;
    case "period":
    case "periodPreset":
      next.periodPreset = "";
      next.from = "";
      next.to = "";
      break;
    case "selectedCard":
      next.selectedCard = "";
      next.selectedDrilldown = "";
      break;
    case "selectedDrilldown":
      next.selectedDrilldown = "";
      break;
    case "onlyWithOpenCr":
    case "onlyWithDivergences":
    case "onlyWithPendingBalance":
      next[field] = false;
      break;
    default:
      if (field in next) {
        (next as Record<string, unknown>)[field] = (defaults as Record<string, unknown>)[field];
      }
      break;
  }
  return next;
}

export type { PortfolioOrderStatusListPayload, PortfolioOrderStatusPrimaryCardId };
export { PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE };
