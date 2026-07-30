/**
 * Contrato frontend-safe — Relatório de descontos comerciais (Pedidos de Venda).
 * Sem Prisma. Sem Proposta. Sem margem gerencial/DRE.
 *
 * Valores canônicos: bruto / desconto efetivo / líquido (salesOrderItemCommercialValues)
 * e margem comercial (read model / motor oficial).
 */
import { roundPricingMoney, roundPricingPercent } from "@/src/lib/pricingCalculations.js";
import type { SalesOrderItemCommercialDiscountStatus } from "@/src/lib/salesOrderItemCommercialValues.js";

export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_TITLE =
  "Relatório de descontos comerciais";
export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE =
  "Valor bruto, valor concedido em descontos, líquido e margem comercial dos Pedidos de Venda";

export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_DEFAULT = 50;
export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_PAGE_SIZE_MAX = 100;
export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_ORDERS_TAKE_MAX = 5000;
export const SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_EXPORT_ROWS_MAX = 10000;

export type CommercialDiscountPresenceFilter =
  | "all"
  | "with_discount"
  | "without_discount"
  | "with_addition"
  | "margin_unavailable";

export type CommercialDiscountBillingFilter =
  | "all"
  | "invoiced"
  | "not_invoiced";

export type CommercialDiscountReportSortBy =
  | "issueDate"
  | "orderCode"
  | "customer"
  | "seller"
  | "discountValue"
  | "discountRate"
  | "grossValue"
  | "netValue"
  | "commercialMarginValue"
  | "commercialMarginPercent";

export type CommercialDiscountReportFilterLabels = Array<{
  label: string;
  value: string;
}>;

export type CommercialDiscountReportKpis = {
  grossActiveTotalValue: number;
  /** Valor concedido em descontos (R$) — nunca rotular como prejuízo. */
  discountTotalValue: number;
  /** Desconto ponderado = discountTotalValue / grossActiveTotalValue. */
  discountTotalRate: number | null;
  netActiveTotalValue: number;
  commercialAdditionTotalValue: number;
  commercialMarginTotalValue: number | null;
  commercialMarginTotalPercent: number | null;
  commercialMarginCoveragePercent: number | null;
  ordersInScope: number;
  ordersWithDiscount: number;
  itemsActive: number;
  itemsWithDiscount: number;
  itemsWithAddition: number;
  itemsMarginUnavailable: number;
  itemsWithDiscountDivergence: number;
};

export type CommercialDiscountDimensionRow = {
  key: string;
  label: string;
  orderCount: number;
  itemCount: number;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number | null;
  netActiveValue: number;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
  commercialMarginCoveragePercent: number | null;
};

export type CommercialDiscountMonthlyPoint = {
  monthKey: string; // YYYY-MM
  label: string;
  orderCount: number;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number | null;
  netActiveValue: number;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
};

export type CommercialDiscountOrderHighlight = {
  salesOrderId: string;
  orderCode: string;
  issueDate: string | null;
  customerName: string;
  sellerName: string;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number | null;
  netActiveValue: number;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
  commercialMarginCoveragePercent: number | null;
  hasInvoice: boolean;
};

export type CommercialDiscountProductRiskRow = {
  productId: string;
  sku: string;
  productName: string;
  familyName: string;
  itemCount: number;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number | null;
  netActiveValue: number;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
};

export type CommercialDiscountDetailRow = {
  salesOrderId: string;
  orderCode: string;
  issueDate: string | null;
  customerId: string | null;
  customerName: string;
  sellerName: string;
  hasInvoice: boolean;
  itemId: string;
  itemSequence: string | null;
  productId: string;
  sku: string;
  productName: string;
  familyName: string;
  activeQuantity: number;
  grossUnitPrice: number;
  grossActiveValue: number;
  discountValue: number;
  discountRate: number | null;
  netUnitPrice: number | null;
  netActiveValue: number | null;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
  marginStatus: "CALCULATED" | "UNAVAILABLE" | "NO_ACTIVE_VALUE";
  marginStatusLabel: string;
  discountStatus: SalesOrderItemCommercialDiscountStatus;
  discountStatusLabel: string;
  hasDiscountDivergence: boolean;
  divergenceLabel: string | null;
};

export type CommercialDiscountReportViews = {
  monthlyEvolution: CommercialDiscountMonthlyPoint[];
  bySeller: CommercialDiscountDimensionRow[];
  byCustomer: CommercialDiscountDimensionRow[];
  byProduct: CommercialDiscountDimensionRow[];
  byFamily: CommercialDiscountDimensionRow[];
  topOrdersByDiscountValue: CommercialDiscountOrderHighlight[];
  topOrdersByDiscountRate: CommercialDiscountOrderHighlight[];
  highDiscountLowMarginProducts: CommercialDiscountProductRiskRow[];
  /** KPIs do universo antes dos filtros de faixa/desconto/margem (só período/vendedor/cliente/produto base). */
  kpisBeforeBandFilters: CommercialDiscountReportKpis;
  divergenceItemCount: number;
};

