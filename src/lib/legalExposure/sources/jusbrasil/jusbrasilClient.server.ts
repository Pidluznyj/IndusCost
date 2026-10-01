/**
 * Cliente Jusbrasil Soluções (consulta única tribproc). Complementar, fail-closed, 1 retry em 429.
 */

import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import {
  clampJusbrasilMinRequestIntervalMs,
  isJusbrasilEnabled,
  jusbrasilConfigured,
  LEGAL_EXPOSURE_ENV,
  type LegalExposureEnv,
} from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { normalizeProcessNumber, sanitizeErrorMessage } from "../../legalExposureNormalization.js";
import { createEscavadorThrottle, type EscavadorThrottle } from "../escavador/escavadorThrottle.js";
import {
  clampJusbrasilTimeoutMs,
  JUSBRASIL_DEFAULT_BASE,
  jusbrasilProcessPath,
} from "./jusbrasilContracts.js";
import { mapJusbrasilProcess, notConfiguredJusbrasilBatch } from "./jusbrasilMapper.js";

export async function fetchJusbrasilProcess(input: {
  env?: LegalExposureEnv;
  fetchImpl?: typeof fetch;
  processNumber: string;
  throttle?: EscavadorThrottle;
}): Promise<NormalizedSourceBatch> {
  const env = input.env ?? process.env;
  if (!isJusbrasilEnabled(env) || !jusbrasilConfigured(env)) return notConfiguredJusbrasilBatch();
  const normalized = normalizeProcessNumber(input.processNumber);
  if (!normalized) {
    return {
      source: "JUSBRASIL",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: "Jusbrasil exige número CNJ.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const base = (env[LEGAL_EXPOSURE_ENV.jusbrasilBaseUrl]?.trim() || JUSBRASIL_DEFAULT_BASE).replace(/\/$/, "");
  const token = env[LEGAL_EXPOSURE_ENV.jusbrasilApiKey]?.trim() ?? "";
  const timeoutMs = clampJusbrasilTimeoutMs(env[LEGAL_EXPOSURE_ENV.jusbrasilTimeoutMs]);
  const intervalMs = clampJusbrasilMinRequestIntervalMs(env[LEGAL_EXPOSURE_ENV.jusbrasilMinRequestIntervalMs]);
  const throttle = input.throttle ?? createEscavadorThrottle({ intervalMs });
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = {
    fetchImpl,
    url: `${base}${jusbrasilProcessPath(normalized)}?tipo_numero=5`,
    path: jusbrasilProcessPath(normalized),
    timeoutMs,
    init: {
      method: "GET" as const,
      headers: { accept: "application/json", Authorization: `Bearer ${token}` },
    },
  };
  await throttle.waitBeforeRequest();
  let result = await legalExposureFetch(request);
  if (result.outcome === "RATE_LIMITED") {
    await throttle.waitAfterRateLimit(result.retryAfterSeconds);
    result = await legalExposureFetch(request);
    throttle.noteRequest();
  }
  if (result.outcome !== "SUCCESS") {
    return {
      source: "JUSBRASIL",
      outcome: result.outcome,
      errorCode: result.outcome,
      errorMessageSanitized: sanitizeErrorMessage(result.errorMessageSanitized),
      retryAfterSeconds: result.retryAfterSeconds,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  return mapJusbrasilProcess(result.body);
}
