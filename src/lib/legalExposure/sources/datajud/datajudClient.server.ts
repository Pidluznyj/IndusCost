/**
 * Cliente DataJud para processo já conhecido.
 * Descoberta por CNPJ não monta query e não chama a rede.
 */

import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { LEGAL_EXPOSURE_ENV, datajudBaseUrl, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { normalizeProcessNumber, sanitizeErrorMessage } from "../../legalExposureNormalization.js";
import {
  assertDatajudCnpjDiscoveryBlocked,
  buildDatajudProcessQuery,
  clampDatajudMinRequestIntervalMs,
  DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON,
  DATAJUD_HTTP_TIMEOUT_MS,
} from "./datajudContracts.js";
import { mapDatajudSearch } from "./datajudMapper.js";
import { getSharedDatajudThrottle, type DatajudThrottle } from "./datajudThrottle.js";

function blockedDiscovery(): NormalizedSourceBatch {
  return {
    source: "DATAJUD",
    outcome: "CONFIGURATION_ERROR",
    errorCode: DATAJUD_CNPJ_DISCOVERY_BLOCK_REASON,
    errorMessageSanitized: "Descoberta DataJud por CNPJ aguarda probe do payload real.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export async function searchDatajudByProcessNumber(input: {
  env: LegalExposureEnv;
  fetchImpl: typeof fetch;
  tribunalAlias: string;
  processNumber: string;
  throttle?: DatajudThrottle;
}): Promise<NormalizedSourceBatch> {
  const normalized = normalizeProcessNumber(input.processNumber);
  const base = datajudBaseUrl(input.env);
  const apiKey = input.env[LEGAL_EXPOSURE_ENV.datajudApiKey]?.trim() ?? "";
  if (!normalized || !base || !apiKey || !input.tribunalAlias.trim()) {
    return {
      source: "DATAJUD",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: "DataJud sem processo, tribunal ou configuração.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const path = `/api_publica_${input.tribunalAlias.trim().toLowerCase()}/_search`;
  const intervalMs = clampDatajudMinRequestIntervalMs(
    input.env[LEGAL_EXPOSURE_ENV.datajudMinRequestIntervalMs]
  );
  const throttle = input.throttle ?? getSharedDatajudThrottle(intervalMs);
  const request = {
    fetchImpl: input.fetchImpl,
    url: `${base}${path}`,
    path,
    timeoutMs: DATAJUD_HTTP_TIMEOUT_MS,
    init: {
      method: "POST" as const,
      headers: {
        "content-type": "application/json",
        Authorization: `APIKey ${apiKey}`,
      },
      body: JSON.stringify(buildDatajudProcessQuery(normalized)),
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
      source: "DATAJUD",
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
  return mapDatajudSearch(result.body);
}

export function discoverDatajudByCnpj(): NormalizedSourceBatch {
  try {
    assertDatajudCnpjDiscoveryBlocked();
  } catch {
    return blockedDiscovery();
  }
}
