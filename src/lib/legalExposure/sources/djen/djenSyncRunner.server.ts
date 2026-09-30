import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  djenConfigured,
  isDjenEnabled,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";
import { searchDjen } from "./djenClient.server.js";
import { DJEN_EMPTY_QUERY_MESSAGE, hasDjenSearchFilter } from "./djenContracts.js";

function disabled(): NormalizedSourceBatch {
  return {
    source: "DJEN",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: "DJEN desligado ou não configurado.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export async function runDjenSync(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  nomeParte?: string;
  numeroProcesso?: string;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isDjenEnabled(env) || !djenConfigured(env)) return disabled();
  if (!hasDjenSearchFilter(input)) {
    return {
      source: "DJEN",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: DJEN_EMPTY_QUERY_MESSAGE,
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  return searchDjen({
    env,
    fetchImpl: input.fetchImpl ?? fetch,
    query: {
      nomeParte: input.nomeParte,
      numeroProcesso: input.numeroProcesso,
    },
  });
}
