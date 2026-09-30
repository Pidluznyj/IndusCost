/**
 * Cliente Escavador V2. Complementar, 1 retry em 429, sem token em log.
 */

import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  clampEscavadorMinRequestIntervalMs,
  escavadorConfigured,
  isEscavadorEnabled,
  LEGAL_EXPOSURE_ENV,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { normalizeProcessNumber, sanitizeErrorMessage } from "../../legalExposureNormalization.js";
import {
  clampEscavadorTimeoutMs,
  ESCAVADOR_DEFAULT_BASE,
  escavadorMovementsPath,
  escavadorProcessPath,
} from "./escavadorContracts.js";
import { mapEscavadorProcess, notConfiguredEscavadorBatch } from "./escavadorMapper.js";
import { getSharedEscavadorThrottle, type EscavadorThrottle } from "./escavadorThrottle.js";

export async function fetchEscavadorProcess(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  processNumber: string;
  throttle?: EscavadorThrottle;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isEscavadorEnabled(env) || !escavadorConfigured(env)) return notConfiguredEscavadorBatch();
  const normalized = normalizeProcessNumber(input.processNumber);
  if (!normalized) {
    return {
      source: "ESCAVADOR",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: "Escavador exige número CNJ.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const base = (env[LEGAL_EXPOSURE_ENV.escavadorBaseUrl]?.trim() || ESCAVADOR_DEFAULT_BASE).replace(/\/$/, "");
  const token = env[LEGAL_EXPOSURE_ENV.escavadorApiKey]?.trim() ?? "";
  const timeoutMs = clampEscavadorTimeoutMs(env[LEGAL_EXPOSURE_ENV.escavadorTimeoutMs]);
  const intervalMs = clampEscavadorMinRequestIntervalMs(env[LEGAL_EXPOSURE_ENV.escavadorMinRequestIntervalMs]);
  const throttle = input.throttle ?? getSharedEscavadorThrottle(intervalMs);
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = {
    accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  async function once(path: string) {
    const request = {
      fetchImpl,
      url: `${base}${path}`,
      path,
      timeoutMs,
      init: { method: "GET" as const, headers },
    };
    await throttle.waitBeforeRequest();
    let result = await legalExposureFetch(request);
    if (result.outcome === "RATE_LIMITED") {
      await throttle.waitAfterRateLimit(result.retryAfterSeconds);
      result = await legalExposureFetch(request);
      throttle.noteRequest();
    }
    return result;
  }

  const capa = await once(escavadorProcessPath(normalized));
  if (capa.outcome === "RATE_LIMITED") {
    return {
      source: "ESCAVADOR",
      outcome: "RATE_LIMITED",
      errorCode: "RATE_LIMITED",
      errorMessageSanitized: sanitizeErrorMessage(capa.errorMessageSanitized),
      retryAfterSeconds: capa.retryAfterSeconds,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  if (capa.outcome !== "SUCCESS") {
    return {
      source: "ESCAVADOR",
      outcome: capa.outcome,
      errorCode: capa.outcome,
      errorMessageSanitized: sanitizeErrorMessage(capa.errorMessageSanitized),
      retryAfterSeconds: capa.retryAfterSeconds,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const movements = await once(escavadorMovementsPath(normalized));
  const movementsBody = movements.outcome === "SUCCESS" ? movements.body : { items: [] };
  return mapEscavadorProcess(capa.body, movementsBody);
}
