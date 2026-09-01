/**
 * Financeiro > Faturamento > Detalhamento — contrato puro (client-safe).
 *
 * Responde a pergunta operacional "quais PEDIDOS DE VENDA foram faturados
 * neste período?". Não é um motor novo de faturamento: apenas projeta, por
 * pedido, a evidência canônica que já existe no domínio.
 *
 * Evidência canônica de "pedido faturado" (mesma de
 * `salesOrderListBillingStatus` / `salesOrderLinkedNfe`):
 *   SalesOrder → SalesOrderNfeLink (presentInLastPayload) → NomusNfe
 *   com NF não cancelada (status 7) e data de competência preenchida.
 *
 * Data canônica de Ano/Mês: a MESMA competência da tela de Faturamento
 * (`nfeCompetenceDateSql`, base "emissao"): COALESCE(xmlDhEmi,
 * dataProcessamento), com fallback para `SalesOrderNfeLink.dataProcessamento`
 * quando a NF-e não existe no stage local (mesmo fallback de
 * `resolveLinkedNfeProcessingDate`).
 *
 * Sem Prisma, sem Node — compartilhado entre frontend e backend.
 */

import { safeTrim } from "@/src/lib/safeTrim.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
  resolveSalesOrderIssueDateRange,
} from "@/src/lib/salesOrderPeriodFilter.js";

export const FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT =
  "/api/finance/billing/detail/orders";

export const FINANCE_BILLING_DETAIL_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export const FINANCE_BILLING_DETAIL_DEFAULT_PAGE_SIZE = 50;
export const FINANCE_BILLING_DETAIL_MAX_PAGE_SIZE = 200;

/**
 * Escopo declarado ao usuário. A competência é a mesma do painel executivo
 * desta tela (data fiscal / emissão da NF-e).
 */
export const FINANCE_BILLING_DETAIL_SCOPE_NOTE =
  "Pedidos com NF-e vinculada e não cancelada na competência selecionada " +
  "(data fiscal/emissão da NF-e — mesma base do painel de Faturamento).";

export type FinanceBillingDetailSortBy =
  | "invoiceDate"
  | "orderCode"
  | "customerName";

export type FinanceBillingDetailSortDir = "asc" | "desc";

const SORT_BY_VALUES: ReadonlySet<string> = new Set([
  "invoiceDate",
  "orderCode",
  "customerName",
]);

export const FINANCE_BILLING_DETAIL_SORT_OPTIONS: ReadonlyArray<{
  value: FinanceBillingDetailSortBy;
  label: string;
}> = [
  { value: "invoiceDate", label: "Data do faturamento" },
  { value: "orderCode", label: "Pedido de venda" },
  { value: "customerName", label: "Cliente" },
];

export class FinanceBillingDetailQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceBillingDetailQueryError";
  }
}

/** Filtros da subaba (draft × applied no frontend, query string na API). */
export type FinanceBillingDetailUiFilters = {
  year: string;
  month: string;
  /** UUID IndusCost do Customer (autocomplete). */
  customerId: string;
  /** Nome exibido do cliente (rótulo do autocomplete / busca livre). */
  customerName: string;
  /** CNPJ/CPF do cliente selecionado. */
  customerDocument: string;
  /** Pedido de venda: `orderCode`, código externo ou id externo numérico. */
  salesOrder: string;
  /** Documento de Saída: número comercial ou id externo Nomus. */
  outputDocument: string;
  /** NF: número da nota (não é chave de acesso nem idNfe). */
  invoice: string;
};

export function createDefaultFinanceBillingDetailFilters(
  referenceDate = new Date()
): FinanceBillingDetailUiFilters {
  return {
    year: String(referenceDate.getFullYear()),
    month: String(referenceDate.getMonth() + 1),
    customerId: "",
    customerName: "",
    customerDocument: "",
    salesOrder: "",
    outputDocument: "",
    invoice: "",
  };
}

export function normalizeFinanceBillingDetailFilters(
  filters: FinanceBillingDetailUiFilters
): FinanceBillingDetailUiFilters {
  return {
    year: safeTrim(filters.year),
    month: safeTrim(filters.month),
    customerId: safeTrim(filters.customerId),
    customerName: safeTrim(filters.customerName),
    customerDocument: safeTrim(filters.customerDocument),
    salesOrder: safeTrim(filters.salesOrder),
    outputDocument: safeTrim(filters.outputDocument),
    invoice: safeTrim(filters.invoice),
  };
}

export function hasPendingFinanceBillingDetailFilterChanges(
  draft: FinanceBillingDetailUiFilters,
  applied: FinanceBillingDetailUiFilters
): boolean {
  const a = normalizeFinanceBillingDetailFilters(draft);
  const b = normalizeFinanceBillingDetailFilters(applied);
  return (
    a.year !== b.year ||
    a.month !== b.month ||
    a.customerId !== b.customerId ||
    a.customerName !== b.customerName ||
    a.customerDocument !== b.customerDocument ||
    a.salesOrder !== b.salesOrder ||
    a.outputDocument !== b.outputDocument ||
    a.invoice !== b.invoice
  );
}

