/**
 * client_credentials + On-behalf-Of.
 * Token só em memória. Nunca logar segredo, Authorization ou CPF completo.
 */

import { LEGAL_EXPOSURE_ENV, type LegalExposureEnv } from "../../legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../../legalExposureHttp.js";
import { sanitizeErrorMessage } from "../../legalExposureNormalization.js";
import type { DomicilioTokenResponse } from "./domicilioContracts.js";

type CacheEntry = { accessToken: string; expiresAtMs: number };
let tokenCache: CacheEntry | null = null;

export function clearDomicilioTokenCacheForTests(): void {
  tokenCache = null;
}

function readSecret(env: LegalExposureEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

export async function fetchDomicilioAccessToken(input: {
  env: LegalExposureEnv;
  fetchImpl: typeof fetch;
  now?: number;
}): Promise<{ ok: true; token: DomicilioTokenResponse } | { ok: false; errorMessageSanitized: string }> {
  const now = input.now ?? Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 15_000) {
    return {
      ok: true,
      token: {
        accessToken: tokenCache.accessToken,
        expiresInSeconds: Math.round((tokenCache.expiresAtMs - now) / 1000),
      },
    };
  }

  const tokenUrl = readSecret(input.env, LEGAL_EXPOSURE_ENV.domicilioTokenUrl);
  const clientId = readSecret(input.env, LEGAL_EXPOSURE_ENV.domicilioClientId);
  const clientSecret = readSecret(input.env, LEGAL_EXPOSURE_ENV.domicilioClientSecret);
  const onBehalfOf = readSecret(input.env, LEGAL_EXPOSURE_ENV.domicilioOnBehalfOf);
  if (!tokenUrl || !clientId || !clientSecret || !onBehalfOf) {
    return { ok: false, errorMessageSanitized: "Domicílio não configurado." };
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const result = await legalExposureFetch({
    fetchImpl: input.fetchImpl,
    url: tokenUrl,
    path: "/token",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "On-behalf-Of": onBehalfOf,
      },
      body,
    },
  });
  if (result.outcome !== "SUCCESS" || !result.body || typeof result.body !== "object") {
    return {
      ok: false,
      errorMessageSanitized: result.errorMessageSanitized ?? "Falha ao obter token.",
    };
  }
  const record = result.body as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 300;
  if (!accessToken) {
    return { ok: false, errorMessageSanitized: sanitizeErrorMessage("Token ausente na resposta.") };
  }
  tokenCache = { accessToken, expiresAtMs: now + expiresIn * 1000 };
  return { ok: true, token: { accessToken, expiresInSeconds: expiresIn } };
}
