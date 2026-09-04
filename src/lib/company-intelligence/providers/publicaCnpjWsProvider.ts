import { normalizePublicCnpjPayload } from "@/src/lib/companyCnpjNormalize.js";
import {
  CNPJ_PROVIDER_TIMEOUT_MS,
  KnownHostFetchError,
  fetchKnownHostJson,
} from "../http.js";
import { CNPJ_SOURCE_PUBLICA } from "../registryTypes.js";
import type { CompanyRegistryProvider, ProviderOutcome } from "./types.js";

export const PUBLICA_CNPJ_WS_BASE = "https://publica.cnpj.ws/cnpj";

function publicaUrl(cnpj: string): string {
  return `${PUBLICA_CNPJ_WS_BASE}/${cnpj}`;
}

export const publicaCnpjWsProvider: CompanyRegistryProvider = {
  source: CNPJ_SOURCE_PUBLICA,
  async lookup(cnpj, fetchImpl): Promise<ProviderOutcome> {
    const started = Date.now();
    const fetchedAt = new Date().toISOString();
    try {
      const { status, json } = await fetchKnownHostJson(publicaUrl(cnpj), {
        timeoutMs: CNPJ_PROVIDER_TIMEOUT_MS,
        fetchImpl,
      });
      const latencyMs = Date.now() - started;
      if (status === 404) {
        return {
          status: "NOT_FOUND",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "CNPJ não encontrado na base pública.",
          httpStatus: 404,
        };
      }
      if (status === 429) {
        return {
          status: "RATE_LIMIT",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Limite de consultas da API pública atingido. Tente novamente em alguns minutos.",
          httpStatus: 429,
        };
      }
      if (status < 200 || status >= 300) {
        return {
          status: "ERROR",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: `Falha na consulta pública (HTTP ${status}).`,
          httpStatus: status,
        };
      }
      if (!json || typeof json !== "object") {
        return {
          status: "INVALID_PAYLOAD",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Resposta inesperada da API pública.",
          httpStatus: 502,
        };
      }
      const summary = normalizePublicCnpjPayload(json);
      if (!summary.companyName || summary.companyName === "—") {
        return {
          status: "INVALID_PAYLOAD",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Resposta inesperada da API pública.",
          httpStatus: 502,
        };
      }
      return {
        status: "SUCCESS",
        source: CNPJ_SOURCE_PUBLICA,
        fetchedAt,
        latencyMs,
        fromCache: false,
        summary,
        rawJson: json,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error instanceof KnownHostFetchError && error.kind === "timeout") {
        return {
          status: "TIMEOUT",
          source: CNPJ_SOURCE_PUBLICA,
          fetchedAt,
          latencyMs,
          fromCache: false,
          message: "Tempo esgotado na consulta pública.",
          httpStatus: 504,
        };
      }
      return {
        status: "ERROR",
        source: CNPJ_SOURCE_PUBLICA,
        fetchedAt,
        latencyMs,
        fromCache: false,
        message: "Serviço de consulta CNPJ indisponível no momento.",
        httpStatus: 502,
      };
    }
  },
};
