import type {
  CommissionRecordOriginStage,
  CommissionRecordStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import type { CommissionReceivableForecastQuery } from "./commissionReceivableForecast.js";
import {
  parseVisualAuditAppraisalMode,
  type VisualAuditAppraisalMode,
} from "./commissionVisualAudit.shared.js";
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

export type CommissionPeriodBasis = "calculatedAt" | "confirmedAt";

export type CommissionPeriodQuery = {
  year: number | null;
  month: number | null;
  from: Date | null;
  to: Date | null;
  periodBasis?: CommissionPeriodBasis;
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

export type CommissionApuracaoLineStatusFilter =
  | "CALCULADA"
  | "LIBERADA"
  | "PAGA"
  | "PENDENTE_RECEBIMENTO"
  | "DIVERGENTE"
  | "BLOQUEADA";

export type CommissionApuracaoQuery = CommissionRecordsQuery & {
  receivableCode: string | null;
  apuracaoStatus: CommissionApuracaoLineStatusFilter | null;
  onlyDivergences: boolean;
  onlyPayable: boolean;
  periodBasis: CommissionPeriodBasis;
  nomusReferenceBase: number | null;
  nomusReferenceCommission: number | null;
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
    periodBasis: "confirmedAt",
  };
}

export function parseCommissionApuracaoQuery(
  query: Record<string, unknown>
): CommissionApuracaoQuery {
  const base = parseCommissionRecordsQuery(query);
  const receivableCode =
    typeof query.receivableCode === "string" && query.receivableCode.trim()
      ? query.receivableCode.trim()
      : null;
  const apuracaoStatusRaw =
    typeof query.apuracaoStatus === "string" ? query.apuracaoStatus.trim().toUpperCase() : null;
  const apuracaoStatusSet = new Set([
    "CALCULADA",
    "LIBERADA",
    "PAGA",
    "PENDENTE_RECEBIMENTO",
    "DIVERGENTE",
    "BLOQUEADA",
  ]);
  const apuracaoStatus =
    apuracaoStatusRaw && apuracaoStatusSet.has(apuracaoStatusRaw)
      ? (apuracaoStatusRaw as CommissionApuracaoLineStatusFilter)
      : null;

  const nomusReferenceBase = parseOptionalFloat(query.nomusReferenceBase);
  const nomusReferenceCommission = parseOptionalFloat(query.nomusReferenceCommission);

  return {
    ...base,
    receivableCode,
    apuracaoStatus,
    onlyDivergences: query.onlyDivergences === "true" || query.onlyDivergences === true,
    onlyPayable: query.onlyPayable === "true" || query.onlyPayable === true,
    periodBasis: "confirmedAt",
    nomusReferenceBase,
    nomusReferenceCommission,
  };
}

function parseOptionalFloat(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
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

export function resolvePeriodDateRange(
  query: CommissionPeriodQuery
): { from: Date; to: Date } | null {
  if (query.from && query.to) {
    return { from: query.from, to: query.to };
  }
  if (query.year != null && query.month != null) {
    return {
      from: new Date(Date.UTC(query.year, query.month - 1, 1)),
      to: new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
    };
  }
  if (query.year != null) {
    return {
      from: new Date(Date.UTC(query.year, 0, 1)),
      to: new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999)),
    };
  }
  return null;
}

export function buildCommissionRecordPeriodWhere(
  query: CommissionPeriodQuery,
  basis: CommissionPeriodBasis = "calculatedAt"
): Prisma.CommissionRecordWhereInput {
  const range = resolvePeriodDateRange(query);
  if (!range) return {};

  if (basis === "confirmedAt") {
    return {
      OR: [
        { confirmedAt: { gte: range.from, lte: range.to } },
        {
          AND: [{ confirmedAt: null }, { calculatedAt: { gte: range.from, lte: range.to } }],
        },
      ],
    };
  }

  return { calculatedAt: { gte: range.from, lte: range.to } };
}

