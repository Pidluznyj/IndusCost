import type {
  CommissionRecordOriginStage,
  CommissionRecordStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  applyCommissionRecordScope,
  parseOptionalInt,
  parseOptionalUuid,
} from "./commissionAccessScope.js";

export class CommissionQueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommissionQueryParseError";
  }
}

export const COMMISSION_FORECAST_STATUSES: CommissionRecordStatus[] = [
  "FORECAST_FROM_ORDER",
  "WAITING_NFE",
];

export const COMMISSION_CONFIRMED_STATUSES: CommissionRecordStatus[] = [
  "CONFIRMED_BY_OUTPUT_DOCUMENT",
  "WAITING_RECEIVABLE",
  "WAITING_PAYMENT",
  "PARTIALLY_RELEASED",
  "RELEASED",
  "PAID_PARTIAL",
  "PAID_TOTAL",
];

export const COMMISSION_CONFIRMED_CANCELLED_STATUSES: CommissionRecordStatus[] = [
  "CANCELLED",
  "REVERSED",
];

const RECORD_STATUS_SET = new Set<string>([
  "FORECAST_FROM_ORDER",
  "WAITING_NFE",
  "SUPERSEDED_BY_OUTPUT_DOCUMENT",
  "CONFIRMED_BY_OUTPUT_DOCUMENT",
  "WAITING_RECEIVABLE",
  "WAITING_PAYMENT",
  "PARTIALLY_RELEASED",
  "RELEASED",
  "PAID_PARTIAL",
  "PAID_TOTAL",
  "CANCELLED",
  "REVERSED",
  "ERROR",
]);

const PERSON_TYPE_SET = new Set<string>(["SELLER", "REPRESENTATIVE", "MANAGER", "OTHER"]);

const ORIGIN_STAGE_SET = new Set<string>(["SALES_ORDER", "OUTPUT_DOCUMENT"]);

export type CommissionPeriodQuery = {
  year: number | null;
  month: number | null;
  from: Date | null;
  to: Date | null;
};

export type CommissionDashboardQuery = CommissionPeriodQuery & {
  commissionPersonId: string | null;
  type: string | null;
  personType: string | null;
  status: CommissionRecordStatus | null;
  customer: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  ruleId: string | null;
  sellerId: number | null;
  representativeId: number | null;
};

export type CommissionRecordsQuery = CommissionPeriodQuery & {
  status: CommissionRecordStatus | null;
  originStage: CommissionRecordOriginStage | null;
  commissionPersonId: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  customer: string | null;
  sellerId: number | null;
  representativeId: number | null;
  hasRule: boolean | null;
  includeSuperseded: boolean;
  page: number;
  pageSize: number;
  statusIn?: CommissionRecordStatus[];
};

export type CommissionForecastQuery = CommissionRecordsQuery;

export type CommissionConfirmedQuery = CommissionRecordsQuery & {
  outputDocument: string | null;
  includeCancelled: boolean;
};

export type CommissionReleaseFilter = "released" | "not_released" | "partial" | null;

export type CommissionReleasesQuery = CommissionPeriodQuery & {
  commissionPersonId: string | null;
  customer: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  sellerId: number | null;
  representativeId: number | null;
  receivableId: number | null;
  dueFrom: Date | null;
  dueTo: Date | null;
  settlementFrom: Date | null;
  settlementTo: Date | null;
  accountStatus: string | null;
  releaseFilter: CommissionReleaseFilter;
  page: number;
  pageSize: number;
};

export type PaginatedMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function parseIsoDate(raw: unknown, field: string): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new CommissionQueryParseError(`${field} inválido.`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new CommissionQueryParseError(`${field} inválido.`);
  }
  return d;
}

function parsePeriodQuery(query: Record<string, unknown>): CommissionPeriodQuery {
  const year = parseOptionalInt(query.year);
  const month = parseOptionalInt(query.month);
  if (month != null && (month < 1 || month > 12)) {
    throw new CommissionQueryParseError("month deve estar entre 1 e 12.");
  }
  const from = parseIsoDate(query.from, "from");
  const to = parseIsoDate(query.to, "to");
  if (from && to && from > to) {
    throw new CommissionQueryParseError("from não pode ser posterior a to.");
  }
  return { year, month, from, to };
}

function parseStatus(raw: unknown): CommissionRecordStatus | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !RECORD_STATUS_SET.has(raw)) {
    throw new CommissionQueryParseError("status inválido.");
  }
  return raw as CommissionRecordStatus;
}