export function buildFinanceBillingDetailOrdersQuery(
  filters: FinanceBillingDetailUiFilters,
  options: {
    page?: number;
    pageSize?: number;
    sortBy?: FinanceBillingDetailSortBy;
    sortDir?: FinanceBillingDetailSortDir;
  } = {}
): string {
  const f = normalizeFinanceBillingDetailFilters(filters);
  const params = new URLSearchParams();
  if (f.year) params.set("year", f.year);
  if (f.month) params.set("month", f.month);
  if (f.customerId) params.set("customerId", f.customerId);
  if (f.customerName) params.set("customerName", f.customerName);
  if (f.customerDocument) params.set("customerDocument", f.customerDocument);
  if (f.salesOrder) params.set("salesOrder", f.salesOrder);
  if (f.outputDocument) params.set("outputDocument", f.outputDocument);
  if (f.invoice) params.set("invoice", f.invoice);
  if (options.page != null && options.page > 0) {
    params.set("page", String(options.page));
  }
  if (options.pageSize != null && options.pageSize > 0) {
    params.set("pageSize", String(options.pageSize));
  }
  if (options.sortBy) params.set("sortBy", options.sortBy);
  if (options.sortDir) params.set("sortDir", options.sortDir);
  return params.toString();
}

// ---------------------------------------------------------------------------
// Filtros resolvidos (servidor)
// ---------------------------------------------------------------------------

