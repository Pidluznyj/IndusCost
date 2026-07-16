/** Cliente HTTP mínimo para APIs REST Nomus — sem logar credenciais. */

import { createHash } from "node:crypto";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

/**
 * Qualquer nome de variável/header contendo estes termos é mascarado por completo.
 * Garante que NOMUS_AUTH, NOMUS_TOKEN, *_KEY, *_SECRET, *_PASSWORD, *_VALUE nunca vazem.
 */
const SENSITIVE_NAME_PATTERN = /(AUTH|TOKEN|KEY|SECRET|PASSWORD|VALUE)/i;

export const NOMUS_REDACTED_PLACEHOLDER = "<redigido>";

export function isSensitiveLogKey(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) || SENSITIVE_NAME_PATTERN.test(name);
}

/**
 * Resumo seguro de uma credencial: presença, comprimento, prefixo e hash curto.
 * Nunca expõe o valor real.
 */
export function describeNomusCredential(value: string | undefined | null): {
  present: boolean;
  length: number;
  startsWithBasic: boolean;
  hash12: string | null;
} {
  const trimmed = (value ?? "").trim();
  return {
    present: trimmed.length > 0,
    length: trimmed.length,
    startsWithBasic: trimmed.startsWith("Basic "),
    hash12: trimmed ? createHash("sha256").update(trimmed).digest("hex").slice(0, 12) : null,
  };
}

/** Remove tokens/credenciais de um texto de erro antes de logar. */
export function sanitizeNomusErrorBody(body: string, maxLength = 300): string {
  return body
    .replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1 <redigido>")
    .slice(0, maxLength);
}

export function buildNomusHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const customHeaderName = (env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) {
    headers[customHeaderName] = customHeaderValue;
  }

  return headers;
}

/** Monta URL sem duplicar `/rest/rest` quando NOMUS_BASE_URL já termina em `/rest/`. */
export function buildNomusUrl(baseUrl: string, resource: string, query?: Record<string, string>): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  const url = new URL(normalizedResource, normalizedBase);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

export function redactNomusUrlForLog(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return `${parsed.origin}${parsed.pathname}${parsed.search ? "?…" : ""}`;
}

export function redactHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = isSensitiveLogKey(key) ? NOMUS_REDACTED_PLACEHOLDER : value;
  }
  return redacted;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchNomusJsonOptions = {
  maxRetries?: number;
  retryBaseMs?: number;
  logPrefix?: string;
  /** Timeout por tentativa (ms). `0` desliga. Default: `NOMUS_HTTP_TIMEOUT_MS` ou sem timeout. */
  timeoutMs?: number;
  /** Injetável em testes (ex.: sleep mock). */
  sleepFn?: (ms: number) => Promise<void>;
};

function resolveNomusHttpTimeoutMs(optionsTimeout?: number): number {
  if (optionsTimeout != null && Number.isFinite(optionsTimeout)) {
    return Math.max(0, Math.trunc(optionsTimeout));
  }
  const fromEnv = Number.parseInt((process.env.NOMUS_HTTP_TIMEOUT_MS ?? "").trim(), 10);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 0;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export async function fetchNomusJson(
  url: URL,
  options: FetchNomusJsonOptions = {}
): Promise<unknown> {
  const envMaxRetries = Number.parseInt((process.env.NOMUS_MAX_RETRIES ?? "").trim(), 10);
  const maxRetries =
    options.maxRetries ?? (Number.isFinite(envMaxRetries) && envMaxRetries >= 0 ? envMaxRetries : 10);
  const envRetryBase = Number.parseInt((process.env.NOMUS_RETRY_BASE_MS ?? "").trim(), 10);
  const retryBaseMs =
    options.retryBaseMs ??
    (Number.isFinite(envRetryBase) && envRetryBase >= 0 ? envRetryBase : 700);
  const logPrefix = options.logPrefix ?? "[nomus]";
  const timeoutMs = resolveNomusHttpTimeoutMs(options.timeoutMs);
  const sleepFn = options.sleepFn ?? sleep;
  const headers = buildNomusHeaders();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timer =
      controller != null
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller?.signal,
      });
      if (res.ok) return res.json();

      const body = await res.text().catch(() => "");
      if (res.status === 429 && attempt < maxRetries) {
        let waitMs: number | null = null;
        try {
          const parsed = JSON.parse(body) as { tempoAteLiberar?: unknown };
          const tempo = Number(parsed?.tempoAteLiberar);
          // Margem adicional de 1s sobre tempoAteLiberar (segundos).
          if (Number.isFinite(tempo) && tempo > 0) waitMs = tempo * 1000 + 1000;
        } catch {
          waitMs = null;
        }
        if (waitMs == null) {
          const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
          waitMs =
            Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? retryAfterSec * 1000 + 1000
              : retryBaseMs * Math.pow(2, attempt);
        }
        console.warn(
          `${logPrefix} rate limit 429 em ${redactNomusUrlForLog(url)}; aguardando ${(waitMs / 1000).toFixed(0)}s.`
        );
        await sleepFn(waitMs);
        continue;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxRetries) {
        const safeBody = sanitizeNomusErrorBody(body);
        throw new Error(
          `Falha HTTP ${res.status} em ${redactNomusUrlForLog(url)}: ${safeBody || "(sem corpo)"}`
        );
      }
      await sleepFn(retryBaseMs * Math.pow(2, attempt));
    } catch (error) {
      if (isAbortError(error)) {
        if (attempt < maxRetries) {
          console.warn(
            `${logPrefix} timeout após ${timeoutMs}ms em ${redactNomusUrlForLog(url)}; retry ${attempt + 1}/${maxRetries}.`
          );
          await sleepFn(retryBaseMs * Math.pow(2, attempt));
          continue;
        }
        throw new Error(
          `Timeout HTTP após ${timeoutMs}ms em ${redactNomusUrlForLog(url)}`
        );
      }
      throw error;
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  }

  throw new Error("Estado inesperado no retry HTTP Nomus.");
}