function parseOriginStage(raw: unknown): CommissionRecordOriginStage | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !ORIGIN_STAGE_SET.has(raw)) {
    throw new CommissionQueryParseError("originStage inválido.");
  }
  return raw as CommissionRecordOriginStage;
}

export function parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
  const pageRaw = parseOptionalInt(query.page);
  const pageSizeRaw = parseOptionalInt(query.pageSize);
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize =
    pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 20;
  return { page, pageSize };
}

export function parseCommissionDashboardQuery(
  query: Record<string, unknown>
): CommissionDashboardQuery {
  const period = parsePeriodQuery(query);
  const status = parseStatus(query.status);
  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }
  const customer =
    typeof query.customer === "string" && query.customer.trim()
      ? query.customer.trim()
      : null;
  const orderCode =
    typeof query.orderCode === "string" && query.orderCode.trim()
      ? query.orderCode.trim()
      : null;
  const nfeNumber =
    typeof query.nfeNumber === "string" && query.nfeNumber.trim()
      ? query.nfeNumber.trim()
      : null;
  const ruleId = parseOptionalUuid(query.ruleId);
  if (query.ruleId && !ruleId) {
    throw new CommissionQueryParseError("ruleId inválido.");
  }
  const personTypeRaw =
    typeof query.personType === "string" && query.personType.trim()
      ? query.personType.trim().toUpperCase()
      : typeof query.type === "string" && query.type.trim()
        ? query.type.trim().toUpperCase()
        : null;
  const personType =
    personTypeRaw && PERSON_TYPE_SET.has(personTypeRaw) ? personTypeRaw : null;
  if (personTypeRaw && !personType) {
    throw new CommissionQueryParseError("personType inválido.");
  }
  const type =
    typeof query.type === "string" && query.type.trim() ? query.type.trim() : null;

  return {
    ...period,
    commissionPersonId,
    type,
    personType,
    status,
    customer,
    orderCode,
    nfeNumber,
    ruleId,
    sellerId: parseOptionalInt(query.sellerId),
    representativeId: parseOptionalInt(query.representativeId),
  };
}

export function parseCommissionRecordsQuery(
  query: Record<string, unknown>
): CommissionRecordsQuery {
  const period = parsePeriodQuery(query);
  const { page, pageSize } = parsePagination(query);
  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }
  const orderCode =
    typeof query.orderCode === "string" && query.orderCode.trim()
      ? query.orderCode.trim()
      : null;
  const nfeNumber =
    typeof query.nfeNumber === "string" && query.nfeNumber.trim()
      ? query.nfeNumber.trim()
      : null;
  const customer =
    typeof query.customer === "string" && query.customer.trim()
      ? query.customer.trim()
      : null;

  return {
    ...period,
    status: parseStatus(query.status),
    originStage: parseOriginStage(query.originStage),
    commissionPersonId,
    orderCode,
    nfeNumber,
    customer,
    sellerId: parseOptionalInt(query.sellerId),
    representativeId: parseOptionalInt(query.representativeId),
    hasRule: parseOptionalBoolean(query.hasRule),
    includeSuperseded: query.includeSuperseded === "true" || query.includeSuperseded === true,
    page,
    pageSize,
  };
}

function parseOptionalBoolean(raw: unknown): boolean | null {
  if (raw == null || raw === "") return null;
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  throw new CommissionQueryParseError("hasRule inválido.");
}

export function parseCommissionForecastQuery(
  query: Record<string, unknown>
): CommissionForecastQuery {
  return parseCommissionRecordsQuery(query);
}

export function resolveForecastStatusIn(
  query: CommissionForecastQuery
): CommissionRecordStatus[] {
  if (query.status) return [query.status];
  const statuses: CommissionRecordStatus[] = [...COMMISSION_FORECAST_STATUSES];
  if (query.includeSuperseded) {
    statuses.push("SUPERSEDED_BY_OUTPUT_DOCUMENT");
  }
  return statuses;
}

export function parseCommissionConfirmedQuery(
  query: Record<string, unknown>
): CommissionConfirmedQuery {
  const base = parseCommissionRecordsQuery(query);
  const outputDocument =
    typeof query.outputDocument === "string" && query.outputDocument.trim()
      ? query.outputDocument.trim()
      : null;
  return {
    ...base,
    outputDocument,
    includeCancelled:
      query.includeCancelled === "true" || query.includeCancelled === true,
  };
}

