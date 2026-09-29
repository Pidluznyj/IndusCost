/**
 * Sync read-only do Domicílio. Janela sobreposta de 2 dias.
 * Não chama a fonte quando a flag está desligada.
 */

import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  domicilioConfigured,
  isDomicilioEnabled,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";
import { domicilioListWindow } from "./domicilioContracts.js";
import { listDomicilioCommunications } from "./domicilioMonitoringClient.server.js";

export function disabledDomicilioBatch(): NormalizedSourceBatch {
  return {
    source: "DOMICILIO",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: "Domicílio desligado ou não configurado.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export async function runDomicilioSync(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  numeroProcesso?: string;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isDomicilioEnabled(env) || !domicilioConfigured(env)) return disabledDomicilioBatch();
  const now = input.now ?? new Date();
  const window = domicilioListWindow(now);
  return listDomicilioCommunications(
    { env, fetchImpl: input.fetchImpl ?? fetch },
    { ...window, numeroProcesso: input.numeroProcesso, page: 0, size: 50 }
  );
}
