/**
 * Política HTTP compartilhada. 429 não entra em loop.
 */

import type { LegalQueryOutcome } from "./legalExposureContracts.js";
import { sanitizeErrorMessage } from "./legalExposureNormalization.js";

export const LEGAL_EXPOSURE_HTTP_TIMEOUT_MS = 15_000;

const SCIENCE_PATH = /(ciencia|inteiro[-_]?teor|acknowledge|mark[-_]?as[-_]?read)/i;

export function assertReadOnlyLegalPath(path: string): void {
  if (SCIENCE_PATH.test(path)) {
    throw new Error("LEGAL_EXPOSURE_SCIENCE_FORBIDDEN");
  }
}

export function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

export function outcomeFromHttpStatus(status: number): LegalQueryOutcome {
  if (status === 401 || status === 403) return "AUTH_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "SOURCE_ERROR";
  if (status >= 400) return "INVALID_RESPONSE";
  return "SUCCESS";
}

export type LegalHttpResult = {
  outcome: LegalQueryOutcome;
  status: number | null;
  body: unknown;
  retryAfterSeconds: number | null;
  errorMessageSanitized: string | null;
};

export async function legalExposureFetch(input: {
  fetchImpl: typeof fetch;
  url: string;
  path: string;
  init?: RequestInit;
  timeoutMs?: number;
}): Promise<LegalHttpResult> {
  assertReadOnlyLegalPath(input.path);
  assertReadOnlyLegalPath(input.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? LEGAL_EXPOSURE_HTTP_TIMEOUT_MS);
  try {
    const response = await input.fetchImpl(input.url, { ...input.init, signal: controller.signal });
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { nonJson: true };
      }
    }
    const outcome = outcomeFromHttpStatus(response.status);
    if (outcome === "RATE_LIMITED") {
      return {
        outcome,
        status: response.status,
        body: null,
        retryAfterSeconds,
        errorMessageSanitized: "Fonte limitou a taxa de consultas.",
      };
    }
    if (outcome !== "SUCCESS") {
      return {
        outcome,
        status: response.status,
        body: null,
        retryAfterSeconds,
        errorMessageSanitized: sanitizeErrorMessage(`HTTP ${response.status}`),
      };
    }
    return { outcome: "SUCCESS", status: response.status, body, retryAfterSeconds: null, errorMessageSanitized: null };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      outcome: aborted ? "TIMEOUT" : "SOURCE_ERROR",
      status: null,
      body: null,
      retryAfterSeconds: null,
      errorMessageSanitized: sanitizeErrorMessage(aborted ? "TIMEOUT" : "SOURCE_ERROR"),
    };
  } finally {
    clearTimeout(timeout);
  }
}