export type CommercialDiscountReportFilters = {
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  month: number | null;
  customerId: string | null;
  customerName: string | null;
  sellerKey: string | null;
  sellerLabel: string | null;
  productId: string | null;
  productQuery: string | null;
  family: string | null;
  discountRateMin: number | null;
  discountRateMax: number | null;
  marginPercentMin: number | null;
  marginPercentMax: number | null;
  presence: CommercialDiscountPresenceFilter;
  billing: CommercialDiscountBillingFilter;
  page: number;
  pageSize: number;
  sortBy: CommercialDiscountReportSortBy;
  sortDir: "asc" | "desc";
};

export type CommercialDiscountReportPayload = {
  title: string;
  subtitle: string;
  generatedAt: string;
  emitterName: string | null;
  filters: CommercialDiscountReportFilters;
  filterLabels: CommercialDiscountReportFilterLabels;
  kpis: CommercialDiscountReportKpis;
  views: CommercialDiscountReportViews;
  rows: CommercialDiscountDetailRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  meta: {
    ordersLoaded: number;
    ordersTakeLimit: number;
    truncated: boolean;
    includeMargin: boolean;
    queryBudgetOrders: number;
  };
};

export const DISCOUNT_STATUS_LABEL: Record<
  SalesOrderItemCommercialDiscountStatus,
  string
> = {
  NO_DISCOUNT: "Sem desconto",
  DISCOUNT: "Com desconto",
  ADDITION: "Acréscimo comercial",
  NO_ACTIVE_VALUE: "Sem valor ativo",
  INCOMPLETE: "Composição incompleta",
};

export function marginStatusLabel(
  status: CommercialDiscountDetailRow["marginStatus"]
): string {
  switch (status) {
    case "CALCULATED":
      return "Calculada";
    case "UNAVAILABLE":
      return "Não calculada";
    case "NO_ACTIVE_VALUE":
      return "Sem valor ativo";
    default:
      return status;
  }
}

export function emptyCommercialDiscountKpis(
  overrides: Partial<CommercialDiscountReportKpis> = {}
): CommercialDiscountReportKpis {
  return {
    grossActiveTotalValue: 0,
    discountTotalValue: 0,
    discountTotalRate: null,
    netActiveTotalValue: 0,
    commercialAdditionTotalValue: 0,
    commercialMarginTotalValue: null,
    commercialMarginTotalPercent: null,
    commercialMarginCoveragePercent: null,
    ordersInScope: 0,
    ordersWithDiscount: 0,
    itemsActive: 0,
    itemsWithDiscount: 0,
    itemsWithAddition: 0,
    itemsMarginUnavailable: 0,
    itemsWithDiscountDivergence: 0,
    ...overrides,
  };
}

/** Desconto % ponderado — nunca média simples. */
export function weightedDiscountRate(
  discountTotalValue: number,
  grossActiveTotalValue: number
): number | null {
  if (!(grossActiveTotalValue > 0)) return null;
  return (
    roundPricingPercent((discountTotalValue / grossActiveTotalValue) * 100) / 100
  );
}

/** Margem % ponderada — Σ margem R$ / Σ líquido coberto. */
export function weightedCommercialMarginPercent(
  marginValue: number | null,
  coveredNetValue: number
): number | null {
  if (marginValue == null || !(coveredNetValue > 0)) return null;
  return roundPricingPercent((marginValue / coveredNetValue) * 100);
}

export function yearMonthKeyFromIssueIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthLabelPtBr(monthKey: string): string {
  const [ys, ms] = monthKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  return label.replace(".", "");
}

