import { randomUUID } from "node:crypto";
import { paidQueryCodeFromProvider } from "@/src/lib/directData/classifyProviderResponse.js";
import { fetchBoaVistaDefineLimite, type BoaVistaProviderResult } from "./adapter.js";
import { isValidCnpj } from "./cnpj.js";
import { BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION, type LikeSerasaConfig } from "./config.js";
import type { DemoQueryDecision, LiveQueryDecision } from "./environmentGate.js";
import { buildBoaVistaDemoResponse } from "./fixtures.js";
import { likeSerasaHttpStatus, likeSerasaMessage, type LikeSerasaQueryCode } from "./messages.js";
import { parseBoaVistaDefineLimite, redactBoaVistaRawPayload, type ParsedBoaVistaDefineLimite } from "./parse.js";
import type { BoaVistaConsultationRecord, BoaVistaStore } from "./store.js";
import type { LikeSerasaPublicState } from "./view.js";

export { likeSerasaHttpStatus, likeSerasaMessage, type LikeSerasaQueryCode };

export type LikeSerasaQueryOutcome = {
  code: LikeSerasaQueryCode;
  charged: boolean;
  row: BoaVistaConsultationRecord | null;
  message?: string | null;
};

type CommonInput = {
  store: BoaVistaStore;
  config: LikeSerasaConfig;
  customerId: string;
  companyName: string;
  cnpj: string;
  consent: boolean;
  idempotencyKey: string;
  userId: string;
  role: string;
  forceRefresh?: boolean;
  now?: Date;
};

function documentGate(input: CommonInput): LikeSerasaQueryOutcome | null {
  if (input.consent !== true) return { code: "CONSENT_REQUIRED", charged: false, row: null };
  if (/^\d{11}$/.test(input.cnpj)) return { code: "NOT_LEGAL_ENTITY", charged: false, row: null };
  if (!/^\d{14}$/.test(input.cnpj) || !isValidCnpj(input.cnpj)) return { code: "INVALID_CNPJ", charged: false, row: null };
  return null;
}

/**
 * Consulta REAL (paga). Ordem das barreiras: gate de ambiente (fail-closed, antes de qualquer reserva) → consentimento →
 * documento PJ válido → reserva (idempotência, em andamento, cobrança desconhecida, cache) → envio único → persistência.
 * Nunca repete automaticamente uma chamada potencialmente cobrada.
 */
export async function executeLiveLikeSerasaConsultation(
  input: CommonInput & { liveDecision: LiveQueryDecision; fetchImpl?: typeof fetch }
): Promise<LikeSerasaQueryOutcome> {
  const now = input.now ?? new Date();
  if (!input.liveDecision.allowed) return { code: "ENVIRONMENT_BLOCKED", charged: false, row: null };
  const blocked = documentGate(input);
  if (blocked) return blocked;
  const reserved = await input.store.reserve({
    customerId: input.customerId,
    companyName: input.companyName,
    cnpj: input.cnpj,
    mode: "LIVE",
    idempotencyKey: input.idempotencyKey,
    requestedByUserId: input.userId,
    requestedByRole: input.role,
    authorizedCostCents: input.config.unitPriceCents,
    now,
    forceRefresh: input.forceRefresh === true,
    minRefreshIntervalMs: input.config.minRefreshIntervalMs,
  });
  if (reserved.ok === false) {
    if (reserved.code === "IDEMPOTENT") return { code: "OK", charged: false, row: reserved.row };
    return {
      code: reserved.code,
      charged: false,
      row: reserved.code === "CACHE_VALID" ? await input.store.findLatestSucceeded(input.customerId, "LIVE") : null,
      message: reserved.code === "CACHE_VALID" ? null : undefined,
    };
  }
  await input.store.markSent(reserved.row.id);
  const provider = await fetchBoaVistaDefineLimite({ cnpj: input.cnpj, config: input.config, fetchImpl: input.fetchImpl });
  return finishProviderCall(input.store, input.config, reserved.row, provider, now);
}

/**
 * Consulta de DEMONSTRAÇÃO: fixture sintética, sem rede, sem cobrança. Só quando o gate de demonstração permite
 * (nunca em produção). Gravada com mode=DEMO e billingStatus=NOT_APPLICABLE; nunca satisfaz o cache da consulta real.
 */
export async function executeDemoLikeSerasaConsultation(
  input: CommonInput & { demoDecision: DemoQueryDecision; variant?: "restricted" | "clear" | "partial" }
): Promise<LikeSerasaQueryOutcome> {
  const now = input.now ?? new Date();
  if (!input.demoDecision.allowed) return { code: "DEMO_BLOCKED", charged: false, row: null };
  const blocked = documentGate(input);
  if (blocked) return blocked;
  const reserved = await input.store.reserve({
    customerId: input.customerId,
    companyName: input.companyName,
    cnpj: input.cnpj,
    mode: "DEMO",
    idempotencyKey: input.idempotencyKey,
    requestedByUserId: input.userId,
    requestedByRole: input.role,
    authorizedCostCents: 0,
    now,
    forceRefresh: input.forceRefresh === true,
    minRefreshIntervalMs: input.config.minRefreshIntervalMs,
  });
  if (reserved.ok === false) {
    if (reserved.code === "IDEMPOTENT") return { code: "OK", charged: false, row: reserved.row };
    return { code: reserved.code, charged: false, row: reserved.code === "CACHE_VALID" ? await input.store.findLatestSucceeded(input.customerId, "DEMO") : null };
  }
  const body = buildBoaVistaDemoResponse({ cnpj: input.cnpj, companyName: `${input.companyName} (SIMULADO)`, now, variant: input.variant });
  const parsed = parseBoaVistaDefineLimite(body);
  try {
    await input.store.complete(reserved.row.id, {
      ...successPatch(parsed, now, input.config.cacheTtlMs),
      status: parsed.partial || parsed.insufficient ? "PARTIAL" : "SUCCEEDED",
      billingStatus: "NOT_APPLICABLE",
      chargedCostCents: 0,
      providerHttpStatus: null,
      providerResult: "Simulado",
      providerQueryId: parsed.sections.providerMeta.queryId ?? `demo-${randomUUID()}`,
      rawPayload: null,
      receiptUrl: null,
    });
  } catch {
    return { code: "PERSISTENCE_FAILED", charged: false, row: reserved.row };
  }
  return { code: parsed.partial || parsed.insufficient ? "PARTIAL" : "OK", charged: false, row: await input.store.findById(reserved.row.id) };
}

