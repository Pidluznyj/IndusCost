import type {
  CommissionCalculationRunMode,
  CommissionPersonSource,
  CommissionPersonType,
  CommissionReleaseRule,
  CommissionRuleBaseType,
  CommissionRuleBeneficiaryType,
  CommissionRuleCalculationType,
} from "@prisma/client";

export class CommissionValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommissionValidationError";
    this.code = code;
  }
}

const PERSON_TYPES = new Set<CommissionPersonType>([
  "SELLER",
  "REPRESENTATIVE",
  "MANAGER",
  "OTHER",
]);
const PERSON_SOURCES = new Set<CommissionPersonSource>(["NOMUS", "MANUAL"]);
const BENEFICIARY_TYPES = new Set<CommissionRuleBeneficiaryType>([
  "SELLER",
  "REPRESENTATIVE",
  "FIXED_PERSON",
]);
const BASE_TYPES = new Set<CommissionRuleBaseType>([
  "SALES_ORDER_ITEM_NET",
  "OUTPUT_DOCUMENT_ITEM_NET",
  "RECEIVABLE_AMOUNT",
]);
const RELEASE_RULES = new Set<CommissionReleaseRule>([
  "SALES_ORDER_CREATED",
  "OUTPUT_DOCUMENT_CREATED",
  "FIRST_RECEIVABLE_PAID",
  "EACH_RECEIVABLE_PAID",
]);
const CALCULATION_TYPES = new Set<CommissionRuleCalculationType>([
  "FIXED_PERCENT",
  "COMMERCIAL_PRICE_TIER",
]);
const RUN_MODES = new Set<CommissionCalculationRunMode>([
  "FORECAST",
  "CONFIRMATION",
  "RELEASE",
  "FULL_RECALC",
]);

function requireString(value: unknown, field: string, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} é obrigatório.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new CommissionValidationError("INVALID_FIELD", "Campo textual inválido.");
  }
  const t = value.trim();
  return t || null;
}

function optionalInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} inválido.`);
  }
  return n;
}

function parseRatePercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new CommissionValidationError("INVALID_RATE", "Percentual não pode ser negativo.");
  }
  return n;
}

function parseIsoDateRequired(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} é obrigatório.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} inválido.`);
  }
  return d;
}

export type CommissionPersonWriteInput = {
  name: string;
  type: CommissionPersonType;
  source?: CommissionPersonSource;
  nomusPersonId?: number | null;
  email?: string | null;
  document?: string | null;
  notes?: string | null;
  active?: boolean;
};

export function parseCommissionPersonCreateBody(body: unknown): CommissionPersonWriteInput {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== "string" || !PERSON_TYPES.has(type as CommissionPersonType)) {
    throw new CommissionValidationError("INVALID_FIELD", "type inválido.");
  }
  const sourceRaw = raw.source;
  const source =
    sourceRaw == null
      ? "MANUAL"
      : typeof sourceRaw === "string" && PERSON_SOURCES.has(sourceRaw as CommissionPersonSource)
        ? (sourceRaw as CommissionPersonSource)
        : (() => {
            throw new CommissionValidationError("INVALID_FIELD", "source inválido.");
          })();

  return {
    name: requireString(raw.name, "name"),
    type: type as CommissionPersonType,
    source,
    nomusPersonId: optionalInt(raw.nomusPersonId, "nomusPersonId"),
    email: optionalString(raw.email),
    document: optionalString(raw.document),
    notes: optionalString(raw.notes),
    active: raw.active === undefined ? true : Boolean(raw.active),
  };
}

