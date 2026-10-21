import {
  classifyDirectDataHttpResponse,
  classifyDirectDataNetworkError,
  type ClassifiedDirectDataResponse,
} from "@/src/lib/directData/classifyProviderResponse.js";
import { QUOD_DOSSIER_PATH, type QuodDossierConfig } from "./config.js";

export type QuodProviderResult = ClassifiedDirectDataResponse;

/**
 * Uma chamada. Sem retry: timeout local e 5xx sem resultado oficial podem já ter sido cobrados.
 * Contrato Direct Data: GET com Authorization Bearer. O token não vai na URL.
 */
export async function fetchQuodDossier(input: {
  cnpj: string;
  config: Pick<QuodDossierConfig, "baseUrl" | "token" | "timeoutMs">;
  fetchImpl?: typeof fetch;
}): Promise<QuodProviderResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(QUOD_DOSSIER_PATH, `${input.config.baseUrl}/`);
  url.searchParams.set("CNPJ", input.cnpj);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.config.token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return classifyDirectDataHttpResponse(response.status, body);
  } catch (error) {
    return classifyDirectDataNetworkError(error);
  } finally {
    clearTimeout(timer);
  }
}
