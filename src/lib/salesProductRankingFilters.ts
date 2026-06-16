import { isCancelledSalesOrderStatus } from "@/src/lib/salesOrderDashboardRules.js";
import { isGroupCompanyCustomer, normalizeCnpjDigits } from "@/src/lib/groupCompanyCustomer.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { salesOrderStatusLabel } from "@/src/lib/materialDemandFilters.js";
import type {
  SoldProductsCompanyFilter,
  SoldProductsCustomerScope,
  SoldProductsDashboardFilters,
  SoldProductsDashboardFiltersApplied,
  SoldProductsDateBasis,
  SoldProductsOrderStatusFilter,
  SoldProductsSortBy,
  SoldProductsTopN,
  SoldProductsUiFilters,
} from "@/src/lib/salesProductRankingTypes.js";

export class SoldProductsFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoldProductsFilterParseError";
  }
}

const GROUP_CNPJ_SET = new Set(FINANCE_INTERNAL_GROUP_COMPANIES.map((c) => c.cnpj));

export const SOLD_PRODUCTS_DATE_BASIS_OPTIONS = [
  { value: "issueDate", label: "Data de emissão do pedido" },
  { value: "expectedDeliveryDate", label: "Data de entrega prevista" },
  { value: "invoiceDate", label: "Data de faturamento (NF)" },
] as const;

export const SOLD_PRODUCTS_ORDER_STATUS_OPTIONS = [
  { value: "valid", label: "Válidos (exclui cancelados/erro)" },
  { value: "all", label: "Todos" },
  { value: "cancelled", label: "Cancelados" },
] as const;

export const SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS = [
  { value: "external", label: "Clientes externos" },
  { value: "group", label: "Grupo econômico" },
  { value: "all", label: "Todos" },
] as const;

export const SOLD_PRODUCTS_COMPANY_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "koppetel", label: "Koppetel" },
  { value: "lazarios", label: "Lazarios" },
  { value: "sm", label: "SM" },
] as const;

export const SOLD_PRODUCTS_SORT_OPTIONS = [
  { value: "quantity", label: "Quantidade vendida" },
  { value: "amount", label: "Valor vendido" },
  { value: "orders", label: "Quantidade de pedidos" },
  { value: "customers", label: "Quantidade de clientes" },
] as const;

export const SOLD_PRODUCTS_TOP_N_OPTIONS = [
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "100", label: "Top 100" },
  { value: "all", label: "Todos" },
] as const;

export const EMPTY_SOLD_PRODUCTS_UI_FILTERS: SoldProductsUiFilters = {
  startDate: "",
  endDate: "",
  year: "",
  month: "",
  dateBasis: "issueDate",
  customerName: "",
  customerTaxId: "",
  customerId: "",
  productCode: "",
  productName: "",
  sellerKey: "",
  company: "all",
  orderStatus: "valid",
  customerScope: "external",
  sortBy: "quantity",
  topN: "50",
};

export function createDefaultSoldProductsUiFilters(referenceDate = new Date()): SoldProductsUiFilters {
  return {
    ...EMPTY_SOLD_PRODUCTS_UI_FILTERS,
    year: String(referenceDate.getFullYear()),
  };
}

export function isDefaultSoldProductsUiFilters(
  filters: SoldProductsUiFilters,
  referenceDate = new Date()
): boolean {
  const defaults = createDefaultSoldProductsUiFilters(referenceDate);
  return (Object.keys(defaults) as Array<keyof SoldProductsUiFilters>).every(
    (key) => filters[key] === defaults[key]
  );
}

function parseYearMonth(
  yearRaw: string,
  monthRaw: string,
  referenceDate: Date
): { year: number; month: number | null } {
  const year = yearRaw.trim()
    ? Number.parseInt(yearRaw.trim(), 10)
    : referenceDate.getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new SoldProductsFilterParseError("Ano inválido.");
  }
  const month = monthRaw.trim() ? Number.parseInt(monthRaw.trim(), 10) : null;
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new SoldProductsFilterParseError("Mês inválido.");
  }
  return { year, month };
}

function parseYmd(raw: string, field: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new SoldProductsFilterParseError(`${field} inválida. Use YYYY-MM-DD.`);
  }
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new SoldProductsFilterParseError(`${field} inválida.`);
  }
  return d;
}