export function parseCommissionPersonUpdateBody(body: unknown): Partial<CommissionPersonWriteInput> {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const out: Partial<CommissionPersonWriteInput> = {};

  if (raw.name !== undefined) out.name = requireString(raw.name, "name");
  if (raw.type !== undefined) {
    if (typeof raw.type !== "string" || !PERSON_TYPES.has(raw.type as CommissionPersonType)) {
      throw new CommissionValidationError("INVALID_FIELD", "type inválido.");
    }
    out.type = raw.type as CommissionPersonType;
  }
  if (raw.source !== undefined) {
    if (typeof raw.source !== "string" || !PERSON_SOURCES.has(raw.source as CommissionPersonSource)) {
      throw new CommissionValidationError("INVALID_FIELD", "source inválido.");
    }
    out.source = raw.source as CommissionPersonSource;
  }
  if (raw.nomusPersonId !== undefined) {
    out.nomusPersonId = optionalInt(raw.nomusPersonId, "nomusPersonId");
  }
  if (raw.email !== undefined) out.email = optionalString(raw.email);
  if (raw.document !== undefined) out.document = optionalString(raw.document);
  if (raw.notes !== undefined) out.notes = optionalString(raw.notes);
  if (raw.active !== undefined) out.active = Boolean(raw.active);

  return out;
}

export type CommissionRuleConditionInput = {
  companyExternalId?: number | null;
  customerExternalId?: number | null;
  customerUf?: string | null;
  nomusSellerId?: number | null;
  nomusRepresentativeId?: number | null;
  productExternalId?: number | null;
  productGroupExternalId?: number | null;
  priceTableExternalId?: number | null;
  paymentConditionExternalId?: number | null;
  movementTypeExternalId?: number | null;
  minOrderAmount?: number | null;
  maxOrderAmount?: number | null;
  minDiscountPercent?: number | null;
  maxDiscountPercent?: number | null;
};

export type CommissionRuleWriteInput = {
  name: string;
  description?: string | null;
  active?: boolean;
  priority?: number;
  beneficiaryType: CommissionRuleBeneficiaryType;
  calculationType?: CommissionRuleCalculationType;
  fixedCommissionPersonId?: string | null;
  ratePercent: number;
  baseType: CommissionRuleBaseType;
  releaseRule: CommissionReleaseRule;
  validFrom?: Date | null;
  validTo?: Date | null;
  conditions?: CommissionRuleConditionInput[];
};

function parseRuleCondition(raw: unknown): CommissionRuleConditionInput {
  if (!raw || typeof raw !== "object") {
    throw new CommissionValidationError("INVALID_FIELD", "condition inválida.");
  }
  const c = raw as Record<string, unknown>;
  return {
    companyExternalId: optionalInt(c.companyExternalId, "companyExternalId"),
    customerExternalId: optionalInt(c.customerExternalId, "customerExternalId"),
    customerUf: optionalString(c.customerUf),
    nomusSellerId: optionalInt(c.nomusSellerId, "nomusSellerId"),
    nomusRepresentativeId: optionalInt(c.nomusRepresentativeId, "nomusRepresentativeId"),
    productExternalId: optionalInt(c.productExternalId, "productExternalId"),
    productGroupExternalId: optionalInt(c.productGroupExternalId, "productGroupExternalId"),
    priceTableExternalId: optionalInt(c.priceTableExternalId, "priceTableExternalId"),
    paymentConditionExternalId: optionalInt(c.paymentConditionExternalId, "paymentConditionExternalId"),
    movementTypeExternalId: optionalInt(c.movementTypeExternalId, "movementTypeExternalId"),
    minOrderAmount: c.minOrderAmount != null ? parseRatePercent(c.minOrderAmount) : null,
    maxOrderAmount: c.maxOrderAmount != null ? parseRatePercent(c.maxOrderAmount) : null,
    minDiscountPercent: c.minDiscountPercent != null ? parseRatePercent(c.minDiscountPercent) : null,
    maxDiscountPercent: c.maxDiscountPercent != null ? parseRatePercent(c.maxDiscountPercent) : null,
  };
}