export function buildCommissionRecordsWhere(
  query: CommissionRecordsQuery,
  scope: CommissionAccessScope,
  options?: { periodBasis?: CommissionPeriodBasis }
): Prisma.CommissionRecordWhereInput {
  const periodBasis = options?.periodBasis ?? query.periodBasis ?? "calculatedAt";
  const parts: Prisma.CommissionRecordWhereInput[] = [
    buildCommissionRecordPeriodWhere(query, periodBasis),
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
    parts.push({
      commissionPerson: { type: "SELLER" },
    });
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

const BENEFICIARY_TYPE_SET = new Set<string>(["SELLER", "REPRESENTATIVE", "FIXED_PERSON"]);
const BASE_TYPE_SET = new Set<string>([
  "SALES_ORDER_ITEM_NET",
  "OUTPUT_DOCUMENT_ITEM_NET",
  "RECEIVABLE_AMOUNT",
]);
const RELEASE_RULE_SET = new Set<string>([
  "SALES_ORDER_CREATED",
  "OUTPUT_DOCUMENT_CREATED",
  "FIRST_RECEIVABLE_PAID",
  "EACH_RECEIVABLE_PAID",
]);

export type CommissionRulesQuery = {
  page: number;
  pageSize: number;
  active?: boolean;
  search?: string;
  beneficiaryType?: string;
  baseType?: string;
  releaseRule?: string;
  fixedCommissionPersonId?: string;
};

export function parseCommissionRulesQuery(
  query: Record<string, unknown>
): CommissionRulesQuery {
  const pageRaw = parseOptionalInt(query.page);
  const pageSizeRaw = parseOptionalInt(query.pageSize);
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 50;
  const active =
    query.active === "true" ? true : query.active === "false" ? false : undefined;
  const search =
    typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined;

  const beneficiaryTypeRaw =
    typeof query.beneficiaryType === "string" && query.beneficiaryType.trim()
      ? query.beneficiaryType.trim().toUpperCase()
      : null;
  const beneficiaryType =
    beneficiaryTypeRaw && BENEFICIARY_TYPE_SET.has(beneficiaryTypeRaw)
      ? beneficiaryTypeRaw
      : undefined;
  if (beneficiaryTypeRaw && !beneficiaryType) {
    throw new CommissionQueryParseError("beneficiaryType inválido.");
  }

  const baseTypeRaw =
    typeof query.baseType === "string" && query.baseType.trim()
      ? query.baseType.trim().toUpperCase()
      : null;
  const baseType = baseTypeRaw && BASE_TYPE_SET.has(baseTypeRaw) ? baseTypeRaw : undefined;
  if (baseTypeRaw && !baseType) {
    throw new CommissionQueryParseError("baseType inválido.");
  }

  const releaseRuleRaw =
    typeof query.releaseRule === "string" && query.releaseRule.trim()
      ? query.releaseRule.trim().toUpperCase()
      : null;
  const releaseRule =
    releaseRuleRaw && RELEASE_RULE_SET.has(releaseRuleRaw) ? releaseRuleRaw : undefined;
  if (releaseRuleRaw && !releaseRule) {
    throw new CommissionQueryParseError("releaseRule inválido.");
  }

  const fixedCommissionPersonId = parseOptionalUuid(query.fixedCommissionPersonId);
  if (query.fixedCommissionPersonId && !fixedCommissionPersonId) {
    throw new CommissionQueryParseError("fixedCommissionPersonId inválido.");
  }

  return {
    page,
    pageSize,
    active,
    search,
    beneficiaryType,
    baseType,
    releaseRule,
    fixedCommissionPersonId: fixedCommissionPersonId ?? undefined,
  };
}

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

const BATCH_STATUS_SET = new Set<string>(["DRAFT", "APPROVED", "PAID", "CANCELLED"]);

export type CommissionPaymentsQuery = CommissionPeriodQuery & {
  page: number;
  pageSize: number;
  commissionPersonId?: string;
  status?: string;
  personType?: string;
  paymentDateFrom?: Date | null;
  paymentDateTo?: Date | null;
};

export function parseCommissionPaymentsQuery(
  query: Record<string, unknown>
): CommissionPaymentsQuery {
  const period = parsePeriodQuery(query);
  const pageRaw = parseOptionalInt(query.page);
  const pageSizeRaw = parseOptionalInt(query.pageSize);
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 20;

  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }

  const statusRaw =
    typeof query.status === "string" && query.status.trim()
      ? query.status.trim().toUpperCase()
      : null;
  const status = statusRaw && BATCH_STATUS_SET.has(statusRaw) ? statusRaw : undefined;
  if (statusRaw && !status) {
    throw new CommissionQueryParseError("status inválido.");
  }

  const personTypeRaw =
    typeof query.personType === "string" && query.personType.trim()
      ? query.personType.trim().toUpperCase()
      : null;
  const personType = personTypeRaw && PERSON_TYPE_SET.has(personTypeRaw) ? personTypeRaw : undefined;
  if (personTypeRaw && !personType) {
    throw new CommissionQueryParseError("personType inválido.");
  }

  const paymentDateFrom = parseIsoDate(query.paymentDateFrom, "paymentDateFrom");
  const paymentDateTo = parseIsoDate(query.paymentDateTo, "paymentDateTo");

  return {
    ...period,
    page,
    pageSize,
    commissionPersonId: commissionPersonId ?? undefined,
    status,
    personType,
    paymentDateFrom,
    paymentDateTo,
  };
}

const AUDIT_SEVERITY_SET = new Set<string>(["INFO", "WARNING", "CRITICAL"]);

const AUDIT_TYPE_SET = new Set<string>([
  "ORDER_WITHOUT_SELLER",
  "ORDER_WITHOUT_REPRESENTATIVE",
  "NO_COMMISSION_RULE",
  "ORDER_WITHOUT_NFE",
  "NFE_WITHOUT_OUTPUT_DOCUMENT",
  "NFE_WITHOUT_RECEIVABLE",
  "OUTPUT_DOCUMENT_WITHOUT_ORDER_MATCH",
  "RECEIVABLE_WITHOUT_NFE",
  "CANCELLED_NFE_WITH_ACTIVE_COMMISSION",
  "RECEIVED_WITHOUT_RELEASE",
  "PAID_WITHOUT_RELEASE",
  "DIVERGENT_AMOUNT",
  "MANUAL_REVIEW_REQUIRED",
]);

export type CommissionAuditQuery = CommissionPeriodQuery & {
  page: number;
  pageSize: number;
  resolved?: boolean;
  severity?: string;
  type?: string;
  commissionPersonId?: string;
  orderCode?: string;
  nfeNumber?: string;
  customer?: string;
};

export function parseCommissionAuditQuery(
  query: Record<string, unknown>
): CommissionAuditQuery {
  const period = parsePeriodQuery(query);
  const { page, pageSize } = parsePagination(query);

  const resolved =
    query.resolved === "true" ? true : query.resolved === "false" ? false : undefined;

  const severityRaw =
    typeof query.severity === "string" && query.severity.trim()
      ? query.severity.trim().toUpperCase()
      : undefined;
  const severity =
    severityRaw && AUDIT_SEVERITY_SET.has(severityRaw) ? severityRaw : undefined;
  if (severityRaw && !severity) {
    throw new CommissionQueryParseError("severity inválido.");
  }

  const typeRaw =
    typeof query.type === "string" && query.type.trim()
      ? query.type.trim().toUpperCase()
      : undefined;
  const type = typeRaw && AUDIT_TYPE_SET.has(typeRaw) ? typeRaw : undefined;
  if (typeRaw && !type) {
    throw new CommissionQueryParseError("type inválido.");
  }

  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }

  const orderCode =
    typeof query.orderCode === "string" && query.orderCode.trim()
      ? query.orderCode.trim()
      : undefined;
  const nfeNumber =
    typeof query.nfeNumber === "string" && query.nfeNumber.trim()
      ? query.nfeNumber.trim()
      : undefined;
  const customer =
    typeof query.customer === "string" && query.customer.trim()
      ? query.customer.trim()
      : undefined;

  return {
    ...period,
    page,
    pageSize,
    resolved,
    severity,
    type,
    commissionPersonId: commissionPersonId ?? undefined,
    orderCode,
    nfeNumber,
    customer,
  };
}

