/**
 * Score CNPJ no grid de Clientes — regras PURAS (browser-safe).
 *
 * O grid mostra, por cliente, a ÚLTIMA consulta persistida em
 * `CustomerCnpjLookup` (score + veredito calculados na consulta pelo motor
 * `calculateCommercialRiskScore`). Nada é recalculado aqui: este módulo só
 * escolhe a consulta mais recente por cliente e formata a tag.
 *
 * Identidade da consulta → cliente:
 *  1. `customerId` gravado na consulta (vínculo explícito);
 *  2. senão, CNPJ normalizado igual ao `taxId` normalizado do cliente
 *     (consulta feita pelo campo livre "Consultar CNPJ" antes do vínculo).
 * Nunca por nome. Cliente sem consulta → `null` (a tag mostra "Sem consulta",
 * nunca um score inventado).
 */

import type { CommercialRiskVerdict } from "./companyCommercialRiskScore.js";
import { normalizeCnpj } from "./companyCnpjFormat.js";

export type CustomerCnpjRiskSummary = {
  lookupId: string;
  score: number;
  verdict: CommercialRiskVerdict | string;
  riskLevel: string | null;
  saleRecommendation: string | null;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  /** Consulta vencida pelo TTL (24h) — continua exibida, sinalizada como antiga. */
  expired: boolean;
};

export type CustomerCnpjLookupRow = {
  id: string;
  cnpj: string;
  customerId: string | null;
  source: string;
  riskScore: number;
  riskVerdict: string;
  riskDetails: unknown;
  fetchedAt: Date | string;
  expiresAt: Date | string;
};

export type CustomerIdentityForRisk = { id: string; taxId: string | null | undefined };

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function readDetail(details: unknown, key: "riskLevel" | "saleRecommendation"): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function buildCustomerCnpjRiskSummary(
  row: CustomerCnpjLookupRow,
  now: Date = new Date()
): CustomerCnpjRiskSummary {
  return {
    lookupId: row.id,
    score: row.riskScore,
    verdict: row.riskVerdict,
    riskLevel: readDetail(row.riskDetails, "riskLevel"),
    saleRecommendation: readDetail(row.riskDetails, "saleRecommendation"),
    source: row.source,
    fetchedAt: toIso(row.fetchedAt),
    expiresAt: toIso(row.expiresAt),
    expired: toTime(row.expiresAt) < now.getTime(),
  };
}

function isNewer(candidate: CustomerCnpjLookupRow, current: CustomerCnpjLookupRow | undefined): boolean {
  if (!current) return true;
  const byDate = toTime(candidate.fetchedAt) - toTime(current.fetchedAt);
  if (byDate !== 0) return byDate > 0;
  return candidate.id > current.id;
}

/**
 * Última consulta por cliente. Vínculo explícito (`customerId`) tem
 * precedência sobre o CNPJ; dentro do mesmo vínculo vence a mais recente.
 */
export function pickLatestCustomerCnpjLookups(
  customers: readonly CustomerIdentityForRisk[],
  lookups: readonly CustomerCnpjLookupRow[],
  now: Date = new Date()
): Map<string, CustomerCnpjRiskSummary> {
  const byCustomerId = new Map<string, CustomerCnpjLookupRow>();
  const byCnpj = new Map<string, CustomerCnpjLookupRow>();
  for (const row of lookups) {
    if (row.customerId) {
      if (isNewer(row, byCustomerId.get(row.customerId))) byCustomerId.set(row.customerId, row);
    }
    const cnpj = normalizeCnpj(row.cnpj);
    if (cnpj && isNewer(row, byCnpj.get(cnpj))) byCnpj.set(cnpj, row);
  }

  const result = new Map<string, CustomerCnpjRiskSummary>();
  for (const customer of customers) {
    const linked = byCustomerId.get(customer.id);
    const cnpj = normalizeCnpj(customer.taxId);
    const sameCnpj = cnpj ? byCnpj.get(cnpj) : undefined;
    const chosen = linked ?? sameCnpj;
    if (chosen) result.set(customer.id, buildCustomerCnpjRiskSummary(chosen, now));
  }
  return result;
}

export function normalizeCustomerTaxIdsForLookup(customers: readonly CustomerIdentityForRisk[]): string[] {
  return [...new Set(customers.map((c) => normalizeCnpj(c.taxId)).filter((v) => v.length === 14))];
}

/* ------------------------------------------------------------------ *
 * Apresentação da tag (sem recalcular nada)
 * ------------------------------------------------------------------ */

export type CustomerCnpjRiskTone = "blocked" | "advance" | "conditional" | "released" | "unknown";

/** Mesma semântica de cores do painel Consulta CNPJ (CustomerCnpjIntelligencePanel). */
export function customerCnpjRiskTone(verdict: string | null | undefined): CustomerCnpjRiskTone {
  switch ((verdict ?? "").trim().toUpperCase()) {
    case "VENDA BLOQUEADA":
      return "blocked";
    case "APENAS PAGAMENTO ANTECIPADO":
      return "advance";
    case "VENDA CONDICIONADA":
      return "conditional";
    case "VENDA LIBERADA":
      return "released";
    default:
      return "unknown";
  }
}

export const CUSTOMER_CNPJ_RISK_NO_LOOKUP_LABEL = "Sem consulta";

export function formatCustomerCnpjRiskTagLabel(risk: CustomerCnpjRiskSummary): string {
  return `${risk.score} · ${risk.verdict}`;
}

function formatDateTimePtBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

export function formatCustomerCnpjRiskTooltip(risk: CustomerCnpjRiskSummary): string {
  const parts = [`Score ${risk.score}/100 · ${risk.verdict}`];
  if (risk.riskLevel || risk.saleRecommendation) {
    parts.push(`Risco: ${risk.riskLevel ?? "—"}${risk.saleRecommendation ? ` — ${risk.saleRecommendation}` : ""}`);
  }
  parts.push(`Consulta: ${formatDateTimePtBr(risk.fetchedAt)} · Fonte: ${risk.source}`);
  if (risk.expired) parts.push("Consulta vencida (TTL 24h) — clique em Consulta CNPJ para atualizar.");
  return parts.join("\n");
}