function parseRuleCore(raw: Record<string, unknown>): Omit<CommissionRuleWriteInput, "name"> & { name?: string } {
  const beneficiaryType = raw.beneficiaryType;
  if (
    typeof beneficiaryType !== "string" ||
    !BENEFICIARY_TYPES.has(beneficiaryType as CommissionRuleBeneficiaryType)
  ) {
    throw new CommissionValidationError("INVALID_FIELD", "beneficiaryType inválido.");
  }
  const baseType = raw.baseType;
  if (typeof baseType !== "string" || !BASE_TYPES.has(baseType as CommissionRuleBaseType)) {
    throw new CommissionValidationError("INVALID_FIELD", "baseType inválido.");
  }
  const releaseRule = raw.releaseRule;
  if (typeof releaseRule !== "string" || !RELEASE_RULES.has(releaseRule as CommissionReleaseRule)) {
    throw new CommissionValidationError("INVALID_FIELD", "releaseRule inválido.");
  }

  const calculationTypeRaw = raw.calculationType ?? "FIXED_PERCENT";
  if (
    typeof calculationTypeRaw !== "string" ||
    !CALCULATION_TYPES.has(calculationTypeRaw as CommissionRuleCalculationType)
  ) {
    throw new CommissionValidationError("INVALID_FIELD", "calculationType inválido.");
  }
  const calculationType = calculationTypeRaw as CommissionRuleCalculationType;

  const ratePercent =
    calculationType === "COMMERCIAL_PRICE_TIER"
      ? 0
      : parseRatePercent(raw.ratePercent);
  const conditions = Array.isArray(raw.conditions)
    ? raw.conditions.map(parseRuleCondition)
    : undefined;

  return {
    name: raw.name !== undefined ? requireString(raw.name, "name") : undefined,
    description: raw.description !== undefined ? optionalString(raw.description) : undefined,
    active: raw.active !== undefined ? Boolean(raw.active) : undefined,
    priority:
      raw.priority !== undefined
        ? (() => {
            const p = Number(raw.priority);
            if (!Number.isFinite(p) || !Number.isInteger(p)) {
              throw new CommissionValidationError("INVALID_FIELD", "priority inválido.");
            }
            return p;
          })()
        : undefined,
    beneficiaryType: beneficiaryType as CommissionRuleBeneficiaryType,
    calculationType,
    fixedCommissionPersonId:
      raw.fixedCommissionPersonId !== undefined
        ? optionalString(raw.fixedCommissionPersonId)
        : undefined,
    ratePercent,
    baseType: baseType as CommissionRuleBaseType,
    releaseRule: releaseRule as CommissionReleaseRule,
    validFrom:
      raw.validFrom !== undefined
        ? raw.validFrom
          ? parseIsoDateRequired(raw.validFrom, "validFrom")
          : null
        : undefined,
    validTo:
      raw.validTo !== undefined
        ? raw.validTo
          ? parseIsoDateRequired(raw.validTo, "validTo")
          : null
        : undefined,
    conditions,
  };
}

export function parseCommissionRuleCreateBody(body: unknown): CommissionRuleWriteInput {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const core = parseRuleCore(raw);
  if (!core.name) {
    throw new CommissionValidationError("INVALID_FIELD", "name é obrigatório.");
  }
  if (
    core.beneficiaryType === "FIXED_PERSON" &&
    !core.fixedCommissionPersonId
  ) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "fixedCommissionPersonId é obrigatório para FIXED_PERSON."
    );
  }
  const validFrom = core.validFrom ?? null;
  const validTo = core.validTo ?? null;
  if (validFrom && validTo && validTo < validFrom) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Vigência final não pode ser anterior à vigência inicial."
    );
  }
  return {
    name: core.name,
    description: core.description ?? null,
    active: core.active ?? true,
    priority: core.priority ?? 100,
    beneficiaryType: core.beneficiaryType,
    calculationType: core.calculationType ?? "FIXED_PERCENT",
    fixedCommissionPersonId: core.fixedCommissionPersonId ?? null,
    ratePercent: core.ratePercent,
    baseType: core.baseType,
    releaseRule: core.releaseRule,
    validFrom: core.validFrom ?? null,
    validTo: core.validTo ?? null,
    conditions: core.conditions ?? [],
  };
}