export function resolveSoldProductsDateRange(
  filters: Pick<SoldProductsUiFilters, "startDate" | "endDate" | "year" | "month">,
  referenceDate = new Date()
): { startDate: Date; endDate: Date; year: number; month: number | null } {
  const startExplicit = parseYmd(filters.startDate, "Data inicial");
  const endExplicit = parseYmd(filters.endDate, "Data final");
  if (startExplicit && endExplicit && startExplicit > endExplicit) {
    throw new SoldProductsFilterParseError("Data inicial não pode ser maior que a data final.");
  }
  if (startExplicit || endExplicit) {
    const startDate = startExplicit ?? new Date(referenceDate.getFullYear(), 0, 1);
    const endDate = endExplicit ?? new Date(referenceDate.getFullYear(), 11, 31, 23, 59, 59, 999);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate, year: startDate.getFullYear(), month: null };
  }

  const { year, month } = parseYearMonth(filters.year, filters.month, referenceDate);
  if (month != null) {
    return {
      startDate: new Date(year, month - 1, 1, 0, 0, 0, 0),
      endDate: new Date(year, month, 0, 23, 59, 59, 999),
      year,
      month,
    };
  }
  return {
    startDate: new Date(year, 0, 1, 0, 0, 0, 0),
    endDate: new Date(year, 11, 31, 23, 59, 59, 999),
    year,
    month: null,
  };
}

function parseDateBasis(raw: unknown): SoldProductsDateBasis {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "expectedDeliveryDate" || v === "invoiceDate") return v;
  return "issueDate";
}

function parseOrderStatus(raw: unknown): SoldProductsOrderStatusFilter {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "all" || v === "cancelled") return v;
  return "valid";
}

function parseCustomerScope(raw: unknown): SoldProductsCustomerScope {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "group" || v === "all") return v;
  return "external";
}

function parseCompany(raw: unknown): SoldProductsCompanyFilter {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "koppetel" || v === "lazarios" || v === "sm") return v;
  return "all";
}

function parseSortBy(raw: unknown): SoldProductsSortBy {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "amount" || v === "orders" || v === "customers") return v;
  return "quantity";
}

function parseTopN(raw: unknown): { topN: number | null; topNKey: SoldProductsTopN } {
  const v = typeof raw === "string" ? raw.trim() : "50";
  if (v === "all") return { topN: null, topNKey: "all" };
  const n = Number.parseInt(v, 10);
  if (n === 10 || n === 20 || n === 50 || n === 100) {
    return { topN: n, topNKey: String(n) as SoldProductsTopN };
  }
  return { topN: 50, topNKey: "50" };
}

export function parseSellerKey(raw: string): {
  sellerExternalId?: number;
  sellerResponsible?: string;
} {
  const v = raw.trim();
  if (!v) return {};
  if (v.startsWith("id:")) {
    const id = Number.parseInt(v.slice(3), 10);
    if (Number.isInteger(id)) return { sellerExternalId: id };
    return {};
  }
  if (v.startsWith("r:")) {
    const name = v.slice(2).trim();
    if (name) return { sellerResponsible: name };
  }
  return { sellerResponsible: v };
}

export function formatSellerKey(externalSellerId: number | null, responsible: string | null): string {
  if (externalSellerId != null) return `id:${externalSellerId}`;
  if (responsible?.trim()) return `r:${responsible.trim()}`;
  return "";
}

export function normalizeSoldProductsUiFilters(
  filters: Partial<SoldProductsUiFilters>
): SoldProductsUiFilters {
  return { ...EMPTY_SOLD_PRODUCTS_UI_FILTERS, ...filters };
}

