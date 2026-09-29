import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  datajudConfigured,
  isDatajudCnpjDiscoveryEnabled,
  isDatajudEnabled,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";
import { discoverDatajudByCnpj, searchDatajudByProcessNumber } from "./datajudClient.server.js";

function disabled(): NormalizedSourceBatch {
  return {
    source: "DATAJUD",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: "DataJud desligado ou não configurado.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export async function runDatajudSync(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  mode: "known-process" | "cnpj-discovery";
  tribunalAlias?: string;
  processNumber?: string;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (input.mode === "cnpj-discovery") {
    return discoverDatajudByCnpj();
  }
  if (!isDatajudEnabled(env) || !datajudConfigured(env)) return disabled();
  if (isDatajudCnpjDiscoveryEnabled(env) && input.mode !== "known-process") {
    return discoverDatajudByCnpj();
  }
  return searchDatajudByProcessNumber({
    env,
    fetchImpl: input.fetchImpl ?? fetch,
    tribunalAlias: input.tribunalAlias ?? "",
    processNumber: input.processNumber ?? "",
  });
}
