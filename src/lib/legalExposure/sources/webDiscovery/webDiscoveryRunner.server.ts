/**
 * Localizador web. Não consulta Google Search e não confirma polo/parte/valor.
 */

import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  isWebDiscoveryEnabled,
  webDiscoveryConfigured,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";

export async function runWebDiscoveryLocator(input: {
  env?: LegalExposureEnv;
  processNumber: string;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isWebDiscoveryEnabled(env) || !webDiscoveryConfigured(env)) {
    return {
      source: "WEB_DISCOVERY",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "NOT_CONFIGURED",
      errorMessageSanitized:
        "Localizador web desligado. Não usa Google Search; exige provedor de busca contratado.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  return {
    source: "WEB_DISCOVERY",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "LOCATOR_ONLY",
    errorMessageSanitized:
      "Provedor de busca contratado não mapeado. Snippet de busca não confirma polo, reclamante nem valor.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}
