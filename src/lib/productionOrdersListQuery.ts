/**
 * Parser de query string — listagem paginada de Ordens de Produção (OP-16).
 * Puro — sem Prisma / Express.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";

export const PRODUCTION_ORDERS_LIST_DEFAULT_PAGE_SIZE = 50;
export const PRODUCTION_ORDERS_LIST_MAX_PAGE_SIZE = 200;

/** Eixo oficial do filtro de período (documentado em docs/production-orders/api-read.md). */
export const PRODUCTION_ORDERS_LIST_PERIOD_FIELD = "openedAt" as const;

export class ProductionOrdersListQueryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProductionOrdersListQueryError";
    this.code = code;
  }
}

export type ProductionOrdersListQuery = {
  page: number;
  pageSize: number;
  skip: number;
  search: string;
  status: string | null;
  tipo: string | null;
  company: string | null;
  openedFrom: Date | null;
  openedTo: Date | null;
};

export type ProductionOrdersAppliedFilter = {
  key: string;
  label: string;
  value: string;
};

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: unknown): number {
  const raw = first(value);
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new ProductionOrdersListQueryError(
      "INVALID_PAGE",
      "Parâmetro page deve ser um inteiro ≥ 1."
    );
  }
  return n;
}

function parsePageSize(value: unknown): number {
  const raw = first(value);
  if (raw === undefined || raw === null || raw === "") {
    return PRODUCTION_ORDERS_LIST_DEFAULT_PAGE_SIZE;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new ProductionOrdersListQueryError(
      "INVALID_PAGE_SIZE",
      "Parâmetro pageSize deve ser um inteiro ≥ 1."
    );
  }
  if (n > PRODUCTION_ORDERS_LIST_MAX_PAGE_SIZE) {
    throw new ProductionOrdersListQueryError(
      "INVALID_PAGE_SIZE",
      `Parâmetro pageSize não pode exceder ${PRODUCTION_ORDERS_LIST_MAX_PAGE_SIZE}.`
    );
  }
  return n;
}

function optTrim(value: unknown): string | null {
  const t = safeTrim(value);
  return t.length ? t : null;
}

function parsePeriodDate(value: unknown, param: "from" | "to"): Date | null {
  const raw = optTrim(first(value));
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ProductionOrdersListQueryError(
      param === "from" ? "INVALID_FROM" : "INVALID_TO",
      `Parâmetro ${param} deve ser uma data ISO válida.`
    );
  }
  return d;
}

export function parseProductionOrdersListQuery(
  query: Record<string, unknown> = {}
): ProductionOrdersListQuery {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const openedFrom = parsePeriodDate(query.from, "from");
  const openedTo = parsePeriodDate(query.to, "to");

  if (openedFrom && openedTo && openedFrom.getTime() > openedTo.getTime()) {
    throw new ProductionOrdersListQueryError(
      "INVALID_DATE_RANGE",
      "Parâmetro from não pode ser posterior a to."
    );
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    search: safeTrim(query.search),
    status: optTrim(query.status),
    tipo: optTrim(query.tipo),
    company: optTrim(query.company),
    openedFrom,
    openedTo,
  };
}

export function buildProductionOrdersAppliedFilters(
  query: ProductionOrdersListQuery
): ProductionOrdersAppliedFilter[] {
  const filters: ProductionOrdersAppliedFilter[] = [];

  if (query.search) {
    filters.push({ key: "search", label: "Busca", value: query.search });
  }
  if (query.status) {
    filters.push({ key: "status", label: "Status", value: query.status });
  }
  if (query.tipo) {
    filters.push({ key: "tipo", label: "Tipo", value: query.tipo });
  }
  if (query.company) {
    filters.push({ key: "company", label: "Empresa", value: query.company });
  }
  if (query.openedFrom) {
    filters.push({
      key: "from",
      label: `Abertura (de)`,
      value: query.openedFrom.toISOString(),
    });
  }
  if (query.openedTo) {
    filters.push({
      key: "to",
      label: `Abertura (até)`,
      value: query.openedTo.toISOString(),
    });
  }

  return filters;
}
