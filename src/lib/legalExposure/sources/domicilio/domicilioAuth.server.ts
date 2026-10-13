/**
 * client_credentials no SSO do PJe, um token por conta institucional.
 * Token só em memória, isolado por conta. Nunca logar segredo, Authorization ou CPF.
 */

import { sanitizeErrorMessage } from "../../legalExposureNormalization.js";
import type { DomicilioAccount, DomicilioEndpoints } from "./domicilioAccounts.js";
import type { DomicilioTokenResponse } from "./domicilioContracts.js";
import { domicilioRequest, type DomicilioHttpDeps } from "./domicilioHttp.server.js";

type CacheEntry = { accessToken: string; expiresAtMs: number };
type TokenResult = { ok: true; token: DomicilioTokenResponse } | { ok: false; errorMessageSanitized: string };

const TOKEN_SAFETY_MARGIN_MS = 15_000;
const tokenCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TokenResult>>();

/** Trocar o client_id (rotação) não reaproveita o token antigo. */
function cacheKey(account: DomicilioAccount): string {
  return `${account.key}:${account.clientId}`;
}

export function clearDomicilioTokenCacheForTests(): void {
  tokenCache.clear();
  inFlight.clear();
}

/** Token recusado pela API (expirado ou revogado): a próxima chamada autentica de novo. */
export function invalidateDomicilioToken(account: DomicilioAccount): void {
  tokenCache.delete(cacheKey(account));
}

async function requestToken(input: {
  account: DomicilioAccount;
  endpoints: DomicilioEndpoints;
  deps: DomicilioHttpDeps;
  now: number;
}): Promise<TokenResult> {
  const result = await domicilioRequest({
    deps: input.deps,
    accountKey: input.account.key,
    operation: "fetchAccessToken",
    url: input.endpoints.tokenUrl,
    tokenUrl: input.endpoints.tokenUrl,
    baseUrl: input.endpoints.baseUrl,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "On-behalf-Of": input.account.onBehalfOf,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: input.account.clientId,
      client_secret: input.account.clientSecret,
    }),
  });
  if (result.outcome !== "SUCCESS" || !result.body || typeof result.body !== "object") {
    return {
      ok: false,
      errorMessageSanitized: result.errorMessageSanitized ?? "Falha ao obter token.",
    };
  }
  const record = result.body as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const expiresIn = typeof record.expires_in === "number" && record.expires_in > 0 ? record.expires_in : 300;
  if (!accessToken) {
    return { ok: false, errorMessageSanitized: sanitizeErrorMessage("Token ausente na resposta.") };
  }
  tokenCache.set(cacheKey(input.account), { accessToken, expiresAtMs: input.now + expiresIn * 1000 });
  return { ok: true, token: { accessToken, expiresInSeconds: expiresIn } };
}

export async function fetchDomicilioAccessToken(input: {
  account: DomicilioAccount;
  endpoints: DomicilioEndpoints;
  deps: DomicilioHttpDeps;
}): Promise<TokenResult> {
  const now = (input.deps.now ?? Date.now)();
  const key = cacheKey(input.account);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > now + TOKEN_SAFETY_MARGIN_MS) {
    return {
      ok: true,
      token: {
        accessToken: cached.accessToken,
        expiresInSeconds: Math.round((cached.expiresAtMs - now) / 1000),
      },
    };
  }
  // Chamadas simultâneas da mesma conta esperam a mesma renovação.
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = requestToken({ ...input, now }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