export function parseUnpaidReleasedCommissionsQuery(
  query: Record<string, unknown>
): {
  commissionPersonId: string;
  from?: Date;
  to?: Date;
  personType?: string;
} {
  const period = parsePeriodQuery(query);
  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (!commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId é obrigatório.");
  }
  const personTypeRaw =
    typeof query.personType === "string" && query.personType.trim()
      ? query.personType.trim().toUpperCase()
      : null;
  const personType = personTypeRaw && PERSON_TYPE_SET.has(personTypeRaw) ? personTypeRaw : undefined;
  if (personTypeRaw && !personType) {
    throw new CommissionQueryParseError("personType inválido.");
  }

  let from = period.from ?? undefined;
  let to = period.to ?? undefined;
  if (!from && period.year != null && period.month != null) {
    from = new Date(Date.UTC(period.year, period.month - 1, 1));
    to = new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59, 999));
  } else if (!from && period.year != null) {
    from = new Date(Date.UTC(period.year, 0, 1));
    to = new Date(Date.UTC(period.year, 11, 31, 23, 59, 59, 999));
  }

  return { commissionPersonId, from, to, personType };
}

export type CommissionExceptionsQuery = {
  search: string | null;
  active: boolean | null;
  commissionPersonId: string | null;
  page: number;
  pageSize: number;
};