export function resolveConfirmedStatusIn(
  query: CommissionConfirmedQuery
): CommissionRecordStatus[] {
  if (query.status) return [query.status];
  const statuses: CommissionRecordStatus[] = [...COMMISSION_CONFIRMED_STATUSES];
  if (query.includeCancelled) {
    statuses.push(...COMMISSION_CONFIRMED_CANCELLED_STATUSES);
  }
  return statuses;
}

export function buildCommissionRecordPeriodWhere(
  query: CommissionPeriodQuery
): Prisma.CommissionRecordWhereInput {
  if (query.from && query.to) {
    return { calculatedAt: { gte: query.from, lte: query.to } };
  }
  if (query.year != null && query.month != null) {
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
    return { calculatedAt: { gte: from, lte: to } };
  }
  if (query.year != null) {
    const from = new Date(Date.UTC(query.year, 0, 1));
    const to = new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999));
    return { calculatedAt: { gte: from, lte: to } };
  }
  return {};
}

export function buildCommissionRecordsWhere(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope
): Prisma.CommissionRecordWhereInput {
  const parts: Prisma.CommissionRecordWhereInput[] = [
    buildCommissionRecordPeriodWhere(query),
    applyCommissionRecordScope(scope, {
      commissionPersonId: query.commissionPersonId,
      sellerId: query.sellerId,
      representativeId: query.representativeId,
    }),
  ];

  if (query.statusIn?.length) {
    parts.push({ status: { in: query.statusIn } });
  } else if (query.status) {
    parts.push({ status: query.status });
  }
  if (query.originStage) parts.push({ originStage: query.originStage });
  if (query.commissionPersonId) {
    parts.push({ commissionPersonId: query.commissionPersonId });
  }
  if (query.orderCode) {
    parts.push({ orderCode: { contains: query.orderCode, mode: "insensitive" } });
  }
  if (query.nfeNumber) {
    parts.push({ nfeNumber: { contains: query.nfeNumber, mode: "insensitive" } });
  }
  if (query.customer) {
    parts.push({ customerName: { contains: query.customer, mode: "insensitive" } });
  }

  const filtered = parts.filter((p) => Object.keys(p).length > 0);
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0]!;
  return { AND: filtered };
}

export function buildCommissionDashboardWhere(
  query: CommissionDashboardQuery,
  scope: CommissionAccessScope
): Prisma.CommissionRecordWhereInput {
  const parts: Prisma.CommissionRecordWhereInput[] = [
    buildCommissionRecordPeriodWhere(query),
    applyCommissionRecordScope(scope, {
      sellerId: query.sellerId,
      representativeId: query.representativeId,
      commissionPersonId: query.commissionPersonId,
    }),
  ];

  if (query.status) parts.push({ status: query.status });
  if (query.commissionPersonId) {
    parts.push({ commissionPersonId: query.commissionPersonId });
  }
  if (query.customer) {
    parts.push({ customerName: { contains: query.customer, mode: "insensitive" } });
  }
  if (query.orderCode) {
    parts.push({ orderCode: { contains: query.orderCode, mode: "insensitive" } });
  }
  if (query.nfeNumber) {
    parts.push({ nfeNumber: { contains: query.nfeNumber, mode: "insensitive" } });
  }
  if (query.ruleId) {
    parts.push({
      metadataJson: {
        path: ["ruleId"],
        equals: query.ruleId,
      },
    });
  }
  if (query.personType) {
    parts.push({
      commissionPerson: {
        type: query.personType as import("@prisma/client").CommissionPersonType,
      },
    });
  } else if (query.type === "SELLER") {
    parts.push({ nomusSellerId: { not: null } });
  } else if (query.type === "REPRESENTATIVE") {
    parts.push({ nomusRepresentativeId: { not: null } });
  }

  const filtered = parts.filter((p) => Object.keys(p).length > 0);
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0]!;
  return { AND: filtered };
}

export function paginatedMeta(total: number, page: number, pageSize: number): PaginatedMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function inferRecordKind(
  status: CommissionRecordStatus
): "forecast" | "confirmed" | "paid" | "other" {
  if (COMMISSION_FORECAST_STATUSES.includes(status)) return "forecast";
  if (COMMISSION_CONFIRMED_STATUSES.includes(status)) return "confirmed";
  if (status === "PAID_PARTIAL" || status === "PAID_TOTAL") return "paid";
  return "other";
}

const SCHEDULE_STATUS_SET = new Set<string>([
  "FORECAST",
  "ACTIVE",
  "SUPERSEDED",
  "PAID",
  "PARTIALLY_PAID",
  "CANCELLED",
  "REVIEW",
]);

