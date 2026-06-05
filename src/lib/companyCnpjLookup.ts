import { prisma } from "@/src/lib/prisma.js";
import { isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";
import {
  normalizePublicCnpjPayload,
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
  type CustomerCompareResult,
} from "./companyCnpjCompare.js";
import { writeCommercialAuditLog } from "./commercialAuditLog.js";

export class CompanyIntelligenceError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = "CompanyIntelligenceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const CNPJ_LOOKUP_SOURCE = "publica.cnpj.ws";
export const CNPJ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CompanyIntelligencePayload = {
  lookupId: string;
  cnpj: string;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  fromCache: boolean;
  customerId: string | null;
  summary: NormalizedCnpjSummary;
  risk: CommercialRiskResult;
  commercial: ReturnType<typeof buildCommercialInsightsBundle>;
  comparison: CustomerCompareResult | null;
  customerDraft: Record<string, string> | null;
  filledFieldCount: number;
  rawJson: unknown;
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchImpl(`https://publica.cnpj.ws/cnpj/${digits}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      throw new CompanyIntelligenceError("CNPJ não encontrado na base pública.", "CNPJ_NOT_FOUND", 404);
    }
    if (res.status === 429) {
      throw new CompanyIntelligenceError(
        "Limite de consultas da API pública atingido. Tente novamente em alguns minutos.",
        "RATE_LIMIT",
        429
      );
    }
    if (!res.ok) {
      throw new CompanyIntelligenceError(
        `Falha na consulta pública (HTTP ${res.status}).`,
        "UPSTREAM_ERROR",
        502
      );
    }
    const json = await res.json();
    if (!json || typeof json !== "object") {
      throw new CompanyIntelligenceError("Resposta inesperada da API pública.", "INVALID_PAYLOAD", 502);
    }
    return json;
  } catch (e: unknown) {
    if (e instanceof CompanyIntelligenceError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new CompanyIntelligenceError("Tempo esgotado na consulta pública.", "TIMEOUT", 504);
    }
    throw new CompanyIntelligenceError(
      "Serviço de consulta CNPJ indisponível no momento.",
      "UPSTREAM_UNAVAILABLE",
      502
    );
  } finally {
    clearTimeout(timer);
  }
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
}): Omit<CompanyIntelligencePayload, "comparison" | "customerDraft" | "filledFieldCount"> & {
  summary: NormalizedCnpjSummary;
  risk: CommercialRiskResult;
  commercial: ReturnType<typeof buildCommercialInsightsBundle>;
} {
  const summary = row.normalizedSummary as NormalizedCnpjSummary;
  const risk = row.riskDetails as CommercialRiskResult;
  const commercial = row.commercialInsights as ReturnType<typeof buildCommercialInsightsBundle>;
  return {
    lookupId: row.id,
    cnpj: row.cnpj,
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    fromCache: true,
    customerId: row.customerId,
    summary,
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

  if (!row) {
    const rawJson = await fetchPublicCnpj(cnpj, input.fetchImpl);
    const summary = normalizePublicCnpjPayload(rawJson);
    const risk = calculateCommercialRiskScore(summary);
    const commercial = buildCommercialInsightsBundle(summary, risk, sellerUfFromEnv());
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CNPJ_CACHE_TTL_MS);

    row = await prisma.customerCnpjLookup.create({
      data: {
        cnpj,
        customerId: input.customerId ?? null,
        source: CNPJ_LOOKUP_SOURCE,
        rawJson: rawJson as object,
        normalizedSummary: summary as object,
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
      newValue: cnpj,
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
  } else {
    customerDraft = summaryToCustomerDraft(base.summary);
  }

  const { countFilledJsonFields } = await import("./companyCnpjFormat.js");

  return {
    ...base,
    fromCache,
    comparison,
    customerDraft,
    filledFieldCount: countFilledJsonFields(base.rawJson),
  };
}

export async function applyCompanyIntelligenceToCustomer(input: {
  customerId: string;
  lookupId: string;
  selectedFields: string[];
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
  const patch = buildApplyPatch(customer, summary, input.selectedFields);
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
    await writeCommercialAuditLog({
      entityType: "Customer",
      entityId: customer.id,
      action: "CNPJ_INTELLIGENCE_APPLY",
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
}

export async function createCustomerFromCompanyIntelligence(input: {
  lookupId: string;
  overrides?: Record<string, unknown>;
  userId?: string | null;
}) {
  const lookup = await prisma.customerCnpjLookup.findUnique({ where: { id: input.lookupId } });
  if (!lookup) {
    throw new CompanyIntelligenceError("Consulta não encontrada.", "LOOKUP_NOT_FOUND", 404);
  }

  const summary = lookup.normalizedSummary as NormalizedCnpjSummary;
  const draft = summaryToCustomerDraft(summary);
  const body: Record<string, string> = { ...draft, ...(input.overrides as Record<string, string> | undefined) };
  body.taxId = normalizeCnpj(String(body.taxId ?? summary.cnpj));

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
