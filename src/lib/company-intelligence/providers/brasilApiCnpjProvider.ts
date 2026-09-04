import {
  CNPJ_PROVIDER_TIMEOUT_MS,
  KnownHostFetchError,
  fetchKnownHostJson,
} from "../http.js";
import { isUsableBrasilApiPayload, normalizeBrasilApiCnpjPayload } from "../normalizeBrasilApiCnpj.js";
import { CNPJ_SOURCE_BRASIL_API } from "../registryTypes.js";
import type { CompanyRegistryProvider, ProviderOutcome } from "./types.js";

export const BRASIL_API_CNPJ_BASE = "https://brasilapi.com.br/api/cnpj/v1";

function brasilApiUrl(cnpj: string): string {
  return `${BRASIL_API_CNPJ_BASE}/${cnpj}`;
}

export const brasilApiCnpjProvider: CompanyRegistryProvider = {
  source: CNPJ_SOURCE_BRASIL_API,
  async lookup(cnpj, fetchImpl): Promise<ProviderOutcome> {
    const started = Date.now();
    const fetchedAt = new Date().toISOString();
    try {
      const { status, json } = await fetchKnownHostJson(brasilApiUrl(cnpj), {
        timeoutMs: CNPJ_PROVIDER_TIMEOUT_MS,
        fetchImpl,
      });
      const latencyMs = Date.now() - started;
      if (status === 404) {
        return {
          status: "NOT_FOUND",
          source: CNPJ_SOURCE_BRASIL_API,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "CNPJ não encontrado na BrasilAPI.",
          httpStatus: 404,
        };
      }
      if (status === 429) {
        return {
          status: "RATE_LIMIT",
          source: CNPJ_SOURCE_BRASIL_API,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Limite da BrasilAPI atingido.",
          httpStatus: 429,
        };
      }
      if (status < 200 || status >= 300) {
        return {
          status: "ERROR",
          source: CNPJ_SOURCE_BRASIL_API,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: `BrasilAPI indisponível (HTTP ${status}).`,
          httpStatus: status,
        };
      }
      if (!isUsableBrasilApiPayload(json)) {
        return {
          status: "INVALID_PAYLOAD",
          source: CNPJ_SOURCE_BRASIL_API,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Resposta inválida da BrasilAPI.",
          httpStatus: 502,
        };
      }
      return {
        status: "SUCCESS",
        source: CNPJ_SOURCE_BRASIL_API,
        fetchedAt,
        latencyMs,
        fromCache: false,
        summary: normalizeBrasilApiCnpjPayload(json),
        rawJson: json,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error instanceof KnownHostFetchError && error.kind === "timeout") {
        return {
          status: "TIMEOUT",
          source: CNPJ_SOURCE_BRASIL_API,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Tempo esgotado na BrasilAPI.",
          httpStatus: 504,
        };
      }
      return {
        status: "ERROR",
        source: CNPJ_SOURCE_BRASIL_API,
        fetchedAt,
        latencyMs,
        fromCache: false,
        message: "BrasilAPI indisponível no momento.",
        httpStatus: 502,
      };
    }
  },
};