const RELEASE_FILTER_SET = new Set<string>(["released", "not_released", "partial"]);

export function parseCommissionReleasesQuery(
  query: Record<string, unknown>
): CommissionReleasesQuery {
  const period = parsePeriodQuery(query);
  const { page, pageSize } = parsePagination(query);
  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }
  const orderCode =
    typeof query.orderCode === "string" && query.orderCode.trim()
      ? query.orderCode.trim()
      : null;
  const nfeNumber =
    typeof query.nfeNumber === "string" && query.nfeNumber.trim()
      ? query.nfeNumber.trim()
      : null;
  const customer =
    typeof query.customer === "string" && query.customer.trim()
      ? query.customer.trim()
      : null;
  const accountStatusRaw =
    typeof query.accountStatus === "string" && query.accountStatus.trim()
      ? query.accountStatus.trim().toUpperCase()
      : null;
  const accountStatus =
    accountStatusRaw && SCHEDULE_STATUS_SET.has(accountStatusRaw) ? accountStatusRaw : null;
  if (accountStatusRaw && !accountStatus) {
    throw new CommissionQueryParseError("accountStatus inválido.");
  }
  const releaseFilterRaw =
    typeof query.releaseFilter === "string" && query.releaseFilter.trim()
      ? query.releaseFilter.trim().toLowerCase()
      : null;
  const releaseFilter =
    releaseFilterRaw && RELEASE_FILTER_SET.has(releaseFilterRaw)
      ? (releaseFilterRaw as CommissionReleaseFilter)
      : null;
  if (releaseFilterRaw && !releaseFilter) {
    throw new CommissionQueryParseError("releaseFilter inválido.");
  }

  return {
    ...period,
    commissionPersonId,
    customer,
    orderCode,
    nfeNumber,
    sellerId: parseOptionalInt(query.sellerId),
    representativeId: parseOptionalInt(query.representativeId),
    receivableId: parseOptionalInt(query.receivableId),
    dueFrom: parseIsoDate(query.dueFrom, "dueFrom"),
    dueTo: parseIsoDate(query.dueTo, "dueTo"),
    settlementFrom: parseIsoDate(query.settlementFrom, "settlementFrom"),
    settlementTo: parseIsoDate(query.settlementTo, "settlementTo"),
    accountStatus,
    releaseFilter,
    page,
    pageSize,
  };
}

export function buildCommissionReleasesDueWhere(
  query: CommissionReleasesQuery
): Prisma.CommissionPaymentScheduleWhereInput {
  if (query.dueFrom && query.dueTo) {
    return { dueDate: { gte: query.dueFrom, lte: query.dueTo } };
  }
  if (query.year != null && query.month != null) {
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999));
    return { dueDate: { gte: from, lte: to } };
  }
  if (query.year != null) {
    const from = new Date(Date.UTC(query.year, 0, 1));
    const to = new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999));
    return { dueDate: { gte: from, lte: to } };
  }
  if (query.from && query.to) {
    return { dueDate: { gte: query.from, lte: query.to } };
  }
  return {};
}

const PERSON_SOURCE_SET = new Set<string>(["NOMUS", "MANUAL"]);

export type CommissionPersonsQuery = CommissionPeriodQuery & {
  page: number;
  pageSize: number;
  active?: boolean;
  type?: string;
  source?: string;
  search?: string;
};

export function parseCommissionPersonsQuery(
  query: Record<string, unknown>
): CommissionPersonsQuery {
  const period = parsePeriodQuery(query);
  const pageRaw = parseOptionalInt(query.page);
  const pageSizeRaw = parseOptionalInt(query.pageSize);
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 50;
  const active =
    query.active === "true" ? true : query.active === "false" ? false : undefined;
  const typeRaw =
    typeof query.type === "string" && query.type.trim() ? query.type.trim().toUpperCase() : null;
  const type = typeRaw && PERSON_TYPE_SET.has(typeRaw) ? typeRaw : undefined;
  if (typeRaw && !type) {
    throw new CommissionQueryParseError("type inválido.");
  }
  const sourceRaw =
    typeof query.source === "string" && query.source.trim()
      ? query.source.trim().toUpperCase()
      : null;
  const source = sourceRaw && PERSON_SOURCE_SET.has(sourceRaw) ? sourceRaw : undefined;
  if (sourceRaw && !source) {
    throw new CommissionQueryParseError("source inválido.");
  }
  const search =
    typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined;
  return { ...period, page, pageSize, active, type, source, search };
}
