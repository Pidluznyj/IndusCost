/**
 * Cliente UI — Auditoria Pedido → Caixa (Conciliação de Carteira).
 * Monta query string e helpers de sort; não recalcula fatos.
 */

import {
  ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE,
  ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY,
  ORDER_TO_CASH_AUDIT_DEFAULT_SORT_DIRECTION,
  ORDER_TO_CASH_AUDIT_SORT_WHITELIST,
  type OrderToCashAuditAvailableFilters,
  type OrderToCashAuditListRow,
  type OrderToCashAuditListSummary,
  type OrderToCashAuditRunMeta,
  type OrderToCashAuditSortBy,
  type OrderToCashAuditSortDirection,
} from "./orderToCashAuditApi.js";

export const ORDER_TO_CASH_AUDIT_TAB_TITLE = "Auditoria Pedido → Caixa";

export const ORDER_TO_CASH_AUDIT_TAB_SUBTITLE =
  "Veja, item a item, como o Pedido de Venda evoluiu para Documento de Saída, NF, Contas a Receber e pagamento.";

export const ORDER_TO_CASH_AUDIT_HEAVY_WARNING =
  "Esta visão é pesada e não carrega automaticamente. Selecione Cliente e Ano para pesquisar.";

export const ORDER_TO_CASH_AUDIT_SELECT_MESSAGE =
  "Selecione Cliente e Ano para carregar a auditoria.";

export const ORDER_TO_CASH_AUDIT_SELECT_FILTER_MESSAGE =
  "Selecione um cliente e um ano para pesquisar.";

export const ORDER_TO_CASH_AUDIT_LOADING_MESSAGE =
  "Carregando auditoria Pedido → Caixa...";

export const ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE =
  "Nenhuma linha de auditoria encontrada para este cliente e ano. Verifique se a rotina de rebuild já foi executada.";

export const ORDER_TO_CASH_AUDIT_ERROR_MESSAGE =
  "Não foi possível carregar a auditoria agora.";

export const ORDER_TO_CASH_AUDIT_API_PATH =
  "/api/finance/portfolio-reconciliation/order-to-cash-audit";

export const ORDER_TO_CASH_AUDIT_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

export type OrderToCashAuditUiFilters = {
  customerId: string;
  customerExternalId: string;
  /** Nome para fallback na API quando não houver código Nomus. */
  customerName: string;
  year: string;
  page: number;
  pageSize: number;
  sortBy: OrderToCashAuditSortBy;
  sortDirection: OrderToCashAuditSortDirection;
  orderCode: string;
  sellerName: string;
  productCode: string;
  sku: string;
  nfeNumber: string;
  stockDocumentExternalId: string;
  orderToCashStage: string;
  operationalStage: string;
  financialStage: string;
  paymentStatus: string;
  temperature: string;
  confidenceLabel: string;
  hasAlerts: boolean;
  onlyWithExcess: boolean;
  onlyWithProductOutsideOrder: boolean;
  onlyWithoutDocument: boolean;
  onlyWithoutReceivable: boolean;
  onlyOverdue: boolean;
  runId: string;
};

export type OrderToCashAuditListPayload = {
  ok: boolean;
  message: string | null;
  filters: Record<string, unknown>;
  requiredSelection: {
    customerRequired: true;
    yearRequired: true;
    readyToSearch: boolean;
    message: string | null;
  };
  run: OrderToCashAuditRunMeta | null;
  summary: OrderToCashAuditListSummary;
  rows: OrderToCashAuditListRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  sorting: {
    sortBy: OrderToCashAuditSortBy;
    sortDirection: OrderToCashAuditSortDirection;
    whitelist: string[];
  };
  availableFilters: OrderToCashAuditAvailableFilters;
};

