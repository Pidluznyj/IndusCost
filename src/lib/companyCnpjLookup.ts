import { prisma } from "@/src/lib/prisma.js";
import { isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";
import {
  buildStructuredNormalizedSummary,
  buildPublicContactNote,
  summaryToCustomerDraft,
  type NormalizedCnpjSummary,
} from "./companyCnpjNormalize.js";
import {
  calculateCommercialRiskScore,
  type CommercialRiskResult,
} from "./companyCommercialRiskScore.js";
import { buildCommercialInsightsBundle } from "./companyCommercialInsights.js";
import {
  buildApplyPatch,
  compareCustomerWithCnpjData,
  ApplyFieldSelectionError,
  type CustomerCompareResult,
} from "./companyCnpjCompare.js";
import { writeCommercialAuditLog } from "./commercialAuditLog.js";
import { CompanyIntelligenceError } from "./company-intelligence/errors.js";
import { lookupCompanyRegistry } from "./company-intelligence/lookupCompanyRegistry.js";
import { isProviderSuccess } from "./company-intelligence/providers/types.js";
import { publicaCnpjWsProvider } from "./company-intelligence/providers/publicaCnpjWsProvider.js";
import {
  CNPJ_SOURCE_DISPLAY_NAME,
  ECONOMIC_SOURCE_BCB,
  type CnpjFieldProvenance,
  type CnpjSourceStatus,
} from "./company-intelligence/registryTypes.js";
import { getEconomicContextSafe } from "./economic-context/economicContextService.js";
import type { EconomicContextPayload } from "./economic-context/economicContextTypes.js";
import { CNPJ_CACHE_TTL_MS } from "./companyCnpjLookupConstants.js";

export { CompanyIntelligenceError } from "./company-intelligence/errors.js";
export { CNPJ_CACHE_TTL_MS, CNPJ_LOOKUP_SOURCE } from "./companyCnpjLookupConstants.js";

export type CompanyIntelligencePayload = {
  lookupId: string;
  cnpj: string;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  fromCache: boolean;
  customerId: string | null;
  summary: NormalizedCnpjSummary;
  structuredSummary: ReturnType<typeof buildStructuredNormalizedSummary>;
  risk: CommercialRiskResult;
  commercial: ReturnType<typeof buildCommercialInsightsBundle>;
  comparison: CustomerCompareResult | null;
  erpCommercialData: Record<string, string | null> | null;
  customerDraft: Record<string, string> | null;
  publicContactSuggestion: { phone: string | null; email: string | null; disclaimer: string } | null;
  filledFieldCount: number;
  rawJson: unknown;
  sources: CnpjSourceStatus[];
  provenance: CnpjFieldProvenance[];
  conflicts: CnpjFieldProvenance[];
  partialResult: boolean;
  registryRole: "primary" | "fallback";
  economicContext: EconomicContextPayload | null;
};

function sellerUfFromEnv(): string {
  return (process.env.COMPANY_INTELLIGENCE_SELLER_UF ?? "PR").trim().toUpperCase();
}

export async function fetchPublicCnpj(
  cnpj: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const digits = normalizeCnpj(cnpj);
  if (!isValidCnpj(digits)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }
  const outcome = await publicaCnpjWsProvider.lookup(digits, fetchImpl);
  if (isProviderSuccess(outcome)) return outcome.rawJson;
  const code =
    outcome.status === "NOT_FOUND"
      ? "CNPJ_NOT_FOUND"
      : outcome.status === "RATE_LIMIT"
        ? "RATE_LIMIT"
        : outcome.status === "TIMEOUT"
          ? "TIMEOUT"
          : outcome.status === "INVALID_PAYLOAD"
            ? "INVALID_PAYLOAD"
            : "UPSTREAM_UNAVAILABLE";
  throw new CompanyIntelligenceError(
    outcome.message,
    code,
    outcome.httpStatus ?? 502
  );
}

function serializeLookup(row: {
  id: string;
  cnpj: string;
  customerId: string | null;
  source: string;
  rawJson: unknown;
  normalizedSummary: unknown;
  riskScore: number;
  riskVerdict: string;
  riskDetails: unknown;
  commercialInsights: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}): Omit<
  CompanyIntelligencePayload,
  | "comparison"
  | "customerDraft"
  | "filledFieldCount"
  | "erpCommercialData"
  | "publicContactSuggestion"
  | "sources"
  | "provenance"
  | "conflicts"
  | "partialResult"
  | "registryRole"
  | "economicContext"
> & {
  summary: NormalizedCnpjSummary;
  risk: CommercialRiskResult;
  commercial: ReturnType<typeof buildCommercialInsightsBundle>;
} {
  const summary = row.normalizedSummary as NormalizedCnpjSummary;
  const risk = row.riskDetails as CommercialRiskResult;
  const commercial = row.commercialInsights as ReturnType<typeof buildCommercialInsightsBundle>;
  const structuredSummary = buildStructuredNormalizedSummary(summary);
  return {
    lookupId: row.id,
    cnpj: row.cnpj,
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    fromCache: true,
    customerId: row.customerId,
    summary,
    structuredSummary,
    risk,
    commercial,
    rawJson: row.rawJson,
  };
}

async function findValidCache(cnpj: string) {
  return prisma.customerCnpjLookup.findFirst({
    where: { cnpj, expiresAt: { gt: new Date() } },
    orderBy: { fetchedAt: "desc" },
  });
}

function extractSummary(normalizedSummary: unknown): NormalizedCnpjSummary {
  return normalizedSummary as NormalizedCnpjSummary;
}

function economicSourceStatus(economic: EconomicContextPayload): CnpjSourceStatus {
  const status =
    economic.status === "ok"
      ? "SUCCESS"
      : economic.status === "partial"
        ? "SUCCESS"
        : "UNAVAILABLE";
  return {
    source: ECONOMIC_SOURCE_BCB,
    displayName: CNPJ_SOURCE_DISPLAY_NAME[ECONOMIC_SOURCE_BCB] ?? "Banco Central do Brasil",
    role: "economic",
    status,
    fetchedAt: economic.fetchedAt,
    fromCache: economic.fromCache,
    latencyMs: null,
    message:
      economic.status === "unavailable"
        ? "Contexto econômico temporariamente indisponível"
        : economic.status === "partial"
          ? "Contexto econômico parcial"
          : null,
  };
}

export async function buildCompanyIntelligencePayload(input: {
  cnpj: string;
  customerId?: string | null;
  forceRefresh?: boolean;
  userId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CompanyIntelligencePayload> {
  const cnpj = normalizeCnpj(input.cnpj);
  if (!isValidCnpj(cnpj)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  let fromCache = false;
  let row = !input.forceRefresh ? await findValidCache(cnpj) : null;

  const registry = await lookupCompanyRegistry({
    cnpj,
    fetchImpl: input.fetchImpl,
    forceRefresh: Boolean(input.forceRefresh),
    primaryFromCache:
      row && row.source !== "brasilapi.com.br"
        ? {
            source: row.source,
            rawJson: row.rawJson,
            summary: extractSummary(row.normalizedSummary),
            fetchedAt: row.fetchedAt,
          }
        : null,
  });

  if (!row) {
    const summary = registry.summary;
    const structuredSummary = buildStructuredNormalizedSummary(summary);
    const risk = calculateCommercialRiskScore(summary);
    const commercial = buildCommercialInsightsBundle(summary, risk, sellerUfFromEnv());
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CNPJ_CACHE_TTL_MS);

    row = await prisma.customerCnpjLookup.create({
      data: {
        cnpj,
        customerId: input.customerId ?? null,
        source: registry.winningSource,
        rawJson: registry.rawJson as object,
        normalizedSummary: { ...summary, ...structuredSummary } as object,
        riskScore: risk.score,
        riskVerdict: risk.verdict,
        riskDetails: risk as object,
        commercialInsights: commercial as object,
        fetchedAt: now,
        expiresAt,
        fetchedByUserId: input.userId ?? null,
      },
    });

    await writeCommercialAuditLog({
      entityType: input.customerId ? "Customer" : "CustomerCnpjLookup",
      entityId: input.customerId ?? row.id,
      action: input.forceRefresh ? "CNPJ_LOOKUP_REFRESH" : "CNPJ_LOOKUP",
      newValue: "cnpj-lookup",
      performedBy: input.userId ?? null,
    });
  } else {
    fromCache = true;
    if (input.customerId && row.customerId !== input.customerId) {
      row = await prisma.customerCnpjLookup.update({
        where: { id: row.id },
        data: { customerId: input.customerId },
      });
    }
  }

  const base = serializeLookup(row);
  let comparison: CustomerCompareResult | null = null;
  let customerDraft: Record<string, string> | null = null;
  let erpCommercialData: Record<string, string | null> | null = null;

  if (input.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) {
      throw new CompanyIntelligenceError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND", 404);
    }
    if (!normalizeCnpj(customer.taxId)) {
      throw new CompanyIntelligenceError(
        "Cliente não possui CNPJ cadastrado para consulta.",
        "CUSTOMER_WITHOUT_CNPJ",
        422
      );
    }
    comparison = compareCustomerWithCnpjData(customer, base.summary);
    erpCommercialData = {
      contactName: customer.contactName,
      phone: customer.phone,
      email: customer.email,
      accountOwner: customer.accountOwner,
      commercialNotes: customer.commercialNotes,
      relationshipStatus: customer.relationshipStatus,
    };
  } else {
    customerDraft = summaryToCustomerDraft(base.summary);
  }

  const publicContactSuggestion = {
    phone: base.summary.phone,
    email: base.summary.email,
    disclaimer: base.structuredSummary.publicContactData.disclaimer,
  };

  const { countFilledJsonFields } = await import("./companyCnpjFormat.js");
  const economicContext = await getEconomicContextSafe({ fetchImpl: input.fetchImpl });

  return {
    ...base,
    source: registry.winningSource || base.source,
    fromCache,
    comparison,
    erpCommercialData,
    customerDraft,
    publicContactSuggestion,
    filledFieldCount: countFilledJsonFields(base.rawJson),
    sources: [...registry.sources, economicSourceStatus(economicContext)],
    provenance: registry.provenance,
    conflicts: registry.conflicts,
    partialResult: registry.partialResult,
    registryRole: registry.registryRole,
    economicContext,
  };
}

export async function applyCompanyIntelligenceToCustomer(input: {
  customerId: string;
  lookupId: string;
  selectedFields: string[];
  confirmPublicContactOverwrite?: boolean;
  userId?: string | null;
}) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) {
    throw new CompanyIntelligenceError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND", 404);
  }

  const lookup = await prisma.customerCnpjLookup.findUnique({ where: { id: input.lookupId } });
  if (!lookup) {
    throw new CompanyIntelligenceError("Consulta não encontrada.", "LOOKUP_NOT_FOUND", 404);
  }

  const summary = lookup.normalizedSummary as NormalizedCnpjSummary;

  try {
    const patch = buildApplyPatch(customer, summary, input.selectedFields, {
      confirmPublicContactOverwrite: input.confirmPublicContactOverwrite ?? false,
    });
    if (Object.keys(patch).length === 0) {
      throw new CompanyIntelligenceError(
        "Nenhum campo válido selecionado para atualização.",
        "NO_FIELDS_SELECTED",
        422
      );
    }

    for (const [field, newValue] of Object.entries(patch)) {
      if (!newValue.trim()) continue;
      const oldValue = String((customer as Record<string, unknown>)[field] ?? "");
      const action =
        field === "phone" || field === "email"
          ? "CNPJ_PUBLIC_CONTACT_APPLY"
          : "CNPJ_INTELLIGENCE_APPLY";
      await writeCommercialAuditLog({
        entityType: "Customer",
        entityId: customer.id,
        action,
        fieldName: field,
        oldValue,
        newValue,
        performedBy: input.userId ?? null,
      });
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: patch,
    });

    return { customer: updated, appliedFields: Object.keys(patch) };
  } catch (e: unknown) {
    if (e instanceof ApplyFieldSelectionError) {
      throw new CompanyIntelligenceError(e.message, e.code, 422);
    }
    throw e;
  }
}

