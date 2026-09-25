/**
 * Filtros da tela Resultado de Pedidos de Venda — padrão rascunho × aplicado do
 * sistema (o mesmo da listagem): os controles só mudam o rascunho; as consultas
 * usam os filtros APLICADOS, que só mudam em "Pesquisar" ou "Limpar filtros".
 * Parte pura (frontend-safe).
 */
import type { SalesOrderResultFilters } from "./salesOrderResultTypes.js";

export type SalesOrderResultAppliedFilters = {
  year: string;
  month: string;
  status: string;
  hasInvoice: string;
  /** CSV de status CR (`open,settled`) ou vazio = todos. */
  receivableStatus: string;
  customerId: string;
  sellerKey: string;
  productId: string;
};

export function buildInitialSalesOrderResultAppliedFilters(
  currentYear: number
): SalesOrderResultAppliedFilters {
  return {
    year: String(currentYear),
    month: "",
    status: "",
    hasInvoice: "",
    receivableStatus: "",
    customerId: "",
    sellerKey: "",
    productId: "",
  };
}

export type SalesOrderResultQueryStringOptions = {
  /** false = omite o Mês (série de 12 meses do SLA). */
  includeMonth?: boolean;
  /** false = omite o Vendedor (opções do próprio select de vendedor). */
  includeSeller?: boolean;
  /** false = omite o Produto (endpoints da listagem não conhecem o filtro). */
  includeProduct?: boolean;
  /** Data de referência (YYYY-MM-DD): cards do SLA cortam o período em andamento nela. */
  asOfDate?: string;
};

/** Query com os nomes canônicos de `parseSalesOrderListQuery` (+ productId do Resultado). */
export function buildSalesOrderResultQueryString(
  filters: SalesOrderResultAppliedFilters,
  options: SalesOrderResultQueryStringOptions = {}
): string {
  const params = new URLSearchParams();
  if (filters.year) params.set("year", filters.year);
  if (options.includeMonth !== false && filters.month) params.set("month", filters.month);
  if (filters.status) params.set("status", filters.status);
  if (filters.hasInvoice) params.set("hasInvoice", filters.hasInvoice);
  if (filters.receivableStatus) params.set("receivableStatus", filters.receivableStatus);
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (options.includeSeller !== false && filters.sellerKey) params.set("sellerKey", filters.sellerKey);
  if (options.includeProduct !== false && filters.productId) params.set("productId", filters.productId);
  if (options.asOfDate) params.set("asOfDate", options.asOfDate);
  return params.toString();
}

/**
 * Data de referência da tela: dia civil LOCAL (YYYY-MM-DD). `toISOString()` daria
 * o dia UTC — em Brasília, depois das 21h, já seria o dia seguinte.
 */
export function formatSalesOrderResultAsOfDate(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Filtros aplicados no formato de `getSalesOrderResultApiPath` (motor do Resultado). */
export function toSalesOrderResultApiFilters(
  filters: SalesOrderResultAppliedFilters,
  asOfDate: string
): Partial<SalesOrderResultFilters> {
  const year = Number.parseInt(filters.year, 10);
  const month = Number.parseInt(filters.month, 10);
  return {
    year: Number.isInteger(year) ? year : undefined,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined,
    status: filters.status || undefined,
    hasInvoice: filters.hasInvoice || undefined,
    receivableStatus: filters.receivableStatus || undefined,
    customerId: filters.customerId || undefined,
    sellerKey: filters.sellerKey || undefined,
    productId: filters.productId || undefined,
    asOfDate,
  };
}

/** Rascunho diferente do aplicado → a tela avisa que falta clicar em Pesquisar. */
export function hasPendingSalesOrderResultFilters(
  draft: SalesOrderResultAppliedFilters,
  applied: SalesOrderResultAppliedFilters
): boolean {
  return (Object.keys(applied) as Array<keyof SalesOrderResultAppliedFilters>).some(
    (key) => (draft[key] ?? "") !== (applied[key] ?? "")
  );
}
