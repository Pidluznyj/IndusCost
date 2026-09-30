/**
 * Termos de descoberta DJEN. Só razão social, nome fantasia e aliases cadastrados.
 * Sem variação automática, fuzzy ou apelido inventado.
 */

import type { LegalAliasType } from "./legalExposureContracts.js";
import { LEGAL_ALIAS_TYPES } from "./legalExposureContracts.js";
import { normalizeExposureCnpj, normalizeLegalName } from "./legalExposureNormalization.js";

export const TRUSTED_DISCOVERY_ALIAS_TYPES = ["LEGAL_NAME", "TRADE_NAME", "OLD_LEGAL_NAME"] as const;
export const GENERIC_DISCOVERY_ALIAS_TYPES = ["ABBREVIATION", "OTHER"] as const;

export type DjenDiscoveryTrust = "TRUSTED" | "GENERIC";

export type DjenDiscoveryTerm = {
  value: string;
  normalizedValue: string;
  origin: "LEGAL_NAME" | "TRADE_NAME" | "ALIAS";
  type: LegalAliasType;
  trust: DjenDiscoveryTrust;
};

export type DjenDiscoveryAliasInput = {
  type: LegalAliasType;
  value: string;
  active: boolean;
};

export function isLegalAliasType(value: string | null | undefined): value is LegalAliasType {
  return (LEGAL_ALIAS_TYPES as readonly string[]).includes(String(value ?? ""));
}

export function isTrustedDiscoveryAliasType(type: LegalAliasType): boolean {
  return (TRUSTED_DISCOVERY_ALIAS_TYPES as readonly string[]).includes(type);
}

function pushTerm(
  out: DjenDiscoveryTerm[],
  seen: Set<string>,
  value: string | null | undefined,
  origin: DjenDiscoveryTerm["origin"],
  type: LegalAliasType
): void {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return;
  const normalizedValue = normalizeLegalName(trimmed);
  if (!normalizedValue || seen.has(normalizedValue)) return;
  seen.add(normalizedValue);
  out.push({
    value: trimmed,
    normalizedValue,
    origin,
    type,
    trust: isTrustedDiscoveryAliasType(type) ? "TRUSTED" : "GENERIC",
  });
}

export function buildDjenDiscoveryTerms(input: {
  legalName: string;
  tradeName?: string | null;
  aliases?: readonly DjenDiscoveryAliasInput[];
}): DjenDiscoveryTerm[] {
  const seen = new Set<string>();
  const out: DjenDiscoveryTerm[] = [];
  pushTerm(out, seen, input.legalName, "LEGAL_NAME", "LEGAL_NAME");
  pushTerm(out, seen, input.tradeName, "TRADE_NAME", "TRADE_NAME");
  for (const alias of input.aliases ?? []) {
    if (!alias.active) continue;
    if (!isLegalAliasType(alias.type)) continue;
    pushTerm(out, seen, alias.value, "ALIAS", alias.type);
  }
  return out;
}

export function genericDiscoveryHasAdditionalEvidence(input: {
  explicitCnpj?: string | null;
  candidateName?: string | null;
  entityCnpj: string;
  entityLegalName: string;
  trustedAliasValues: readonly string[];
}): boolean {
  const cnpj = normalizeExposureCnpj(input.explicitCnpj);
  if (cnpj && cnpj === input.entityCnpj) return true;
  const candidate = normalizeLegalName(input.candidateName);
  if (!candidate) return false;
  if (candidate === normalizeLegalName(input.entityLegalName)) return true;
  return input.trustedAliasValues.some((alias) => normalizeLegalName(alias) === candidate);
}