export async function createCustomerFromCompanyIntelligence(input: {
  lookupId: string;
  overrides?: Record<string, unknown>;
  usePublicContactAsPrimary?: boolean;
  userId?: string | null;
}) {
  const lookup = await prisma.customerCnpjLookup.findUnique({ where: { id: input.lookupId } });
  if (!lookup) {
    throw new CompanyIntelligenceError("Consulta não encontrada.", "LOOKUP_NOT_FOUND", 404);
  }

  const summary = lookup.normalizedSummary as NormalizedCnpjSummary;
  const usePublicContact = input.usePublicContactAsPrimary ?? false;
  const draft = summaryToCustomerDraft(summary, { usePublicContactAsPrimary: usePublicContact });
  const body: Record<string, string> = {
    ...draft,
    ...(input.overrides as Record<string, string> | undefined),
  };
  body.taxId = normalizeCnpj(String(body.taxId ?? summary.cnpj));

  if (!usePublicContact) {
    body.phone = "";
    body.email = "";
    const note = buildPublicContactNote(summary);
    if (note) {
      body.notes = body.notes?.trim() ? `${body.notes.trim()}\n${note}` : note;
    }
  }

  const existing = await prisma.customer.findUnique({ where: { taxId: body.taxId } });
  if (existing) {
    throw new CompanyIntelligenceError(
      "Já existe cliente cadastrado com este CNPJ.",
      "DUPLICATE_TAX_ID",
      409
    );
  }

  const customer = await prisma.customer.create({
    data: {
      companyName: String(body.companyName ?? summary.companyName),
      tradeName: body.tradeName ? String(body.tradeName) : null,
      taxId: body.taxId,
      stateTaxId: body.stateTaxId ? String(body.stateTaxId) : null,
      email: body.email ? String(body.email) : null,
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      city: body.city ? String(body.city) : null,
      state: body.state ? String(body.state) : null,
      zipCode: body.zipCode ? String(body.zipCode) : null,
      country: body.country ? String(body.country) : "Brasil",
      segment: body.segment ? String(body.segment) : null,
      notes: body.notes ? String(body.notes) : null,
      status: "ACTIVE",
    },
  });

  await prisma.customerCnpjLookup.update({
    where: { id: lookup.id },
    data: { customerId: customer.id },
  });

  await writeCommercialAuditLog({
    entityType: "Customer",
    entityId: customer.id,
    action: "CNPJ_INTELLIGENCE_CREATE",
    newValue: customer.taxId,
    performedBy: input.userId ?? null,
  });

  if (usePublicContact && (summary.phone || summary.email)) {
    await writeCommercialAuditLog({
      entityType: "Customer",
      entityId: customer.id,
      action: "CNPJ_PUBLIC_CONTACT_APPLY",
      newValue: [summary.phone, summary.email].filter(Boolean).join(" / "),
      performedBy: input.userId ?? null,
    });
  } else if (buildPublicContactNote(summary)) {
    await writeCommercialAuditLog({
      entityType: "Customer",
      entityId: customer.id,
      action: "CNPJ_PUBLIC_CONTACT_SUGGESTED",
      newValue: buildPublicContactNote(summary),
      performedBy: input.userId ?? null,
    });
  }

  return { customer };
}

export async function getCustomerCompanyIntelligenceHistory(customerId: string, limit = 10) {
  return prisma.customerCnpjLookup.findMany({
    where: { customerId },
    orderBy: { fetchedAt: "desc" },
    take: limit,
    select: {
      id: true,
      cnpj: true,
      fetchedAt: true,
      expiresAt: true,
      riskScore: true,
      riskVerdict: true,
      source: true,
    },
  });
}
