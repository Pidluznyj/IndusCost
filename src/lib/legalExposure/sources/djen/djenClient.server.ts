import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { LEGAL_EXPOSURE_ENV, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import {
  DJEN_DEFAULT_PAGE_SIZE,
  DJEN_EMPTY_QUERY_MESSAGE,
  clampDjenMaxPages,
  djenHasNextPage,
  hasDjenSearchFilter,
  type DjenSearchQuery,
} from "./djenContracts.js";
import { mapDjenPublicationPage, mapDjenPublications } from "./djenMapper.js";

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

function mergeDjenPages(pages: NormalizedSourceBatch[]): NormalizedSourceBatch {
  if (pages.length === 0) {
    return {
      source: "DJEN",
      outcome: "NO_RESULTS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const cases = pages.flatMap((page) => page.cases);
  const candidates = pages.flatMap((page) => page.candidates);
  const communications = pages.flatMap((page) => page.communications);
  const last = pages[pages.length - 1]!;
  const hadResults = cases.length + candidates.length + communications.length > 0;
  const hardFailure = pages.find(
    (page) =>
      page.outcome !== "SUCCESS" &&
      page.outcome !== "NO_RESULTS" &&
      page.outcome !== "PARTIAL"
  );
  if (hardFailure && hadResults && hardFailure.outcome === "RATE_LIMITED") {
    return {
      source: "DJEN",
      outcome: "PARTIAL",
      errorCode: "RATE_LIMITED",
      errorMessageSanitized: hardFailure.errorMessageSanitized,
      retryAfterSeconds: hardFailure.retryAfterSeconds,
      externalCall: true,
      cases,
      communications,
      candidates,
    };
  }
  if (hardFailure && !hadResults) return hardFailure;
  if (hardFailure && hadResults) {
    return {
      source: "DJEN",
      outcome: "PARTIAL",
      errorCode: hardFailure.errorCode,
      errorMessageSanitized: hardFailure.errorMessageSanitized,
      retryAfterSeconds: hardFailure.retryAfterSeconds,
      externalCall: true,
      cases,
      communications,
      candidates,
    };
  }
  return {
    source: "DJEN",
    outcome: hadResults ? "SUCCESS" : "NO_RESULTS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: pages.some((page) => page.externalCall),
    cases,
    communications,
    candidates,
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
  const itensPorPagina = input.query.itensPorPagina ?? DJEN_DEFAULT_PAGE_SIZE;
  const maxPages = clampDjenMaxPages(input.env[LEGAL_EXPOSURE_ENV.djenMaxPages]);
  const startPage = input.query.pagina ?? 1;
  const pages: NormalizedSourceBatch[] = [];
  const path = "/api/v1/comunicacao";

  for (let offset = 0; offset < maxPages; offset += 1) {
    const pagina = startPage + offset;
    const params = new URLSearchParams();
    if (input.query.nomeParte) params.set("nomeParte", input.query.nomeParte);
    if (input.query.numeroProcesso) params.set("numeroProcesso", input.query.numeroProcesso);
    params.set("pagina", String(pagina));
    params.set("itensPorPagina", String(itensPorPagina));
    const result = await legalExposureFetch({
      fetchImpl: input.fetchImpl,
      url: `${base}${path}?${params.toString()}`,
      path,
      init: { method: "GET" },
    });
    if (result.outcome !== "SUCCESS") {
      pages.push({
        source: "DJEN",
        outcome: result.outcome,
        errorCode: result.outcome,
        errorMessageSanitized: result.errorMessageSanitized,
        retryAfterSeconds: result.retryAfterSeconds,
        externalCall: true,
        cases: [],
        communications: [],
        candidates: [],
      });
      break;
    }
    const mapped = mapDjenPublicationPage(result.body);
    pages.push(mapped.batch);
    if (
      !djenHasNextPage({
        pagina,
        itensPorPagina,
        itemCount: mapped.itemCount,
        totalCount: mapped.totalCount,
      })
    ) {
      break;
    }
  }

  return mergeDjenPages(pages);
}

export { mapDjenPublications };