export function parseSalesProductRankingFilters(
  query: Record<string, unknown>,
  referenceDate = new Date()
): SoldProductsDashboardFilters {
  const ui = normalizeSoldProductsUiFilters({
    startDate: typeof query.startDate === "string" ? query.startDate : "",
    endDate: typeof query.endDate === "string" ? query.endDate : "",
    year: typeof query.year === "string" ? query.year : String(referenceDate.getFullYear()),
    month: typeof query.month === "string" ? query.month : "",
    dateBasis: parseDateBasis(query.dateBasis),
    customerName: typeof query.customerName === "string" ? query.customerName.trim() : "",
    customerTaxId: typeof query.customerTaxId === "string" ? query.customerTaxId.trim() : "",
    customerId: typeof query.customerId === "string" ? query.customerId.trim() : "",
    productCode: typeof query.productCode === "string" ? query.productCode.trim() : "",
    productName: typeof query.productName === "string" ? query.productName.trim() : "",
    sellerKey: typeof query.sellerKey === "string" ? query.sellerKey.trim() : "",
    company: parseCompany(query.company),
    orderStatus: parseOrderStatus(query.orderStatus),
    customerScope: parseCustomerScope(query.customerScope),
    sortBy: parseSortBy(query.sortBy),
    topN: typeof query.topN === "string" ? (query.topN as SoldProductsTopN) : "50",
  });

  const { startDate, endDate } = resolveSoldProductsDateRange(ui, referenceDate);
  const { topN } = parseTopN(ui.topN);
  const seller = parseSellerKey(ui.sellerKey);

  const detailPage = Math.max(1, Number.parseInt(String(query.detailPage ?? "1"), 10) || 1);
  const detailLimit = Math.min(
    500,
    Math.max(10, Number.parseInt(String(query.detailLimit ?? "100"), 10) || 100)
  );

  return {
    startDate,
    endDate,
    dateBasis: ui.dateBasis,
    customerName: ui.customerName || undefined,
    customerTaxId: ui.customerTaxId || undefined,
    customerId: ui.customerId || undefined,
    productCode: ui.productCode || undefined,
    productName: ui.productName || undefined,
    sellerExternalId: seller.sellerExternalId,
    sellerResponsible: seller.sellerResponsible,
    company: ui.company,
    orderStatus: ui.orderStatus,
    customerScope: ui.customerScope,
    sortBy: ui.sortBy,
    topN,
    detailPage,
    detailLimit,
  };
}

export function buildSoldProductsDashboardQuery(filters: SoldProductsUiFilters): string {
  const q = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value.trim()) q.set(key, value.trim());
  };
  set("startDate", filters.startDate);
  set("endDate", filters.endDate);
  set("year", filters.year);
  set("month", filters.month);
  if (filters.dateBasis !== "issueDate") q.set("dateBasis", filters.dateBasis);
  set("customerName", filters.customerName);
  set("customerTaxId", filters.customerTaxId);
  set("customerId", filters.customerId);
  set("productCode", filters.productCode);
  set("productName", filters.productName);
  set("sellerKey", filters.sellerKey);
  if (filters.company !== "all") q.set("company", filters.company);
  if (filters.orderStatus !== "valid") q.set("orderStatus", filters.orderStatus);
  if (filters.customerScope !== "external") q.set("customerScope", filters.customerScope);
  if (filters.sortBy !== "quantity") q.set("sortBy", filters.sortBy);
  if (filters.topN !== "50") q.set("topN", filters.topN);
  return q.toString();
}

export function isGroupEconomyCustomer(input: {
  taxId?: string | null;
  companyName?: string | null;
  tradeName?: string | null;
}): boolean {
  const digits = normalizeCnpjDigits(input.taxId);
  if (digits && (GROUP_CNPJ_SET as Set<string>).has(digits)) return true;
  return isGroupCompanyCustomer(input);
}

export function matchesSoldProductsCustomerScope(
  customer: { taxId?: string | null; companyName?: string | null; tradeName?: string | null },
  scope: SoldProductsCustomerScope
): boolean {
  const isGroup = isGroupEconomyCustomer(customer);
  if (scope === "group") return isGroup;
  if (scope === "external") return !isGroup;
  return true;
}

export function matchesSoldProductsIssuerCompany(
  order: {
    companyIssuer?: string | null;
    externalCompanyId?: number | null;
    nomusRawResponse?: unknown;
  },
  company: SoldProductsCompanyFilter
): boolean {
  if (company === "all") return true;
  const raw = order.nomusRawResponse as Record<string, unknown> | null | undefined;
  const nomeEmpresa = String(raw?.nomeEmpresa ?? "").toLowerCase();
  const patterns: Record<Exclude<SoldProductsCompanyFilter, "all">, string[]> = {
    koppetel: ["koppetel"],
    lazarios: ["lazarios"],
    sm: ["sm comercio", "sm comércio", " sm "],
  };
  if (patterns[company].some((p) => nomeEmpresa.includes(p))) return true;
  if (company === "koppetel" && nomeEmpresa.includes("koppetel")) return true;
  if (company === "lazarios" && nomeEmpresa.includes("lazarios")) return true;
  if (company === "sm" && nomeEmpresa.includes("sm") && nomeEmpresa.includes("plastic")) return true;
  return false;
}

