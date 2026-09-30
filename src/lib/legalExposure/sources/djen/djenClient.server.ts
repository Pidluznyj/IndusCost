import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { LEGAL_EXPOSURE_ENV, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { DJEN_EMPTY_QUERY_MESSAGE, hasDjenSearchFilter, type DjenSearchQuery } from "./djenContracts.js";
import { mapDjenPublications } from "./djenMapper.js";

function emptyQueryBatch(): NormalizedSourceBatch {
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

export async function searchDjen(input: {
  env: LegalExposureEnv;
  fetchImpl: typeof fetch;
  query: DjenSearchQuery;
}): Promise<NormalizedSourceBatch> {
  if (!hasDjenSearchFilter(input.query)) return emptyQueryBatch();
  const base = input.env[LEGAL_EXPOSURE_ENV.djenBaseUrl]?.trim().replace(/\/$/, "") ?? "";
  if (!base) {
    return {
      source: "DJEN",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: "DJEN não configurado.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const params = new URLSearchParams();
  if (input.query.nomeParte) params.set("nomeParte", input.query.nomeParte);
  if (input.query.numeroProcesso) params.set("numeroProcesso", input.query.numeroProcesso);
  params.set("pagina", String(input.query.pagina ?? 1));
  params.set("itensPorPagina", String(input.query.itensPorPagina ?? 20));
  const path = "/api/v1/comunicacao";
  const result = await legalExposureFetch({
    fetchImpl: input.fetchImpl,
    url: `${base}${path}?${params.toString()}`,
    path,
    init: { method: "GET" },
  });
  if (result.outcome !== "SUCCESS") {
    return {
      source: "DJEN",
      outcome: result.outcome,
      errorCode: result.outcome,
      errorMessageSanitized: result.errorMessageSanitized,
      retryAfterSeconds: result.retryAfterSeconds,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  return mapDjenPublications(result.body);
}
