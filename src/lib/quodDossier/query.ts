import { paidQueryCodeFromProvider } from "@/src/lib/directData/classifyProviderResponse.js";
import { fetchQuodDossier, type QuodProviderResult } from "./adapter.js";
import type { QuodDossierConfig } from "./config.js";
import { parseQuodDossier, quodPartnerPreview } from "./parse.js";
import type { QuodConsultationRecord, QuodStore } from "./store.js";

export type QuodQueryCode =
  | "DISABLED"
  | "TOKEN_MISSING"
  | "CONSENT_REQUIRED"
  | "INVALID_CNPJ"
  | "CACHE_VALID"
  | "IN_FLIGHT"
  | "UNKNOWN_BILLING"
  | "INSUFFICIENT_BALANCE"
  | "AUTH"
  | "UNAVAILABLE"
  | "RATE_LIMIT"
  | "INVALID_INPUT"
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
  message?: string | null;
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
  forceRefresh?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<QuodQueryOutcome> {
  const now = input.now ?? new Date();
  if (!input.config.enabled) return { code: "DISABLED", charged: false, row: null };
  if (!input.config.token) return { code: "TOKEN_MISSING", charged: false, row: null };
  if (input.consent !== true) return { code: "CONSENT_REQUIRED", charged: false, row: null };
  if (!/^\d{14}$/.test(input.cnpj)) return { code: "INVALID_CNPJ", charged: false, row: null };
  const reserved = await input.store.reserve({
    customerId: input.customerId,
    companyName: input.companyName,
    cnpj: input.cnpj,
    idempotencyKey: input.idempotencyKey,
    requestedByUserId: input.userId,
    requestedByRole: input.role,
    authorizedCostCents: input.config.unitPriceCents,
    now,
    forceRefresh: input.forceRefresh === true,
  });
  if (reserved.ok === false) {
    if (reserved.code === "IDEMPOTENT") return { code: "OK", charged: false, row: reserved.row };
    return {
      code: reserved.code,
      charged: false,
      row: reserved.code === "CACHE_VALID" ? await input.store.findLatestSucceeded(input.customerId) : null,
      message: reserved.code === "CACHE_VALID" ? null : undefined,
    };
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
  const mapped = paidQueryCodeFromProvider(provider);
  if (mapped.persist !== "success") {
    await store.complete(row.id, {
      status: mapped.persist === "failed_not_sent" ? "FAILED" : "UNKNOWN_BILLING",
      billingStatus: mapped.persist === "failed_not_sent" ? "NOT_SENT" : "UNKNOWN",
      providerHttpStatus: provider.status,
      failureCode: mapped.code,
    });
    return {
      code: mapped.code,
      charged: false,
      row: await store.findById(row.id),
      message: provider.mensagem,
    };
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
    return { code: "PARTIAL", charged: false, row: await store.findById(row.id), message: provider.mensagem };
  }
  const billed = provider.charge === "yes";
  try {
    await store.complete(row.id, {
      status: "SUCCEEDED",
      billingStatus: billed ? "ESTIMATED" : "NOT_SENT",
      chargedCostCents: billed ? row.authorizedCostCents : 0,
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
  return { code: "OK", charged: billed, row: await store.findById(row.id) };
}

export function publicQuodStatus(row: QuodConsultationRecord | null, now: Date) {
  if (!row || row.status !== "SUCCEEDED") {
    return {
      state:
        row?.status === "SENT" || row?.status === "RESERVED"
          ? "IN_PROGRESS"
          : row?.status === "PARTIAL"
            ? "PARTIAL"
            : row?.status === "UNKNOWN_BILLING"
              ? "UNKNOWN_BILLING"
              : row?.status === "FAILED"
                ? "FAILED"
                : "NOT_CONSULTED",
    } as const;
  }
  const fresh = row.validUntil != null && Date.parse(row.validUntil) > now.getTime();
  return { state: fresh ? "VALID" : "STALE" } as const;
}