export type CommissionVisualAuditQuery = CommissionRecordsQuery & {
  appraisalMode: VisualAuditAppraisalMode;
  nomusReceivableId: number | null;
  dueDateFrom: Date | null;
  dueDateTo: Date | null;
  settlementDateFrom: Date | null;
  settlementDateTo: Date | null;
  onlySettled: boolean;
  onlyOpen: boolean;
  onlyDivergences: boolean;
  onlyZeroCommission: boolean;
  onlyMissingReceivableLink: boolean;
  receivableTitleStatus: string | null;
  commissionStatus: string | null;
  nomusReferenceBase: number | null;
  nomusReferenceCommission: number | null;
};

export function parseCommissionVisualAuditQuery(
  query: Record<string, unknown>
): CommissionVisualAuditQuery {
  const base = parseCommissionRecordsQuery({
    ...query,
    periodBasis: "confirmedAt",
  });
  const dueDateFrom = parseIsoDate(query.dueDateFrom, "dueDateFrom");
  const dueDateTo = parseIsoDate(query.dueDateTo, "dueDateTo");
  const settlementDateFrom = parseIsoDate(query.settlementDateFrom, "settlementDateFrom");
  const settlementDateTo = parseIsoDate(query.settlementDateTo, "settlementDateTo");
  const nomusReceivableId = parseOptionalInt(query.nomusReceivableId);
  const nomusReferenceBaseRaw = query.nomusReferenceBase ?? query.nomusBase;
  const nomusReferenceCommissionRaw = query.nomusReferenceCommission ?? query.nomusCommission;
  const nomusReferenceBase =
    nomusReferenceBaseRaw != null && nomusReferenceBaseRaw !== ""
      ? Number.parseFloat(String(nomusReferenceBaseRaw).replace(",", "."))
      : null;
  const nomusReferenceCommission =
    nomusReferenceCommissionRaw != null && nomusReferenceCommissionRaw !== ""
      ? Number.parseFloat(String(nomusReferenceCommissionRaw).replace(",", "."))
      : null;

  return {
    ...base,
    appraisalMode: parseVisualAuditAppraisalMode(query.appraisalMode ?? query.mode),
    nomusReceivableId,
    dueDateFrom,
    dueDateTo,
    settlementDateFrom,
    settlementDateTo,
    onlySettled: query.onlySettled === "true",
    onlyOpen: query.onlyOpen === "true",
    onlyDivergences: query.onlyDivergences === "true",
    onlyZeroCommission: query.onlyZeroCommission === "true",
    onlyMissingReceivableLink: query.onlyMissingReceivableLink === "true",
    receivableTitleStatus:
      typeof query.receivableTitleStatus === "string" && query.receivableTitleStatus.trim()
        ? query.receivableTitleStatus.trim()
        : null,
    commissionStatus:
      typeof query.commissionStatus === "string" && query.commissionStatus.trim()
        ? query.commissionStatus.trim()
        : null,
    nomusReferenceBase: Number.isFinite(nomusReferenceBase) ? nomusReferenceBase : null,
    nomusReferenceCommission: Number.isFinite(nomusReferenceCommission)
      ? nomusReferenceCommission
      : null,
  };
}

export type CommissionMonthlyClosingQuery = {
  year: number;
  month: number;
  sellerId: string | null;
  customer: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableId: number | null;
  receivableTitleStatus: string | null;
  commissionStatus: string | null;
  onlyDivergences: boolean;
  nomusReferenceBase: number | null;
  nomusReferenceCommission: number | null;
  page: number;
  pageSize: number;
};

