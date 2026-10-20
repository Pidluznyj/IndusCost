import { fetchQuodDossier, type QuodProviderResult } from "./adapter.js";
import { quodBudgetMonthWindow, type QuodDossierConfig } from "./config.js";
import { parseQuodDossier, quodPartnerPreview } from "./parse.js";
import type { QuodConsultationRecord, QuodStore } from "./store.js";

export type QuodQueryCode =
  | "DISABLED"
  | "TOKEN_MISSING"
  | "CONSENT_REQUIRED"
  | "INVALID_CNPJ"
  | "CACHE_VALID"
  | "BUDGET"
  | "INTERVAL"
  | "IN_FLIGHT"
  | "UNKNOWN_BILLING"
  | "AUTH"
  | "RATE_LIMIT"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "PARTIAL"
  | "PERSISTENCE_FAILED"
  | "OK";

export type QuodQueryOutcome = {
  code: QuodQueryCode;
  charged: boolean;
  row: QuodConsultationRecord | null;
};

export async function executePaidQuodConsultation(input: {
  store: QuodStore;
  config: QuodDossierConfig;
  customerId: string;
  companyName: string;
  cnpj: string;
  consent: boolean;
  idempotencyKey: string;
  userId: string;
  role: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<QuodQueryOutcome> {
  const now = input.now ?? new Date();
  if (!input.config.enabled) return { code: "DISABLED", charged: false, row: null };
  if (!input.config.token) return { code: "TOKEN_MISSING", charged: false, row: null };
  if (input.consent !== true) return { code: "CONSENT_REQUIRED", charged: false, row: null };
  if (!/^\d{14}$/.test(input.cnpj)) return { code: "INVALID_CNPJ", charged: false, row: null };
  const month = quodBudgetMonthWindow(now);
  const reserved = await input.store.reserve({
    customerId: input.customerId,
    companyName: input.companyName,
    cnpj: input.cnpj,
    idempotencyKey: input.idempotencyKey,
    requestedByUserId: input.userId,
    requestedByRole: input.role,
    authorizedCostCents: input.config.unitPriceCents,
    now,
    monthlyLimitCents: input.config.monthlyLimitCents,
    monthStart: month.start,
    monthEnd: month.end,
    maxPerCnpj: input.config.maxPerCnpj,
    intervalStart: new Date(now.getTime() - input.config.cnpjIntervalMs),
    forceRefresh: false,
    cacheTtlMs: input.config.cacheTtlMs,
  });
  if (reserved.ok === false) {
    if (reserved.code === "IDEMPOTENT") return { code: "OK", charged: false, row: reserved.row };
    return { code: reserved.code, charged: false, row: null };
  }
  await input.store.markSent(reserved.row.id);
  const provider = await fetchQuodDossier({ cnpj: input.cnpj, config: input.config, fetchImpl: input.fetchImpl });
  return finishProviderCall(input.store, reserved.row, provider, now, input.config.cacheTtlMs);
}

async function finishProviderCall(
  store: QuodStore,
  row: QuodConsultationRecord,
  provider: QuodProviderResult,
  now: Date,
  cacheTtlMs: number
): Promise<QuodQueryOutcome> {
  if (provider.outcome === "AUTH") {
    await store.complete(row.id, { status: "FAILED", billingStatus: "NOT_SENT", providerHttpStatus: provider.status, failureCode: "AUTH" });
    return { code: "AUTH", charged: false, row: await store.findById(row.id) };
  }
  if (provider.outcome !== "SUCCESS") {
    const code = provider.outcome === "TIMEOUT" ? "TIMEOUT" : provider.outcome === "RATE_LIMIT" ? "RATE_LIMIT" : provider.outcome === "NETWORK" ? "NETWORK" : "HTTP_ERROR";
    await store.complete(row.id, {
      status: "UNKNOWN_BILLING",
      billingStatus: "UNKNOWN",
      providerHttpStatus: "status" in provider ? provider.status : null,
      failureCode: code,
    });
    return { code, charged: false, row: await store.findById(row.id) };
  }
  const parsed = parseQuodDossier(provider.body);
  if (parsed.partial || parsed.insufficient) {
    try {
      await store.complete(row.id, {
        status: "PARTIAL",
        billingStatus: "UNKNOWN",
        providerHttpStatus: provider.status,
        providerQueryId: parsed.sections.providerQueryId,
        failureCode: "PARTIAL",
        insufficient: true,
      });
    } catch {
      return { code: "PERSISTENCE_FAILED", charged: false, row };
    }
    return { code: "PARTIAL", charged: false, row: await store.findById(row.id) };
  }
  try {
    await store.complete(row.id, {
      status: "SUCCEEDED",
      billingStatus: "ESTIMATED",
      chargedCostCents: row.authorizedCostCents,
      providerHttpStatus: provider.status,
      providerQueryId: parsed.sections.providerQueryId,
      score: parsed.score,
      restrictionCount: parsed.restrictionCount,
      confirmedRestriction: parsed.confirmedRestriction,
      insufficient: false,
      sections: parsed.sections,
      partners: quodPartnerPreview(provider.body),
      consultedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + cacheTtlMs).toISOString(),
    });
  } catch {
    try {
      await store.complete(row.id, { status: "UNKNOWN_BILLING", billingStatus: "UNKNOWN", failureCode: "PERSISTENCE_FAILED" });
    } catch {
      return { code: "PERSISTENCE_FAILED", charged: false, row };
    }
    return { code: "PERSISTENCE_FAILED", charged: false, row: await store.findById(row.id) };
  }
  return { code: "OK", charged: true, row: await store.findById(row.id) };
}

export function publicQuodStatus(row: QuodConsultationRecord | null, now: Date) {
  if (!row || row.status !== "SUCCEEDED") {
    return { state: row?.status === "SENT" || row?.status === "RESERVED" ? "IN_PROGRESS" : row?.status === "PARTIAL" ? "PARTIAL" : row?.status === "FAILED" || row?.status === "UNKNOWN_BILLING" ? "FAILED" : "NOT_CONSULTED" } as const;
  }
  const fresh = row.validUntil != null && Date.parse(row.validUntil) > now.getTime();
  return { state: fresh ? "VALID" : "STALE" } as const;
}