export function buildCommercialDiscountFilterLabels(
  filters: CommercialDiscountReportFilters
): CommercialDiscountReportFilterLabels {
  const labels: CommercialDiscountReportFilterLabels = [];
  if (filters.startDate || filters.endDate) {
    labels.push({
      label: "Emissão",
      value: `${filters.startDate ?? "…"} — ${filters.endDate ?? "…"}`,
    });
  }
  if (filters.year != null) {
    labels.push({
      label: "Ano/mês",
      value:
        filters.month != null
          ? `${String(filters.month).padStart(2, "0")}/${filters.year}`
          : String(filters.year),
    });
  }
  if (filters.customerName || filters.customerId) {
    labels.push({
      label: "Cliente",
      value: filters.customerName || filters.customerId || "—",
    });
  }
  if (filters.sellerLabel || filters.sellerKey) {
    labels.push({
      label: "Vendedor",
      value: filters.sellerLabel || filters.sellerKey || "—",
    });
  }
  if (filters.productId || filters.productQuery) {
    labels.push({
      label: "Produto",
      value: filters.productQuery || filters.productId || "—",
    });
  }
  if (filters.family) {
    labels.push({ label: "Família", value: filters.family });
  }
  if (filters.discountRateMin != null || filters.discountRateMax != null) {
    const min =
      filters.discountRateMin != null
        ? `${roundPricingPercent(filters.discountRateMin * 100)}%`
        : "…";
    const max =
      filters.discountRateMax != null
        ? `${roundPricingPercent(filters.discountRateMax * 100)}%`
        : "…";
    labels.push({ label: "Faixa de desconto", value: `${min} — ${max}` });
  }
  if (filters.marginPercentMin != null || filters.marginPercentMax != null) {
    const min =
      filters.marginPercentMin != null
        ? `${roundPricingPercent(filters.marginPercentMin)}%`
        : "…";
    const max =
      filters.marginPercentMax != null
        ? `${roundPricingPercent(filters.marginPercentMax)}%`
        : "…";
    labels.push({ label: "Faixa de margem comercial", value: `${min} — ${max}` });
  }
  if (filters.presence !== "all") {
    const map: Record<CommercialDiscountPresenceFilter, string> = {
      all: "Todos",
      with_discount: "Com desconto",
      without_discount: "Sem desconto",
      with_addition: "Com acréscimo",
      margin_unavailable: "Margem não calculada",
    };
    labels.push({ label: "Presença", value: map[filters.presence] });
  }
  if (filters.billing !== "all") {
    labels.push({
      label: "Faturamento",
      value: filters.billing === "invoiced" ? "Pedido faturado" : "Pedido não faturado",
    });
  }
  return labels;
}

/**
 * Período (startDate/endDate) sobrescreve Ano/Mês no relatório de descontos.
 * Quando qualquer data de emissão está preenchida, year/month são ignorados.
 */
export function applyCommercialDiscountPeriodOverride<
  T extends Record<string, unknown>,
>(query: T): T {
  const start = String(query.startDate ?? "").trim();
  const end = String(query.endDate ?? "").trim();
  if (!start && !end) return query;
  return {
    ...query,
    year: undefined,
    month: undefined,
  };
}

/** Default de carregamento: ano corrente, mês em branco (todo o ano). */
export function createDefaultCommercialDiscountYearMonth(
  now: Date = new Date()
): { year: string; month: string } {
  return {
    year: String(now.getFullYear()),
    month: "",
  };
}

/**
 * Monta query string dos filtros do relatório.
 * Com período explícito, não envia year/month (override).
 */
export function buildCommercialDiscountReportSearchParams(input: {
  year?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string;
  seller?: string;
  productQuery?: string;
  family?: string;
  discountRateMin?: string;
  discountRateMax?: string;
  marginPercentMin?: string;
  marginPercentMax?: string;
  presence?: string;
  billing?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  const startDate = input.startDate?.trim() ?? "";
  const endDate = input.endDate?.trim() ?? "";
  const hasPeriod = Boolean(startDate || endDate);
  if (hasPeriod) {
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
  } else {
    const year = input.year?.trim() ?? "";
    const month = input.month?.trim() ?? "";
    if (year && year !== "all") params.set("year", year);
    if (year && year !== "all" && month) params.set("month", month);
  }
  if (input.customerId?.trim()) params.set("customerId", input.customerId.trim());
  if (input.seller?.trim()) params.set("seller", input.seller.trim());
  if (input.productQuery?.trim()) params.set("productQuery", input.productQuery.trim());
  if (input.family?.trim()) params.set("family", input.family.trim());
  if (input.discountRateMin?.trim()) {
    params.set("discountRateMin", input.discountRateMin.trim());
  }
  if (input.discountRateMax?.trim()) {
    params.set("discountRateMax", input.discountRateMax.trim());
  }
  if (input.marginPercentMin?.trim()) {
    params.set("marginPercentMin", input.marginPercentMin.trim());
  }
  if (input.marginPercentMax?.trim()) {
    params.set("marginPercentMax", input.marginPercentMax.trim());
  }
  if (input.presence && input.presence !== "all") {
    params.set("presence", input.presence);
  }
  if (input.billing && input.billing !== "all") {
    params.set("billing", input.billing);
  }
  params.set("page", String(input.page ?? 1));
  params.set("pageSize", String(input.pageSize ?? 50));
  params.set("sortBy", input.sortBy ?? "discountValue");
  params.set("sortDir", input.sortDir ?? "desc");
  return params;
}

export function redactMarginFromDetailRow(
  row: CommercialDiscountDetailRow
): CommercialDiscountDetailRow {
  return {
    ...row,
    commercialMarginValue: null,
    commercialMarginPercent: null,
    marginStatus: row.activeQuantity > 0 ? "UNAVAILABLE" : "NO_ACTIVE_VALUE",
    marginStatusLabel: "Sem permissão",
  };
}

export function redactMarginFromKpis(
  kpis: CommercialDiscountReportKpis
): CommercialDiscountReportKpis {
  return {
    ...kpis,
    commercialMarginTotalValue: null,
    commercialMarginTotalPercent: null,
    commercialMarginCoveragePercent: null,
  };
}

export function roundMoney(value: number): number {
  return roundPricingMoney(value);
}