export function parseCommissionMonthlyClosingQuery(
  query: Record<string, unknown>
): CommissionMonthlyClosingQuery {
  const visual = parseCommissionVisualAuditQuery({ ...query, appraisalMode: "PAYABLE" });
  if (visual.year == null || visual.month == null) {
    throw new CommissionQueryParseError("year e month são obrigatórios para fechamento mensal.");
  }
  return {
    year: visual.year,
    month: visual.month,
    sellerId: visual.commissionPersonId,
    customer: visual.customer,
    orderCode: visual.orderCode,
    nfeNumber: visual.nfeNumber,
    nomusReceivableId: visual.nomusReceivableId,
    receivableTitleStatus: visual.receivableTitleStatus,
    commissionStatus: visual.commissionStatus,
    onlyDivergences: visual.onlyDivergences,
    nomusReferenceBase: visual.nomusReferenceBase,
    nomusReferenceCommission: visual.nomusReferenceCommission,
    page: visual.page,
    pageSize: visual.pageSize,
  };
}

export type CommissionReceivableForecastQueryParsed = CommissionReceivableForecastQuery & {
  page: number;
  pageSize: number;
};

export type ReceiptClosingQueryParsed = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  nomusBase?: number | null;
  nomusCommission?: number | null;
};

export function parseReceiptClosingQuery(
  query: Record<string, unknown>
): ReceiptClosingQueryParsed {
  const year = parseOptionalInt(query.year);
  const month = parseOptionalInt(query.month);
  if (year == null || month == null) {
    throw new CommissionQueryParseError("year e month são obrigatórios.");
  }
  if (month < 1 || month > 12) {
    throw new CommissionQueryParseError("month deve estar entre 1 e 12.");
  }
  const seller =
    typeof query.seller === "string" && query.seller.trim() ? query.seller.trim() : null;
  const customer =
    typeof query.customer === "string" && query.customer.trim() ? query.customer.trim() : null;
  const nomusBase = parseOptionalFloat(query.nomusBase);
  const nomusCommission = parseOptionalFloat(query.nomusCommission);
  return { year, month, seller, customer, nomusBase, nomusCommission };
}

export function parseReceiptClosingPeriodParams(params: {
  year?: string;
  month?: string;
}): { year: number; month: number } {
  const year = Number(params.year);
  const month = Number(params.month);
  if (!Number.isFinite(year) || !Number.isInteger(year)) {
    throw new CommissionQueryParseError("year inválido.");
  }
  if (!Number.isFinite(month) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new CommissionQueryParseError("month inválido.");
  }
  return { year, month };
}

export function parseCommissionReceivableForecastQuery(
  query: Record<string, unknown>
): CommissionReceivableForecastQueryParsed {
  const visual = parseCommissionVisualAuditQuery({ ...query, appraisalMode: "FORECAST" });
  const horizonRaw = query.horizonMonths ?? query.horizon;
  const horizonMonths =
    horizonRaw != null && horizonRaw !== ""
      ? Number.parseInt(String(horizonRaw), 10)
      : null;

  return {
    commissionPersonId: visual.commissionPersonId,
    customer: visual.customer,
    orderCode: visual.orderCode,
    nfeNumber: visual.nfeNumber,
    nomusReceivableId: visual.nomusReceivableId,
    receivableTitleStatus: visual.receivableTitleStatus,
    commissionStatus: visual.commissionStatus,
    dueDateFrom: visual.dueDateFrom,
    dueDateTo: visual.dueDateTo,
    onlyDivergences: visual.onlyDivergences,
    horizonMonths: Number.isFinite(horizonMonths) ? horizonMonths : null,
    page: visual.page,
    pageSize: visual.pageSize,
  };
}

export function parseCommissionExceptionsQuery(
  query: Record<string, unknown>
): CommissionExceptionsQuery {
  const { page, pageSize } = parsePagination(query);
  const commissionPersonId = parseOptionalUuid(query.commissionPersonId);
  if (query.commissionPersonId && !commissionPersonId) {
    throw new CommissionQueryParseError("commissionPersonId inválido.");
  }
  const search =
    typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;
  let active: boolean | null = null;
  if (query.active === "true") active = true;
  if (query.active === "false") active = false;
  return { search, active, commissionPersonId, page, pageSize };
}

export type CustomerExclusionRulesQuery = {
  search: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  page: number;
  pageSize: number;
};

export function parseCustomerExclusionRulesQuery(
  query: Record<string, unknown>
): CustomerExclusionRulesQuery {
  const { page, pageSize } = parsePagination(query);
  const search =
    typeof query.search === "string" && query.search.trim() ? query.search.trim() : null;
  let status: "ACTIVE" | "INACTIVE" | null = null;
  if (query.status === "ACTIVE" || query.status === "INACTIVE") {
    status = query.status;
  }
  return { search, status, page, pageSize };
}
