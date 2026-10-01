/**
 * Correlação pura.
 * Ordem: número CNJ, CNPJ explícito, identificador oficial, razão social exata,
 * alias exato. Semelhança nominal nunca confirma.
 */

import type { LegalEvidenceConfidence } from "./legalExposureContracts.js";
import { canonicalProcessKey, normalizeLegalName } from "./legalExposureNormalization.js";

export type CorrelationMethod =
  | "PROCESS_NUMBER"
  | "CNPJ"
  | "OFFICIAL_ID"
  | "EXACT_NAME"
  | "EXACT_ALIAS"
  | "FUZZY"
  | "NONE";

export type CorrelationDecision = {
  confidence: LegalEvidenceConfidence;
  method: CorrelationMethod;
  matchedCaseId: string | null;
};

export type CorrelationInput = {
  processNumberNormalized: string | null;
  explicitCnpj: string | null;
  entityCnpj: string;
  officialIdentifier: string | null;
  candidateName: string | null;
  entityLegalName: string;
  aliases: readonly string[];
  existingCases: readonly { id: string; processNumberNormalized: string }[];
  knownOfficialIds: readonly { officialIdentifier: string; caseId: string }[];
};

function tokens(value: string): string[] {
  return normalizeLegalName(value).split(" ").filter((token) => token.length > 1);
}

function jaccard(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function correlateObservation(input: CorrelationInput): CorrelationDecision {
  if (input.processNumberNormalized) {
    const existing = input.existingCases.find((row) => {
      const canon = canonicalProcessKey(row.processNumberNormalized, row.id);
      return canon.ok && canon.key === input.processNumberNormalized;
    });
    return {
      confidence: "CONFIRMED",
      method: "PROCESS_NUMBER",
      matchedCaseId: existing?.id ?? null,
    };
  }

  if (input.explicitCnpj && input.explicitCnpj === input.entityCnpj) {
    return { confidence: "CONFIRMED", method: "CNPJ", matchedCaseId: null };
  }

  if (input.officialIdentifier) {
    const known = input.knownOfficialIds.find(
      (row) => row.officialIdentifier === input.officialIdentifier
    );
    if (known) {
      return { confidence: "CONFIRMED", method: "OFFICIAL_ID", matchedCaseId: known.caseId };
    }
  }

  const candidate = normalizeLegalName(input.candidateName);
  if (!candidate) return { confidence: "REJECTED", method: "NONE", matchedCaseId: null };

  if (candidate === normalizeLegalName(input.entityLegalName)) {
    return { confidence: "LIKELY", method: "EXACT_NAME", matchedCaseId: null };
  }

  const aliasHit = input.aliases.some((alias) => normalizeLegalName(alias) === candidate);
  if (aliasHit) {
    return { confidence: "LIKELY", method: "EXACT_ALIAS", matchedCaseId: null };
  }

  const names = [input.entityLegalName, ...input.aliases];
  const fuzzy = names.some((name) => {
    const normalized = normalizeLegalName(name);
    if (!normalized || normalized === candidate) return false;
    return jaccard(candidate, normalized) >= 0.8;
  });
  if (fuzzy) {
    return { confidence: "UNCONFIRMED", method: "FUZZY", matchedCaseId: null };
  }

  return { confidence: "REJECTED", method: "NONE", matchedCaseId: null };
}