export function parseCommissionRuleUpdateBody(body: unknown): Partial<CommissionRuleWriteInput> {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  return parseRuleCore(body as Record<string, unknown>);
}

export function parseCommissionRecalculateBody(body: unknown): {
  from: Date;
  to: Date;
  mode: CommissionCalculationRunMode;
} {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const from = parseIsoDateRequired(raw.from, "from");
  const to = parseIsoDateRequired(raw.to, "to");
  if (from > to) {
    throw new CommissionValidationError("INVALID_FIELD", "from não pode ser posterior a to.");
  }
  const mode = raw.mode;
  if (typeof mode !== "string" || !RUN_MODES.has(mode as CommissionCalculationRunMode)) {
    throw new CommissionValidationError("INVALID_FIELD", "mode inválido.");
  }
  return { from, to, mode: mode as CommissionCalculationRunMode };
}

import type { CommissionSettingsSnapshot } from "./commission-types.js";

export type CommissionSettingsWriteInput = Partial<CommissionSettingsSnapshot>;

export function parseCommissionSettingsUpdateBody(body: unknown): CommissionSettingsWriteInput {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const out: CommissionSettingsWriteInput = {};

  if (raw.releaseDefaultRule !== undefined) {
    if (
      typeof raw.releaseDefaultRule !== "string" ||
      !RELEASE_RULES.has(raw.releaseDefaultRule as CommissionReleaseRule)
    ) {
      throw new CommissionValidationError("INVALID_FIELD", "releaseDefaultRule inválido.");
    }
    out.releaseDefaultRule = raw.releaseDefaultRule as CommissionReleaseRule;
  }

  const booleanFields = [
    "forecastEnabled",
    "outputDocumentSupersedesForecast",
    "receivableAsDefinitiveReleaseSource",
    "paidCommissionBlockAutoChange",
    "manualPaymentEnabled",
    "partialPaymentEnabled",
    "requireApprovalBeforePaid",
    "auditOrderWithoutSeller",
    "auditOrderWithoutRepresentative",
    "auditNfeWithoutOutputDocument",
    "auditNfeWithoutReceivable",
    "auditPaidWithoutRelease",
    "calculateForSellers",
    "calculateForRepresentatives",
    "allowFixedPersonInRule",
  ] as const;

  for (const field of booleanFields) {
    if (raw[field] !== undefined) {
      out[field] = Boolean(raw[field]);
    }
  }

  return out;
}

export function parsePaymentBatchCreateBody(body: unknown): {
  periodStart: Date;
  periodEnd: Date;
  commissionPersonId: string;
  recordIds: string[];
  notes?: string | null;
} {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const commissionPersonId = requireString(raw.commissionPersonId, "commissionPersonId");
  const periodStart = parseIsoDateRequired(raw.periodStart, "periodStart");
  const periodEnd = parseIsoDateRequired(raw.periodEnd, "periodEnd");
  if (!Array.isArray(raw.recordIds) || raw.recordIds.length === 0) {
    throw new CommissionValidationError("INVALID_FIELD", "recordIds é obrigatório.");
  }
  const recordIds = raw.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (recordIds.length === 0) {
    throw new CommissionValidationError("INVALID_FIELD", "recordIds inválido.");
  }
  return {
    periodStart,
    periodEnd,
    commissionPersonId,
    recordIds,
    notes: optionalString(raw.notes),
  };
}

export function parseMarkPaidBody(body: unknown): { paymentDate: Date } {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  return { paymentDate: parseIsoDateRequired(raw.paymentDate ?? raw.paidAt, "paymentDate") };
}