export type FinanceBillingDetailFilters = {
  page: number;
  pageSize: number;
  sortBy: FinanceBillingDetailSortBy;
  sortDir: FinanceBillingDetailSortDir;
  year: number | null;
  month: number | null;
  customerId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  salesOrder: string | null;
  outputDocument: string | null;
  invoice: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function optTrim(value: unknown): string | null {
  const trimmed = safeTrim(firstValue(value));
  return trimmed.length ? trimmed : null;
}

function parsePage(value: unknown): number {
  const n = Number.parseInt(String(firstValue(value) ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePageSize(value: unknown): number {
  const n = Number.parseInt(String(firstValue(value) ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return FINANCE_BILLING_DETAIL_DEFAULT_PAGE_SIZE;
  }
  return Math.min(FINANCE_BILLING_DETAIL_MAX_PAGE_SIZE, n);
}

function parseSortBy(value: unknown): FinanceBillingDetailSortBy {
  const raw = optTrim(value) ?? "invoiceDate";
  if (!SORT_BY_VALUES.has(raw)) {
    throw new FinanceBillingDetailQueryError(`Ordenação inválida: "${raw}".`);
  }
  return raw as FinanceBillingDetailSortBy;
}

function parseSortDir(value: unknown): FinanceBillingDetailSortDir {
  const raw = (optTrim(value) ?? "desc").toLowerCase();
  if (raw !== "asc" && raw !== "desc") {
    throw new FinanceBillingDetailQueryError(
      `Direção de ordenação inválida: "${raw}".`
    );
  }
  return raw;
}

/**
 * Ano é obrigatório na prática: sem ele a competência não delimita período e a
 * consulta varreria todo o histórico. O frontend sempre envia (default = ano
 * corrente); a API cai no ano corrente quando ausente/ inválido.
 */
export function parseFinanceBillingDetailOrdersQuery(
  query: Record<string, unknown> = {},
  referenceDate = new Date()
): FinanceBillingDetailFilters {
  const year = parseSalesOrderYearParam(query.year) ?? referenceDate.getFullYear();
  const month = parseSalesOrderMonthParam(query.month);

  return {
    page: parsePage(query.page),
    pageSize: parsePageSize(query.pageSize),
    sortBy: parseSortBy(query.sortBy),
    sortDir: parseSortDir(query.sortDir),
    year,
    month,
    customerId: (() => {
      const raw = optTrim(query.customerId);
      return raw && UUID_RE.test(raw) ? raw : null;
    })(),
    customerName: optTrim(query.customerName ?? query.customer),
    customerDocument: optTrim(query.customerDocument ?? query.customerCnpj),
    salesOrder: optTrim(query.salesOrder ?? query.order ?? query.orderCode),
    outputDocument: optTrim(query.outputDocument ?? query.document),
    invoice: optTrim(query.invoice ?? query.nfe ?? query.nf),
  };
}

/** Intervalo de competência [gte, lt) — mesma convenção Ano/Mês do domínio. */
export function resolveFinanceBillingDetailPeriod(
  filters: Pick<FinanceBillingDetailFilters, "year" | "month">
): { gte: Date; lt: Date } | null {
  return resolveSalesOrderIssueDateRange(filters.year, filters.month);
}

// ---------------------------------------------------------------------------
// Data canônica de competência do faturamento (por vínculo NF)
// ---------------------------------------------------------------------------

export type FinanceBillingDetailCompetenceInput = {
  /** `NomusNfe.xmlDhEmi` — data fiscal de emissão. */
  nfeIssueDate?: Date | null;
  /** `NomusNfe.dataProcessamento`. */
  nfeProcessingDate?: Date | null;
  /** `SalesOrderNfeLink.dataProcessamento` (stage local sem NF-e). */
  linkProcessingDate?: Date | null;
};

/**
 * Base "emissao" de `nfeCompetenceDateSql` + fallback do vínculo.
 * Não inventa data: se nada existir, o vínculo não compõe faturamento.
 */
export function resolveFinanceBillingDetailCompetenceDate(
  input: FinanceBillingDetailCompetenceInput
): Date | null {
  return (
    input.nfeIssueDate ?? input.nfeProcessingDate ?? input.linkProcessingDate ?? null
  );
}

export function isWithinFinanceBillingDetailPeriod(
  date: Date | null,
  period: { gte: Date; lt: Date } | null
): boolean {
  if (!date) return false;
  if (!period) return true;
  const time = date.getTime();
  return time >= period.gte.getTime() && time < period.lt.getTime();
}

// ---------------------------------------------------------------------------
// Normalização de termos de busca
// ---------------------------------------------------------------------------

/**
 * Variantes do identificador de pedido apresentado ao usuário
 * ("2716", "PD 02716", "PD02716"). Espelha o comportamento já usado pelo
 * filtro de pedido de Documentos de Saída.
 */
export function buildFinanceBillingDetailOrderTerms(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const terms = new Set<string>([trimmed]);
  const digits = trimmed.replace(/\D/g, "");
  if (digits) {
    const asInt = Number.parseInt(digits, 10);
    if (Number.isFinite(asInt)) {
      terms.add(String(asInt));
      terms.add(`PD${asInt}`);
      terms.add(`PD ${String(asInt).padStart(5, "0")}`);
      terms.add(`PD${String(asInt).padStart(5, "0")}`);
      terms.add(String(asInt).padStart(5, "0"));
    }
  }
  return [...terms];
}

/** Número inteiro positivo puro (id externo Nomus), ou null. */
export function parseFinanceBillingDetailExternalId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Só dígitos — comparação de CNPJ/CPF sem máscara. */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// DTO de resposta
// ---------------------------------------------------------------------------

/** NF-e do período vinculada ao pedido (sem valores financeiros). */
export type FinanceBillingDetailInvoiceRef = {
  nfeExternalId: number;
  number: string | null;
  serie: string | null;
  /** Competência canônica (ISO) desta NF dentro do período. */
  competenceDate: string | null;
};

/** Documento de Saída ligado à NF-e do período. */
export type FinanceBillingDetailOutputDocumentRef = {
  externalId: number;
  /** Identificador apresentado ao usuário (`documentNumber` ou externalId). */
  number: string;
  documentDate: string | null;
  isCancelled: boolean;
};

export type FinanceBillingDetailOrderItem = {
  /** Chave canônica do SalesOrder — é o id aceito por SalesOrderDetailDialog. */
  salesOrderId: string;
  orderCode: string;
  externalSalesOrderCode: string | null;
  externalSalesOrderId: number | null;
  customerId: string | null;
  customerName: string;
  customerDocument: string | null;
  companyName: string | null;
  /** Menor competência das NF-e do pedido dentro do período (ISO). */
  firstInvoiceDate: string | null;
  /** Maior competência das NF-e do pedido dentro do período (ISO). */
  lastInvoiceDate: string | null;
  invoices: FinanceBillingDetailInvoiceRef[];
  outputDocuments: FinanceBillingDetailOutputDocumentRef[];
};

export type FinanceBillingDetailOrdersPayload = {
  generatedAt: string;
  /** Competência aplicada, para exibição/auditoria. */
  period: { year: number | null; month: number | null; label: string };
  scopeNote: string;
  filters: FinanceBillingDetailFilters;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  items: FinanceBillingDetailOrderItem[];
};

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function financeBillingDetailPeriodLabel(
  year: number | null,
  month: number | null
): string {
  if (year == null) return "Todos os períodos";
  if (month == null) return `Ano ${year}`;
  return `${MONTH_LABELS[month - 1] ?? month}/${year}`;
}

// ---------------------------------------------------------------------------
// Ordenação (pura — usada pelo loader e testável isoladamente)
// ---------------------------------------------------------------------------

function compareNullableDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

export function compareFinanceBillingDetailOrders(
  a: FinanceBillingDetailOrderItem,
  b: FinanceBillingDetailOrderItem,
  sortBy: FinanceBillingDetailSortBy,
  sortDir: FinanceBillingDetailSortDir
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let base = 0;
  if (sortBy === "orderCode") {
    base = a.orderCode.localeCompare(b.orderCode, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  } else if (sortBy === "customerName") {
    base = a.customerName.localeCompare(b.customerName, "pt-BR", {
      sensitivity: "base",
    });
  } else {
    base = compareNullableDateAsc(a.lastInvoiceDate, b.lastInvoiceDate);
  }
  if (base !== 0) return base * dir;
  // Desempate estável: pedido nunca "pula" de página entre requisições.
  return a.orderCode.localeCompare(b.orderCode, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}
