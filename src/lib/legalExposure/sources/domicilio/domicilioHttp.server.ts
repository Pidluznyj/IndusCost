/**
 * Saída HTTP do Domicílio. Tudo passa por aqui:
 * allowlist de operação (método + caminho), allowlist de host, redirecionamento
 * recusado, intervalo mínimo por conta e nova tentativa limitada com backoff.
 * Nenhuma URL devolvida no payload é seguida.
 */

import { legalExposureFetch, type LegalHttpResult } from "../../legalExposureHttp.js";
import { isAllowedDomicilioUrl } from "./domicilioAccounts.js";
import { DOMICILIO_ALLOWED_OPERATIONS, type DomicilioOperationName } from "./domicilioContracts.js";

export const DOMICILIO_FORBIDDEN_OPERATION = "DOMICILIO_OPERATION_NOT_ALLOWED";
export const DOMICILIO_FORBIDDEN_HOST = "DOMICILIO_HOST_NOT_ALLOWED";

const MAX_TRANSIENT_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
/** Acima disso o Retry-After não é esperado dentro da execução: devolve RATE_LIMITED. */
const MAX_RETRY_AFTER_WAIT_SECONDS = 30;

export type DomicilioHttpDeps = {
  fetchImpl: typeof fetch;
  minRequestIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const lastRequestAtByAccount = new Map<string, number>();

export function clearDomicilioThrottleForTests(): void {
  lastRequestAtByAccount.clear();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertDomicilioOperationAllowed(input: {
  operation: DomicilioOperationName;
  method: string;
  url: string;
  tokenUrl: string;
  baseUrl: string;
}): void {
  const operation = DOMICILIO_ALLOWED_OPERATIONS.find((row) => row.name === input.operation);
  if (!operation || operation.method !== input.method.toUpperCase()) {
    throw new Error(DOMICILIO_FORBIDDEN_OPERATION);
  }
  if (!isAllowedDomicilioUrl(input.url)) throw new Error(DOMICILIO_FORBIDDEN_HOST);
  const target = new URL(input.url);
  const expected = new URL(operation.path == null ? input.tokenUrl : `${input.baseUrl}${operation.path}`);
  if (target.origin !== expected.origin || target.pathname !== expected.pathname) {
    throw new Error(DOMICILIO_FORBIDDEN_OPERATION);
  }
  // O token não leva query string; a listagem só leva os filtros montados pelo cliente.
  if (operation.path == null && target.search) throw new Error(DOMICILIO_FORBIDDEN_OPERATION);
}

async function throttle(deps: DomicilioHttpDeps, accountKey: string): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const last = lastRequestAtByAccount.get(accountKey);
  if (last != null) {
    const wait = last + deps.minRequestIntervalMs - now();
    if (wait > 0) await sleep(wait);
  }
  lastRequestAtByAccount.set(accountKey, now());
}

export async function domicilioRequest(input: {
  deps: DomicilioHttpDeps;
  accountKey: string;
  operation: DomicilioOperationName;
  url: string;
  tokenUrl: string;
  baseUrl: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: URLSearchParams;
}): Promise<LegalHttpResult> {
  assertDomicilioOperationAllowed(input);
  const sleep = input.deps.sleep ?? defaultSleep;
  const random = input.deps.random ?? Math.random;
  const path = new URL(input.url).pathname;
  let waitedRetryAfter = false;

  for (let attempt = 0; ; attempt += 1) {
    await throttle(input.deps, input.accountKey);
    const result = await legalExposureFetch({
      fetchImpl: input.deps.fetchImpl,
      url: input.url,
      path,
      init: {
        method: input.method,
        headers: input.headers,
        body: input.body,
        // 3xx vira erro: o Domicílio não redireciona estas operações e não seguimos URL alheia.
        redirect: "error",
      },
    });
    if (result.outcome === "RATE_LIMITED") {
      const wait = result.retryAfterSeconds;
      if (!waitedRetryAfter && wait != null && wait <= MAX_RETRY_AFTER_WAIT_SECONDS) {
        waitedRetryAfter = true;
        await sleep(wait * 1000);
        continue;
      }
      return result;
    }
    const transient = result.outcome === "TIMEOUT" || result.outcome === "SOURCE_ERROR";
    if (transient && attempt < MAX_TRANSIENT_RETRIES) {
      await sleep(BACKOFF_BASE_MS * 2 ** attempt + Math.floor(random() * BACKOFF_BASE_MS));
      continue;
    }
    return result;
  }
}