export function parseCommissionAuditRerunBody(body: unknown): { from: Date; to: Date } {
  if (!body || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const raw = body as Record<string, unknown>;
  const from = parseIsoDateRequired(raw.from, "from");
  const to = parseIsoDateRequired(raw.to, "to");
  if (from > to) {
    throw new CommissionValidationError("INVALID_FIELD", "from não pode ser posterior a to.");
  }
  return { from, to };
}

export function parseAuditListQuery(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  resolved?: boolean;
  severity?: string;
} {
  const pageRaw = optionalInt(query.page, "page");
  const pageSizeRaw = optionalInt(query.pageSize, "pageSize");
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 20;
  const resolved =
    query.resolved === "true" ? true : query.resolved === "false" ? false : undefined;
  const severity =
    typeof query.severity === "string" && query.severity.trim()
      ? query.severity.trim()
      : undefined;
  return { page, pageSize, resolved, severity };
}

export function parsePaymentBatchesListQuery(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  commissionPersonId?: string;
  status?: string;
} {
  const pageRaw = optionalInt(query.page, "page");
  const pageSizeRaw = optionalInt(query.pageSize, "pageSize");
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 20;
  const commissionPersonId =
    typeof query.commissionPersonId === "string" && query.commissionPersonId.trim()
      ? query.commissionPersonId.trim()
      : undefined;
  const status =
    typeof query.status === "string" && query.status.trim() ? query.status.trim() : undefined;
  return { page, pageSize, commissionPersonId, status };
}

export function parsePersonsListQuery(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  active?: boolean;
  type?: string;
} {
  const pageRaw = optionalInt(query.page, "page");
  const pageSizeRaw = optionalInt(query.pageSize, "pageSize");
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 50;
  const active =
    query.active === "true" ? true : query.active === "false" ? false : undefined;
  const type =
    typeof query.type === "string" && query.type.trim() ? query.type.trim() : undefined;
  return { page, pageSize, active, type };
}

export function parseRulesListQuery(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  active?: boolean;
} {
  const pageRaw = optionalInt(query.page, "page");
  const pageSizeRaw = optionalInt(query.pageSize, "pageSize");
  const page = pageRaw != null && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = pageSizeRaw != null && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 100) : 50;
  const active =
    query.active === "true" ? true : query.active === "false" ? false : undefined;
  return { page, pageSize, active };
}