function successPatch(parsed: ParsedBoaVistaDefineLimite, now: Date, cacheTtlMs: number): Partial<BoaVistaConsultationRecord> {
  return {
    scoreRaw: parsed.scoreRaw,
    score: parsed.score,
    scoreClass: parsed.scoreClass,
    riskText: parsed.riskText,
    defaultProbability: parsed.defaultProbability,
    suggestedLimitCents: parsed.suggestedLimitCents,
    suggestedLimitLabel: parsed.suggestedLimitLabel,
    restrictionCount: parsed.restrictionCount,
    confirmedRestriction: parsed.confirmedRestriction,
    insufficient: parsed.insufficient || parsed.partial,
    sections: parsed.sections,
    parserVersion: BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION,
    consultedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + cacheTtlMs).toISOString(),
  };
}

async function finishProviderCall(
  store: BoaVistaStore,
  config: LikeSerasaConfig,
  row: BoaVistaConsultationRecord,
  provider: BoaVistaProviderResult,
  now: Date
): Promise<LikeSerasaQueryOutcome> {
  const mapped = paidQueryCodeFromProvider(provider);
  if (mapped.persist !== "success") {
    await store.complete(row.id, {
      status: mapped.persist === "failed_not_sent" ? "FAILED" : "UNKNOWN_BILLING",
      billingStatus: mapped.persist === "failed_not_sent" ? "NOT_SENT" : "UNKNOWN",
      providerHttpStatus: provider.status,
      providerResult: provider.resultado,
      failureCode: mapped.code,
    });
    return { code: mapped.code as LikeSerasaQueryCode, charged: false, row: await store.findById(row.id), message: provider.mensagem };
  }
  const parsed = parseBoaVistaDefineLimite(provider.body);
  const raw = config.storeRawPayload ? redactBoaVistaRawPayload(provider.body) : null;
  // A URL do comprovante fica só na coluna própria (servida por rota autenticada), nunca dentro das seções do relatório.
  const receiptUrl = parsed.sections.providerMeta.receiptUrl;
  parsed.sections.providerMeta.receiptUrl = null;
  if (parsed.insufficient) {
    try {
      await store.complete(row.id, {
        status: "PARTIAL",
        billingStatus: "UNKNOWN",
        providerHttpStatus: provider.status,
        providerResult: provider.resultado,
        providerQueryId: parsed.sections.providerMeta.queryId,
        failureCode: "PARTIAL",
        insufficient: true,
        sections: parsed.sections,
        rawPayload: raw,
        parserVersion: BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION,
        receiptUrl,
      });
    } catch {
      return { code: "PERSISTENCE_FAILED", charged: false, row };
    }
    return { code: "PARTIAL", charged: false, row: await store.findById(row.id), message: provider.mensagem };
  }
  const billed = provider.charge === "yes";
  const status = parsed.partial ? "PARTIAL" : "SUCCEEDED";
  try {
    await store.complete(row.id, {
      ...successPatch(parsed, now, config.cacheTtlMs),
      status,
      // Retorno parcial com cobrança oficial "Sucesso": a cobrança é estimada; sem resultado oficial, indeterminada.
      billingStatus: billed ? "ESTIMATED" : parsed.partial ? "UNKNOWN" : "NOT_SENT",
      chargedCostCents: billed ? row.authorizedCostCents : parsed.partial ? null : 0,
      providerHttpStatus: provider.status,
      providerResult: provider.resultado,
      providerQueryId: parsed.sections.providerMeta.queryId,
      failureCode: parsed.partial ? "PARTIAL" : null,
      rawPayload: raw,
      receiptUrl,
    });
  } catch {
    try {
      await store.complete(row.id, { status: "UNKNOWN_BILLING", billingStatus: "UNKNOWN", failureCode: "PERSISTENCE_FAILED" });
    } catch {
      return { code: "PERSISTENCE_FAILED", charged: false, row };
    }
    return { code: "PERSISTENCE_FAILED", charged: false, row: await store.findById(row.id) };
  }
  return { code: parsed.partial ? "PARTIAL" : "OK", charged: billed, row: await store.findById(row.id), message: parsed.partial ? provider.mensagem : undefined };
}

export function publicLikeSerasaStatus(row: BoaVistaConsultationRecord | null, now: Date): { state: LikeSerasaPublicState } {
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
    };
  }
  const fresh = row.validUntil != null && Date.parse(row.validUntil) > now.getTime();
  return { state: fresh ? "VALID" : "STALE" };
}
