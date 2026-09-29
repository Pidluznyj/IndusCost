/**
 * Cliente read-only do Domicílio.
 * Não há operação de ciência, inteiro teor ou marcação de leitura.
 */

import { LEGAL_EXPOSURE_ENV, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { fetchDomicilioAccessToken } from "./domicilioAuth.server.js";
import type { DomicilioCommunicationQuery } from "./domicilioContracts.js";
import { mapDomicilioCommunicationList, mapDomicilioInstitution } from "./domicilioMapper.js";
import type { NormalizedSourceBatch } from "../../legalExposureContracts.js";
import type { DomicilioInstitution } from "./domicilioContracts.js";

export type DomicilioClientDeps = {
  env: LegalExposureEnv;
  fetchImpl: typeof fetch;
};

function baseUrl(env: LegalExposureEnv): string {
  return env[LEGAL_EXPOSURE_ENV.domicilioBaseUrl]?.trim().replace(/\/$/, "") ?? "";
}

export async function fetchDomicilioInstitution(
  deps: DomicilioClientDeps
): Promise<{ ok: true; institution: DomicilioInstitution } | { ok: false; errorMessageSanitized: string }> {
  const path = deps.env[LEGAL_EXPOSURE_ENV.domicilioIdentityPath]?.trim() ?? "";
  const root = baseUrl(deps.env);
  if (!root || !path) return { ok: false, errorMessageSanitized: "Domicílio não configurado." };
  const token = await fetchDomicilioAccessToken(deps);
  if (token.ok === false) return { ok: false, errorMessageSanitized: token.errorMessageSanitized };
  const result = await legalExposureFetch({
    fetchImpl: deps.fetchImpl,
    url: `${root}${path.startsWith("/") ? path : `/${path}`}`,
    path,
    init: { method: "GET", headers: { Authorization: `Bearer ${token.token.accessToken}` } },
  });
  if (result.outcome !== "SUCCESS") {
    return { ok: false, errorMessageSanitized: result.errorMessageSanitized ?? "Falha na identificação." };
  }
  const institution = mapDomicilioInstitution(result.body);
  if (!institution) return { ok: false, errorMessageSanitized: "Identificação da instituição incompleta." };
  return { ok: true, institution };
}

export async function listDomicilioCommunications(
  deps: DomicilioClientDeps,
  query: DomicilioCommunicationQuery
): Promise<NormalizedSourceBatch> {
  const path = deps.env[LEGAL_EXPOSURE_ENV.domicilioCommunicationsPath]?.trim() ?? "";
  const root = baseUrl(deps.env);
  if (!root || !path) {
    return {
      source: "DOMICILIO",
      outcome: "CONFIGURATION_ERROR",
      errorCode: "CONFIGURATION_ERROR",
      errorMessageSanitized: "Domicílio não configurado.",
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const token = await fetchDomicilioAccessToken(deps);
  if (token.ok === false) {
    return {
      source: "DOMICILIO",
      outcome: "AUTH_ERROR",
      errorCode: "AUTH_ERROR",
      errorMessageSanitized: token.errorMessageSanitized,
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const result = await legalExposureFetch({
    fetchImpl: deps.fetchImpl,
    url: `${root}${suffix}?${params.toString()}`,
    path: suffix,
    init: { method: "GET", headers: { Authorization: `Bearer ${token.token.accessToken}` } },
  });
  if (result.outcome === "RATE_LIMITED") {
    return {
      source: "DOMICILIO",
      outcome: "RATE_LIMITED",
      errorCode: "RATE_LIMITED",
      errorMessageSanitized: result.errorMessageSanitized,
      retryAfterSeconds: result.retryAfterSeconds,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  if (result.outcome !== "SUCCESS") {
    return {
      source: "DOMICILIO",
      outcome: result.outcome,
      errorCode: result.outcome,
      errorMessageSanitized: result.errorMessageSanitized,
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const mapped = mapDomicilioCommunicationList(result.body);
  return { ...mapped, externalCall: true };
}
