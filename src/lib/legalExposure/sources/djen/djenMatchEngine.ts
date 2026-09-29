/** DJEN: número do processo precede o nome. Fuzzy não confirma. */

import { correlateObservation, type CorrelationDecision } from "../../legalExposureCorrelation.js";
import { normalizeExposureCnpj, normalizeProcessNumber } from "../../legalExposureNormalization.js";

export function matchDjenHit(input: {
  processNumber: string | null;
  explicitCnpj: string | null;
  candidateName: string | null;
  officialIdentifier: string | null;
  entityCnpj: string;
  entityLegalName: string;
  aliases: readonly string[];
  existingCases: readonly { id: string; processNumberNormalized: string }[];
  knownOfficialIds: readonly { officialIdentifier: string; caseId: string }[];
}): CorrelationDecision {
  return correlateObservation({
    processNumberNormalized: normalizeProcessNumber(input.processNumber),
    explicitCnpj: normalizeExposureCnpj(input.explicitCnpj),
    entityCnpj: input.entityCnpj,
    officialIdentifier: input.officialIdentifier,
    candidateName: input.candidateName,
    entityLegalName: input.entityLegalName,
    aliases: input.aliases,
    existingCases: input.existingCases,
    knownOfficialIds: input.knownOfficialIds,
  });
}