export function createDefaultOrderToCashAuditUiFilters(
  overrides: Partial<OrderToCashAuditUiFilters> = {}
): OrderToCashAuditUiFilters {
  return {
    customerId: "",
    customerExternalId: "",
    customerName: "",
    year: String(new Date().getFullYear()),
    page: 1,
    pageSize: ORDER_TO_CASH_AUDIT_DEFAULT_PAGE_SIZE,
    sortBy: ORDER_TO_CASH_AUDIT_DEFAULT_SORT_BY,
    sortDirection: ORDER_TO_CASH_AUDIT_DEFAULT_SORT_DIRECTION,
    orderCode: "",
    sellerName: "",
    productCode: "",
    sku: "",
    nfeNumber: "",
    stockDocumentExternalId: "",
    orderToCashStage: "",
    operationalStage: "",
    financialStage: "",
    paymentStatus: "",
    temperature: "",
    confidenceLabel: "",
    hasAlerts: false,
    onlyWithExcess: false,
    onlyWithProductOutsideOrder: false,
    onlyWithoutDocument: false,
    onlyWithoutReceivable: false,
    onlyOverdue: false,
    runId: "",
    ...overrides,
  };
}

export function canSearchOrderToCashAudit(filters: {
  customerId?: string;
  customerExternalId?: string;
  customerName?: string;
  year?: string;
}): boolean {
  const hasCustomer =
    Boolean(filters.customerId?.trim()) ||
    Boolean(filters.customerExternalId?.trim()) ||
    Boolean(filters.customerName?.trim());
  const hasYear = Boolean(filters.year?.trim());
  return hasCustomer && hasYear;
}

