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
  /**
   * Timeout por tentativa (ms). Passar explicitamente sobrepõe
   * `NOMUS_HTTP_TIMEOUT_MS`. Sem valor válido em nenhum dos dois, usa
   * `NOMUS_HTTP_TIMEOUT_DEFAULT_MS` — nunca fica sem timeout por omissão.
   */
  timeoutMs?: number;
  /** Injetável em testes (ex.: sleep mock). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Chamado quando um status recuperável dispara retry (ex.: 429). */
  onRetryableStatus?: (info: { status: number; attempt: number }) => void;
  /** Contexto de log opcional (ex.: recurso/página) — aparece nas linhas HTTP_*. */
  logContext?: Record<string, string | number>;
};

/** Limites de `NOMUS_HTTP_TIMEOUT_MS` — nenhuma tentativa HTTP pode esperar indefinidamente. */
export const NOMUS_HTTP_TIMEOUT_MIN_MS = 1000;
export const NOMUS_HTTP_TIMEOUT_DEFAULT_MS = 60000;
export const NOMUS_HTTP_TIMEOUT_MAX_MS = 300000;

/**
 * Resolve e valida o timeout por tentativa. Nunca retorna 0/desligado por
 * omissão — ausência ou valor inválido caem no default seguro (60s), com
 * aviso técnico (sem valores de env sensíveis) quando o valor informado era
 * inválido (não quando estava simplesmente ausente).
 */
export function resolveNomusHttpTimeoutMs(
  optionsTimeout?: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const clamp = (n: number) =>
    Math.min(NOMUS_HTTP_TIMEOUT_MAX_MS, Math.max(NOMUS_HTTP_TIMEOUT_MIN_MS, Math.trunc(n)));

  if (optionsTimeout != null) {
    if (Number.isFinite(optionsTimeout) && optionsTimeout > 0) return clamp(optionsTimeout);
    console.warn(
      `[nomus] timeoutMs inválido passado por opção (${JSON.stringify(optionsTimeout)}); usando padrão de ${NOMUS_HTTP_TIMEOUT_DEFAULT_MS}ms.`
    );
    return NOMUS_HTTP_TIMEOUT_DEFAULT_MS;
  }

  const raw = (env.NOMUS_HTTP_TIMEOUT_MS ?? "").trim();
  if (!raw) return NOMUS_HTTP_TIMEOUT_DEFAULT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw) {
    console.warn(
      `[nomus] NOMUS_HTTP_TIMEOUT_MS inválido (não é inteiro positivo); usando padrão de ${NOMUS_HTTP_TIMEOUT_DEFAULT_MS}ms.`
    );
    return NOMUS_HTTP_TIMEOUT_DEFAULT_MS;
  }
  return clamp(parsed);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Códigos de erro de socket/DNS considerados transitórios — elegíveis a retry, nunca permanentes. */
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Erro transitório de rede (reset de conexão, DNS temporário, etc.) — nunca
 * um AbortError (esse é tratado por `isAbortError`, que sempre tem origem no
 * timeout interno desta função, já que nenhum outro AbortSignal externo é
 * encaminhado ao fetch aqui).
 */
function isTransientNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const direct = errorCode(error);
  if (direct && TRANSIENT_NETWORK_ERROR_CODES.has(direct)) return true;
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : null;
  const causeCode = errorCode(cause);
  return causeCode != null && TRANSIENT_NETWORK_ERROR_CODES.has(causeCode);
}

function formatLogContext(context?: Record<string, string | number>): string {
  if (!context) return "";
  const parts = Object.entries(context).map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
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
  // `timeoutMs` nunca é 0 aqui — resolveNomusHttpTimeoutMs sempre devolve um
  // valor positivo (default 60000ms), então TODA tentativa tem AbortController.
  const timeoutMs = resolveNomusHttpTimeoutMs(options.timeoutMs);
  const sleepFn = options.sleepFn ?? sleep;
  const headers = buildNomusHeaders();
  const ctx = formatLogContext(options.logContext);
  const safeUrl = redactNomusUrlForLog(url);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const attemptStartedAt = Date.now();
    console.log(
      `${logPrefix} HTTP_START url=${safeUrl}${ctx} attempt=${attempt + 1}/${maxRetries + 1} timeoutMs=${timeoutMs}`
    );
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        const elapsedMs = Date.now() - attemptStartedAt;
        console.log(
          `${logPrefix} HTTP_SUCCESS url=${safeUrl}${ctx} status=${res.status} elapsedMs=${elapsedMs}`
        );
        return json;
      }

      const body = await res.text().catch(() => "");
      if (res.status === 429 && attempt < maxRetries) {
        options.onRetryableStatus?.({ status: 429, attempt });
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
          `${logPrefix} HTTP_RETRY url=${safeUrl}${ctx} reason=rate_limit_429 nextAttempt=${attempt + 2}/${maxRetries + 1} waitMs=${waitMs}`
        );
        await sleepFn(waitMs);
        continue;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxRetries) {
        const safeBody = sanitizeNomusErrorBody(body);
        console.warn(
          `${logPrefix} HTTP_FAILED url=${safeUrl}${ctx} reason=http_${res.status} attempts=${attempt + 1}`
        );
        throw new Error(
          `Falha HTTP ${res.status} em ${safeUrl}: ${safeBody || "(sem corpo)"}`
        );
      }
      options.onRetryableStatus?.({ status: res.status, attempt });
      console.warn(
        `${logPrefix} HTTP_RETRY url=${safeUrl}${ctx} reason=http_${res.status} nextAttempt=${attempt + 2}/${maxRetries + 1} waitMs=${retryBaseMs * Math.pow(2, attempt)}`
      );
      await sleepFn(retryBaseMs * Math.pow(2, attempt));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Falha HTTP")) throw error;

      const timeout = isAbortError(error);
      const transientNetwork = !timeout && isTransientNetworkError(error);
      if (timeout || transientNetwork) {
        const reason = timeout ? "timeout" : `network_${errorCode(error) ?? errorCode((error as { cause?: unknown })?.cause) ?? "transient"}`;
        if (attempt < maxRetries) {
          console.warn(
            `${logPrefix} HTTP_RETRY url=${safeUrl}${ctx} reason=${reason} nextAttempt=${attempt + 2}/${maxRetries + 1} waitMs=${retryBaseMs * Math.pow(2, attempt)}`
          );
          await sleepFn(retryBaseMs * Math.pow(2, attempt));
          continue;
        }
        console.warn(
          `${logPrefix} HTTP_FAILED url=${safeUrl}${ctx} reason=${reason} attempts=${attempt + 1}`
        );
        throw new Error(
          timeout
            ? `Timeout HTTP após ${timeoutMs}ms em ${safeUrl}`
            : `Falha de rede transitória (${reason}) em ${safeUrl} após ${attempt + 1} tentativa(s)`
        );
      }
      // Erro permanente (ex.: TypeError de programação, DNS inexistente sem
      // código transitório) — nunca faz retry indiscriminado.
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Estado inesperado no retry HTTP Nomus.");
}
