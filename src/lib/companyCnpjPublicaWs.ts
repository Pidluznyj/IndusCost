/**
 * Cliente publica.cnpj.ws — host hardcoded no backend.
 */
import { CompanyIntelligenceError } from "./companyCnpjErrors.js";
import { isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";

const PUBLICA_CNPJ_WS_HOST = "https://publica.cnpj.ws";

export async function fetchPublicCnpj(
  cnpj: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000
): Promise<unknown> {
  const digits = normalizeCnpj(cnpj);
  if (!isValidCnpj(digits)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${PUBLICA_CNPJ_WS_HOST}/cnpj/${digits}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      throw new CompanyIntelligenceError("CNPJ não encontrado na base pública.", "CNPJ_NOT_FOUND", 404);
    }
    if (res.status === 429) {
      throw new CompanyIntelligenceError(
        "Limite de consultas da API pública atingido. Tente novamente em alguns minutos.",
        "RATE_LIMIT",
        429
      );
    }
    if (!res.ok) {
      throw new CompanyIntelligenceError(
        `Falha na consulta pública (HTTP ${res.status}).`,
        "UPSTREAM_ERROR",
        502
      );
    }
    const json = await res.json();
    if (!json || typeof json !== "object") {
      throw new CompanyIntelligenceError("Resposta inesperada da API pública.", "INVALID_PAYLOAD", 502);
    }
    return json;
  } catch (e: unknown) {
    if (e instanceof CompanyIntelligenceError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new CompanyIntelligenceError("Tempo esgotado na consulta pública.", "TIMEOUT", 504);
    }
    throw new CompanyIntelligenceError(
      "Serviço de consulta CNPJ indisponível no momento.",
      "UPSTREAM_UNAVAILABLE",
      502
    );
  } finally {
    clearTimeout(timer);
  }
}