export function parseCommissionExceptionCreateBody(raw: unknown): {
  customerExternalId?: number | null;
  customerName?: string | null;
  commissionPersonId?: string | null;
  productCode?: string | null;
  productExternalId?: number | null;
  reason: string;
  startDate: Date;
  endDate?: Date | null;
  active?: boolean;
  metadataJson?: Record<string, unknown>;
} {
  if (!raw || typeof raw !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const body = raw as Record<string, unknown>;
  const reason = requireString(body.reason, "reason");
  const startDateRaw = body.startDate;
  if (typeof startDateRaw !== "string" || !startDateRaw.trim()) {
    throw new CommissionValidationError("INVALID_FIELD", "startDate é obrigatório.");
  }
  const startDate = new Date(startDateRaw);
  if (Number.isNaN(startDate.getTime())) {
    throw new CommissionValidationError("INVALID_FIELD", "startDate inválido.");
  }
  let endDate: Date | null | undefined;
  if (body.endDate != null && body.endDate !== "") {
    if (typeof body.endDate !== "string") {
      throw new CommissionValidationError("INVALID_FIELD", "endDate inválido.");
    }
    endDate = new Date(body.endDate);
    if (Number.isNaN(endDate.getTime())) {
      throw new CommissionValidationError("INVALID_FIELD", "endDate inválido.");
    }
  }
  const customerExternalId =
    body.customerExternalId != null ? Number(body.customerExternalId) : null;
  if (customerExternalId != null && !Number.isFinite(customerExternalId)) {
    throw new CommissionValidationError("INVALID_FIELD", "customerExternalId inválido.");
  }
  if (!customerExternalId && !optionalString(body.customerName)) {
    throw new CommissionValidationError("INVALID_FIELD", "Informe cliente (nome ou ID externo).");
  }
  return {
    customerExternalId,
    customerName: optionalString(body.customerName),
    commissionPersonId: optionalString(body.commissionPersonId),
    productCode: optionalString(body.productCode),
    productExternalId:
      body.productExternalId != null ? Number(body.productExternalId) : null,
    reason,
    startDate,
    endDate,
    active: body.active !== undefined ? Boolean(body.active) : undefined,
    metadataJson:
      body.metadataJson && typeof body.metadataJson === "object"
        ? (body.metadataJson as Record<string, unknown>)
        : undefined,
  };
}

export function parseCommissionExceptionUpdateBody(raw: unknown): Partial<
  ReturnType<typeof parseCommissionExceptionCreateBody>
> {
  if (!raw || typeof raw !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const body = raw as Record<string, unknown>;
  const patch: Partial<ReturnType<typeof parseCommissionExceptionCreateBody>> = {};
  if (body.reason !== undefined) patch.reason = requireString(body.reason, "reason");
  if (body.startDate !== undefined) {
    if (typeof body.startDate !== "string") {
      throw new CommissionValidationError("INVALID_FIELD", "startDate inválido.");
    }
    const d = new Date(body.startDate);
    if (Number.isNaN(d.getTime())) {
      throw new CommissionValidationError("INVALID_FIELD", "startDate inválido.");
    }
    patch.startDate = d;
  }
  if (body.endDate !== undefined) {
    if (body.endDate == null || body.endDate === "") patch.endDate = null;
    else {
      if (typeof body.endDate !== "string") {
        throw new CommissionValidationError("INVALID_FIELD", "endDate inválido.");
      }
      const d = new Date(body.endDate);
      if (Number.isNaN(d.getTime())) {
        throw new CommissionValidationError("INVALID_FIELD", "endDate inválido.");
      }
      patch.endDate = d;
    }
  }
  if (body.customerExternalId !== undefined) {
    patch.customerExternalId =
      body.customerExternalId != null ? Number(body.customerExternalId) : null;
  }
  if (body.customerName !== undefined) patch.customerName = optionalString(body.customerName);
  if (body.commissionPersonId !== undefined) {
    patch.commissionPersonId = optionalString(body.commissionPersonId);
  }
  if (body.productCode !== undefined) patch.productCode = optionalString(body.productCode);
  if (body.productExternalId !== undefined) {
    patch.productExternalId =
      body.productExternalId != null ? Number(body.productExternalId) : null;
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.metadataJson !== undefined && typeof body.metadataJson === "object") {
    patch.metadataJson = body.metadataJson as Record<string, unknown>;
  }
  return patch;
}

function parseRequiredDateField(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} é obrigatório.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} inválido.`);
  }
  return d;
}

function parseOptionalDateField(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new CommissionValidationError("INVALID_FIELD", `${field} inválido.`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new CommissionValidationError("INVALID_FIELD", `${field} inválido.`);
  }
  return d;
}

export function parseCustomerExclusionCreateBody(raw: unknown): {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerNameSnapshot?: string | null;
  reason: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  notes?: string | null;
} {
  if (!raw || typeof raw !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const body = raw as Record<string, unknown>;
  const reason = requireString(body.reason, "reason");
  const effectiveFrom = parseRequiredDateField(body.effectiveFrom, "effectiveFrom");
  const effectiveTo = parseOptionalDateField(body.effectiveTo, "effectiveTo");
  const customerId = optionalString(body.customerId);
  const customerExternalId =
    body.customerExternalId != null ? Number(body.customerExternalId) : null;
  if (customerExternalId != null && !Number.isFinite(customerExternalId)) {
    throw new CommissionValidationError("INVALID_FIELD", "customerExternalId inválido.");
  }
  const customerNameSnapshot = optionalString(body.customerNameSnapshot);
  if (!customerId && customerExternalId == null && !customerNameSnapshot) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Informe cliente (customerId, customerExternalId ou customerNameSnapshot)."
    );
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "effectiveTo não pode ser anterior a effectiveFrom."
    );
  }
  return {
    customerId,
    customerExternalId,
    customerNameSnapshot,
    reason,
    effectiveFrom,
    effectiveTo: effectiveTo ?? undefined,
    notes: optionalString(body.notes) ?? undefined,
  };
}

export function parseCustomerExclusionUpdateBody(raw: unknown): Partial<
  ReturnType<typeof parseCustomerExclusionCreateBody>
> {
  if (!raw || typeof raw !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo inválido.");
  }
  const body = raw as Record<string, unknown>;
  const patch: Partial<ReturnType<typeof parseCustomerExclusionCreateBody>> = {};
  if (body.reason !== undefined) patch.reason = requireString(body.reason, "reason");
  if (body.effectiveFrom !== undefined) {
    patch.effectiveFrom = parseRequiredDateField(body.effectiveFrom, "effectiveFrom");
  }
  if (body.effectiveTo !== undefined) {
    patch.effectiveTo = parseOptionalDateField(body.effectiveTo, "effectiveTo") ?? null;
  }
  if (body.customerId !== undefined) patch.customerId = optionalString(body.customerId);
  if (body.customerExternalId !== undefined) {
    patch.customerExternalId =
      body.customerExternalId != null ? Number(body.customerExternalId) : null;
  }
  if (body.customerNameSnapshot !== undefined) {
    patch.customerNameSnapshot = optionalString(body.customerNameSnapshot);
  }
  if (body.notes !== undefined) patch.notes = optionalString(body.notes);
  if (
    patch.effectiveFrom &&
    patch.effectiveTo &&
    patch.effectiveTo < patch.effectiveFrom
  ) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "effectiveTo não pode ser anterior a effectiveFrom."
    );
  }
  return patch;
}

function parseReceiptClosingYearMonth(body: Record<string, unknown>): { year: number; month: number } {
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isFinite(year) || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new CommissionValidationError("INVALID_FIELD", "year inválido.");
  }
  if (!Number.isFinite(month) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new CommissionValidationError("INVALID_FIELD", "month inválido.");
  }
  return { year, month };
}

export function parseReceiptClosingPeriodBody(body: unknown) {
  if (body == null || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo da requisição inválido.");
  }
  return parseReceiptClosingYearMonth(body as Record<string, unknown>);
}

export function parseReceiptClosingApplyBody(body: unknown) {
  if (body == null || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo da requisição inválido.");
  }
  const record = body as Record<string, unknown>;
  const { year, month } = parseReceiptClosingYearMonth(record);
  const confirm = requireString(record.confirm, "confirm");
  if (confirm !== "FECHAR COMISSAO") {
    throw new CommissionValidationError(
      "CONFIRMATION_REQUIRED",
      'Confirmação obrigatória: digite "FECHAR COMISSAO".'
    );
  }
  return {
    year,
    month,
    confirm,
    notes: optionalString(record.notes),
  };
}

export function parseReceiptClosingReprocessBody(body: unknown) {
  if (body == null || typeof body !== "object") {
    throw new CommissionValidationError("INVALID_BODY", "Corpo da requisição inválido.");
  }
  const record = body as Record<string, unknown>;
  const { year, month } = parseReceiptClosingYearMonth(record);
  const confirm = requireString(record.confirm, "confirm");
  if (confirm !== "REPROCESSAR COMISSAO") {
    throw new CommissionValidationError(
      "CONFIRMATION_REQUIRED",
      'Confirmação obrigatória: digite "REPROCESSAR COMISSAO".'
    );
  }
  const reason = requireString(record.reason ?? record.notes, "reason", 3);
  return {
    year,
    month,
    confirm,
    reason,
  };
}