export function orderMatchesSoldProductsStatus(
  status: string,
  filter: SoldProductsOrderStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "cancelled") return isCancelledSalesOrderStatus(status);
  return !isCancelledSalesOrderStatus(status) && status !== "ERROR";
}

function optionLabel<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function buildSoldProductsAppliedFiltersLabel(
  ui: SoldProductsUiFilters,
  referenceDate = new Date()
): SoldProductsDashboardFiltersApplied {
  const { startDate, endDate, year, month } = resolveSoldProductsDateRange(ui, referenceDate);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const seller = parseSellerKey(ui.sellerKey);
  let sellerLabel: string | undefined;
  if (seller.sellerExternalId != null) sellerLabel = `ID ${seller.sellerExternalId}`;
  else if (seller.sellerResponsible) sellerLabel = seller.sellerResponsible;

  let periodLabel = `${fmt(startDate)} até ${fmt(endDate)}`;
  if (!ui.startDate.trim() && !ui.endDate.trim() && month != null) {
    periodLabel = `${String(month).padStart(2, "0")}/${year}`;
  } else if (!ui.startDate.trim() && !ui.endDate.trim()) {
    periodLabel = `Ano ${year}`;
  }

  return {
    periodLabel,
    dateBasis: ui.dateBasis,
    dateBasisLabel: optionLabel(SOLD_PRODUCTS_DATE_BASIS_OPTIONS, ui.dateBasis),
    customerName: ui.customerName || undefined,
    customerTaxId: ui.customerTaxId || undefined,
    customerId: ui.customerId || undefined,
    productCode: ui.productCode || undefined,
    productName: ui.productName || undefined,
    sellerLabel,
    company: ui.company,
    companyLabel: optionLabel(SOLD_PRODUCTS_COMPANY_OPTIONS, ui.company),
    orderStatus: ui.orderStatus,
    orderStatusLabel: optionLabel(SOLD_PRODUCTS_ORDER_STATUS_OPTIONS, ui.orderStatus),
    customerScope: ui.customerScope,
    customerScopeLabel: optionLabel(SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS, ui.customerScope),
    sortBy: ui.sortBy,
    sortByLabel: optionLabel(SOLD_PRODUCTS_SORT_OPTIONS, ui.sortBy),
    topN: ui.topN,
    topNLabel: optionLabel(SOLD_PRODUCTS_TOP_N_OPTIONS, ui.topN),
    startDate: fmt(startDate),
    endDate: fmt(endDate),
    year,
    month: month ?? undefined,
  };
}

export function soldProductsFilterSummaryLines(
  applied: SoldProductsDashboardFiltersApplied
): string[] {
  const lines = [
    `Período: ${applied.periodLabel}`,
    `Tipo de data: ${applied.dateBasisLabel}`,
    `Status do pedido: ${applied.orderStatusLabel}`,
    `Tipo de cliente: ${applied.customerScopeLabel}`,
    `Empresa: ${applied.companyLabel}`,
    `Ordenação: ${applied.sortByLabel}`,
    `Top N: ${applied.topNLabel}`,
  ];
  if (applied.customerName) lines.push(`Cliente: ${applied.customerName}`);
  if (applied.customerTaxId) lines.push(`CNPJ/CPF: ${applied.customerTaxId}`);
  if (applied.customerId) lines.push(`ID cliente: ${applied.customerId}`);
  if (applied.productCode) lines.push(`Código produto: ${applied.productCode}`);
  if (applied.productName) lines.push(`Produto: ${applied.productName}`);
  if (applied.sellerLabel) lines.push(`Vendedor: ${applied.sellerLabel}`);
  return lines;
}

export function buildSoldProductsYearOptions(referenceYear = new Date().getFullYear()) {
  const options: Array<{ value: string; label: string }> = [];
  for (let y = referenceYear + 1; y >= referenceYear - 5; y -= 1) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

export const SOLD_PRODUCTS_MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

export function salesOrderStatusLabelPt(status: string): string {
  return salesOrderStatusLabel(status);
}
