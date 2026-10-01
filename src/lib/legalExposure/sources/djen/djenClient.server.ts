import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import { LEGAL_EXPOSURE_ENV, djenBaseUrl, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import {
  DJEN_DEFAULT_PAGE_SIZE,
  DJEN_EMPTY_QUERY_MESSAGE,
  clampDjenMaxPages,
  clampDjenMinRequestIntervalMs,
  djenHasNextPage,
  hasDjenSearchFilter,
  type DjenSearchQuery,
} from "./djenContracts.js";
import { mapDjenPublicationPage, mapDjenPublications } from "./djenMapper.js";
import { getSharedDjenThrottle, type DjenThrottle } from "./djenThrottle.js";

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
  const pagination = {
    totalReported:
      pages.reduce((max, page) => Math.max(max, page.pagination?.totalReported ?? 0), 0) ||
      pages[0]?.pagination?.totalReported ||
      null,
    pagesFetched: pages.reduce((sum, page) => sum + (page.pagination?.pagesFetched ?? 1), 0),
    itemsFetched: pages.reduce((sum, page) => sum + (page.pagination?.itemsFetched ?? page.communications.length + page.cases.length), 0),
    truncated: pages.some((page) => page.pagination?.truncated),
  };
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
      pagination,
    };
  }
  if (hardFailure && !hadResults) return { ...hardFailure, pagination };
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
      pagination,
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
    pagination,
  };
}

export async function searchDjen(input: {
  env: LegalExposureEnv;
  fetchImpl: typeof fetch;
  query: DjenSearchQuery;
  throttle?: DjenThrottle;
}): Promise<NormalizedSourceBatch> {
  if (!hasDjenSearchFilter(input.query)) return emptyQueryBatch();
  const base = djenBaseUrl(input.env);
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
  const intervalMs = clampDjenMinRequestIntervalMs(
    input.env[LEGAL_EXPOSURE_ENV.djenMinRequestIntervalMs]
  );
  const throttle = input.throttle ?? getSharedDjenThrottle(intervalMs);
  const startPage = input.query.pagina ?? 1;
  const pages: NormalizedSourceBatch[] = [];
  const path = "/api/v1/comunicacao";
  let lastTotal: number | null = null;
  let itemsFetched = 0;
  let truncated = false;

  async function fetchPage(pagina: number) {
    const params = new URLSearchParams();
    if (input.query.nomeParte) params.set("nomeParte", input.query.nomeParte);
    if (input.query.numeroProcesso) params.set("numeroProcesso", input.query.numeroProcesso);
    params.set("pagina", String(pagina));
    params.set("itensPorPagina", String(itensPorPagina));
    const url = `${base}${path}?${params.toString()}`;
    await throttle.waitBeforeRequest();
    let result = await legalExposureFetch({
      fetchImpl: input.fetchImpl,
      url,
      path,
      init: { method: "GET" },
    });
    if (result.outcome === "RATE_LIMITED") {
      await throttle.waitAfterRateLimit(result.retryAfterSeconds);
      result = await legalExposureFetch({
        fetchImpl: input.fetchImpl,
        url,
        path,
        init: { method: "GET" },
      });
      throttle.noteRequest();
    }
    return result;
  }

  for (let offset = 0; offset < maxPages; offset += 1) {
    const pagina = startPage + offset;
    const result = await fetchPage(pagina);
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
    lastTotal = mapped.totalCount;
    itemsFetched += mapped.itemCount;
    mapped.batch.pagination = {
      totalReported: mapped.totalCount,
      pagesFetched: 1,
      itemsFetched: mapped.itemCount,
      truncated: false,
    };
    pages.push(mapped.batch);
    const hasNext = djenHasNextPage({
      pagina,
      itensPorPagina,
      itemCount: mapped.itemCount,
      totalCount: mapped.totalCount,
    });
    if (!hasNext) break;
    if (offset === maxPages - 1) truncated = true;
  }

  const merged = mergeDjenPages(pages);
  merged.pagination = {
    totalReported: lastTotal,
    pagesFetched: pages.length,
    itemsFetched,
    truncated,
  };
  return merged;
}

export { mapDjenPublications };
