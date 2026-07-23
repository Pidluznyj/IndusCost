/**
 * DS-04.1 — Parser de query para lista/resumo de Documentos de Saída.
 */

import { safeTrim } from "@/src/lib/safeTrim.js";
import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type {
  OutputDocumentsListFilters,
  OutputDocumentsSortBy,
  OutputDocumentsSortDir,
  OutputDocumentsTriState,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
  resolveSalesOrderIssueDateRange,
} from "@/src/lib/salesOrderPeriodFilter.js";

const SORT_BY_VALUES: ReadonlySet<string> = new Set([
  "dataDocumento",
  "externalId",
  "totalValue",
  "documentNumber",
  "personName",
  "companyName",
  "syncedAt",
  "statusRaw",
]);

const FINANCIAL_STATUS_VALUES: ReadonlySet<string> = new Set([
  "aguardando_cr",
  "cr_em_aberto",
  "parcialmente_recebido",
  "recebido",
  "vencido",
  "sem_informacao_financeira",
  "cancelado",
]);

export class OutputDocumentsListQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputDocumentsListQueryError";
  }
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: unknown, fallback = 1): number {
  const n = Number.parseInt(String(firstValue(value) ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parsePageSize(value: unknown, fallback = 50, max = 200): number {
  const n = Number.parseInt(String(firstValue(value) ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

function optTrim(value: unknown): string | null {
  const t = safeTrim(firstValue(value));
  return t.length ? t : null;
}

function parseOptionalInt(value: unknown): number | null {
  const raw = optTrim(value);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseDateBound(value: unknown, endOfDay: boolean): Date | null {
  const raw = optTrim(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((p) => Number.parseInt(p, 10));
    if (!y || !m || !d) return null;
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59, 999)
      : new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTriState(value: unknown): OutputDocumentsTriState {
  const raw = safeTrim(firstValue(value)).toLowerCase();
  if (!raw || raw === "all" || raw === "qualquer" || raw === "any") return "all";
  if (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "sim" ||
    raw === "com" ||
    raw === "with"
  ) {
    return "yes";
  }
  if (
    raw === "0" ||
    raw === "false" ||
    raw === "no" ||
    raw === "nao" ||
    raw === "não" ||
    raw === "sem" ||
    raw === "without"
  ) {
    return "no";
  }
  throw new OutputDocumentsListQueryError(
    `Filtro booleano inválido: "${raw}". Use yes/no/all.`
  );
}

function parseSortBy(value: unknown): OutputDocumentsSortBy {
  const raw = optTrim(value) ?? "dataDocumento";
  if (!SORT_BY_VALUES.has(raw)) {
    throw new OutputDocumentsListQueryError(
      `Ordenação inválida: "${raw}".`
    );
  }
  return raw as OutputDocumentsSortBy;
}

function parseSortDir(value: unknown): OutputDocumentsSortDir {
  const raw = (optTrim(value) ?? "desc").toLowerCase();
  if (raw !== "asc" && raw !== "desc") {
    throw new OutputDocumentsListQueryError(
      `Direção de ordenação inválida: "${raw}".`
    );
  }
  return raw;
}

function parseFinancialStatus(value: unknown): OutputDocumentFinancialStatus | null {
  const raw = optTrim(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (!FINANCIAL_STATUS_VALUES.has(normalized)) {
    throw new OutputDocumentsListQueryError(
      `Situação financeira inválida: "${raw}".`
    );
  }
  return normalized as OutputDocumentFinancialStatus;
}

/**
 * Combina Ano/Mês (fim exclusivo) com from/to (fim inclusivo) sobre dataDocumento —
 * mesma convenção de Pedidos de Venda (`resolveSalesOrderIssueDateRange`).
 */
export function resolveOutputDocumentsEmissionDateBounds(input: {
  from: Date | null;
  to: Date | null;
  year: number | null;
  month: number | null;
}): { gte?: Date; lte?: Date; lt?: Date } | null {
  const periodRange = resolveSalesOrderIssueDateRange(input.year, input.month);
  const bounds: { gte?: Date; lte?: Date; lt?: Date } = {};
  if (input.from) bounds.gte = input.from;
  if (input.to) bounds.lte = input.to;
  if (periodRange) {
    const currentGte = bounds.gte ?? null;
    if (!currentGte || periodRange.gte > currentGte) {
      bounds.gte = periodRange.gte;
    }
    bounds.lt = periodRange.lt;
  }
  if (!bounds.gte && !bounds.lte && !bounds.lt) return null;
  return bounds;
}

/**
 * Interpreta query de lista/resumo. Mesmos filtros para ambos os endpoints.
 */
export function parseOutputDocumentsListQuery(
  query: Record<string, unknown> = {}
): OutputDocumentsListFilters {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const from = parseDateBound(query.from ?? query.startDate, false);
  const to = parseDateBound(query.to ?? query.endDate, true);
  const year = parseSalesOrderYearParam(query.year);
  const month = parseSalesOrderMonthParam(query.month);

  if (from && to && from.getTime() > to.getTime()) {
    throw new OutputDocumentsListQueryError(
      "Data inicial não pode ser posterior à data final."
    );
  }

  const cancelledRaw = firstValue(query.cancelled ?? query.isCancelled);
  const hasReceivableRaw = firstValue(
    query.hasReceivable ?? query.comCr ?? query.withReceivable
  );

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sortBy: parseSortBy(query.sortBy ?? query.orderBy),
    sortDir: parseSortDir(query.sortDir ?? query.orderDir),
    search: safeTrim(firstValue(query.search ?? query.q)),
    from,
    to,
    year,
    month,
    company: optTrim(query.company ?? query.companyName),
    companyExternalId: parseOptionalInt(query.companyExternalId),
    customer: optTrim(query.customer ?? query.customerName ?? query.personName),
    personExternalId: parseOptionalInt(
      query.personExternalId ?? query.customerExternalId
    ),
    status: optTrim(query.status ?? query.statusRaw),
    cancelled: cancelledRaw == null || cancelledRaw === ""
      ? "all"
      : parseTriState(cancelledRaw),
    order: optTrim(query.order ?? query.orderCode ?? query.pedido),
    nfe: optTrim(query.nfe ?? query.nfeNumber ?? query.nf),
    idNfe: parseOptionalInt(query.idNfe),
    hasReceivable:
      hasReceivableRaw == null || hasReceivableRaw === ""
        ? "all"
        : parseTriState(hasReceivableRaw),
    financialStatus: parseFinancialStatus(
      query.financialStatus ?? query.situacaoFinanceira
    ),
  };
}

export function serializeOutputDocumentsListFilters(
  filters: OutputDocumentsListFilters
): Omit<OutputDocumentsListFilters, "skip" | "from" | "to"> & {
  from: string | null;
  to: string | null;
} {
  return {
    page: filters.page,
    pageSize: filters.pageSize,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    search: filters.search,
    from: filters.from ? filters.from.toISOString() : null,
    to: filters.to ? filters.to.toISOString() : null,
    year: filters.year,
    month: filters.month,
    company: filters.company,
    companyExternalId: filters.companyExternalId,
    customer: filters.customer,
    personExternalId: filters.personExternalId,
    status: filters.status,
    cancelled: filters.cancelled,
    order: filters.order,
    nfe: filters.nfe,
    idNfe: filters.idNfe,
    hasReceivable: filters.hasReceivable,
    financialStatus: filters.financialStatus,
  };
}