/** Extrai código Nomus numérico de `code` do autocomplete, se houver. */
export function resolveExternalCustomerIdFromSelection(selection: {
  code?: string | null;
} | null): string {
  const raw = String(selection?.code ?? "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 && /^\d+$/.test(digits) ? digits : "";
}

export function buildOrderToCashAuditListQuery(filters: OrderToCashAuditUiFilters): string {
  const params = new URLSearchParams();
  if (filters.customerExternalId.trim()) {
    params.set("customerExternalId", filters.customerExternalId.trim());
  } else if (filters.customerId.trim()) {
    params.set("customerId", filters.customerId.trim());
  }
  if (filters.customerName.trim() && !filters.customerExternalId.trim()) {
    params.set("customerName", filters.customerName.trim());
  }
  if (filters.year.trim()) params.set("year", filters.year.trim());
  params.set("page", String(Math.max(1, filters.page)));
  params.set("pageSize", String(Math.max(1, filters.pageSize)));
  params.set("sortBy", filters.sortBy);
  params.set("sortDirection", filters.sortDirection);
  if (filters.orderCode.trim()) params.set("orderCode", filters.orderCode.trim());
  if (filters.sellerName.trim()) params.set("sellerName", filters.sellerName.trim());
  if (filters.productCode.trim()) params.set("productCode", filters.productCode.trim());
  if (filters.sku.trim()) params.set("sku", filters.sku.trim());
  if (filters.nfeNumber.trim()) params.set("nfeNumber", filters.nfeNumber.trim());
  if (filters.stockDocumentExternalId.trim()) {
    params.set("stockDocumentExternalId", filters.stockDocumentExternalId.trim());
  }
  if (filters.orderToCashStage.trim()) {
    params.set("orderToCashStage", filters.orderToCashStage.trim());
  }
  if (filters.operationalStage.trim()) {
    params.set("operationalStage", filters.operationalStage.trim());
  }
  if (filters.financialStage.trim()) {
    params.set("financialStage", filters.financialStage.trim());
  }
  if (filters.paymentStatus.trim()) {
    params.set("paymentStatus", filters.paymentStatus.trim());
  }
  if (filters.temperature.trim()) params.set("temperature", filters.temperature.trim());
  if (filters.confidenceLabel.trim()) {
    params.set("confidenceLabel", filters.confidenceLabel.trim());
  }
  if (filters.hasAlerts) params.set("hasAlerts", "true");
  if (filters.onlyWithExcess) params.set("onlyWithExcess", "true");
  if (filters.onlyWithProductOutsideOrder) {
    params.set("onlyWithProductOutsideOrder", "true");
  }
  if (filters.onlyWithoutDocument) params.set("onlyWithoutDocument", "true");
  if (filters.onlyWithoutReceivable) params.set("onlyWithoutReceivable", "true");
  if (filters.onlyOverdue) params.set("onlyOverdue", "true");
  if (filters.runId.trim()) params.set("runId", filters.runId.trim());
  return params.toString();
}

/**
 * Clique em coluna: mesma coluna alterna direção; coluna nova começa em desc.
 * Sempre retorna page = 1.
 */
export function nextOrderToCashAuditSort(
  currentSortBy: OrderToCashAuditSortBy,
  currentDirection: OrderToCashAuditSortDirection,
  clickedColumn: string
): {
  sortBy: OrderToCashAuditSortBy;
  sortDirection: OrderToCashAuditSortDirection;
  page: number;
} {
  const whitelist = ORDER_TO_CASH_AUDIT_SORT_WHITELIST as readonly string[];
  if (!whitelist.includes(clickedColumn)) {
    return {
      sortBy: currentSortBy,
      sortDirection: currentDirection,
      page: 1,
    };
  }
  const sortBy = clickedColumn as OrderToCashAuditSortBy;
  if (sortBy === currentSortBy) {
    return {
      sortBy,
      sortDirection: currentDirection === "asc" ? "desc" : "asc",
      page: 1,
    };
  }
  return { sortBy, sortDirection: "desc", page: 1 };
}

export type OrderToCashAuditBadgeTone =
  | "ok"
  | "healthy"
  | "attention"
  | "blocked"
  | "technical"
  | "neutral";

export function resolveOrderToCashAuditBadgeTone(input: {
  kind: "payment" | "stage" | "temperature" | "confidence" | "alert";
  value: string | null | undefined;
}): OrderToCashAuditBadgeTone {
  const v = (input.value ?? "").trim().toUpperCase();
  if (!v) return "neutral";

  if (input.kind === "alert") return "technical";

  if (input.kind === "payment") {
    if (/RECEB|SETTLED|BAIX|PAGO|PAID|OK/.test(v)) return "ok";
    if (/VENC|OVERDUE|ATRAS|RISK|BLOQ/.test(v)) return "blocked";
    if (/ABERT|OPEN|PARCIAL/.test(v)) return "attention";
    return "neutral";
  }

  if (input.kind === "temperature") {
    if (/VERDE|GREEN|FRIO|OK/.test(v)) return "ok";
    if (/AZUL|BLUE|SAUD/.test(v)) return "healthy";
    if (/AMAREL|YELLOW|ATEN/.test(v)) return "attention";
    if (/VERMELH|RED|QUENTE|RISK|BLOQ/.test(v)) return "blocked";
    return "neutral";
  }

  if (input.kind === "confidence") {
    if (/ALTA|HIGH/.test(v)) return "ok";
    if (/MEDIA|MÉDIA|MEDIUM/.test(v)) return "attention";
    if (/BAIXA|LOW|BLOCK/.test(v)) return "blocked";
    return "neutral";
  }

  // stage
  if (/RECEB|CONCLU|OK|ENTREGUE|LIQUID/.test(v)) return "ok";
  if (/ANDAMENT|FUTURO|PREVIST|SAUD/.test(v)) return "healthy";
  if (/ATEN|PARCIAL|PENDENTE|ABERT/.test(v)) return "attention";
  if (/BLOQ|RISCO|REVISAO|REVISÃO|CRITIC/.test(v)) return "blocked";
  return "neutral";
}

export const ORDER_TO_CASH_AUDIT_BADGE_CLASS: Record<OrderToCashAuditBadgeTone, string> = {
  ok: "bg-[#ECFDF3] border-[#ABEFC6] text-[#067647]",
  healthy: "bg-[#EFF8FF] border-[#B2DDFF] text-[#175CD3]",
  attention: "bg-[#FFFAEB] border-[#FEDF89] text-[#B54708]",
  blocked: "bg-[#FEF3F2] border-[#FECDCA] text-[#B42318]",
  technical: "bg-[#FFF6ED] border-[#FDBA74] text-[#C2410C]",
  neutral: "bg-[#F9FAFB] border-[#EAECF0] text-[#344054]",
};

export function formatOrderToCashAuditQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function yearOptionsForOrderToCashAudit(count = 8): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => current - i);
}
