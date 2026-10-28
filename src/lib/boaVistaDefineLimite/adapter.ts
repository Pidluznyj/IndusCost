import {
  classifyDirectDataHttpResponse,
  classifyDirectDataNetworkError,
  type ClassifiedDirectDataResponse,
} from "@/src/lib/directData/classifyProviderResponse.js";
import { BOA_VISTA_DEFINE_LIMITE_PATH, type LikeSerasaConfig } from "./config.js";

export type BoaVistaProviderResult = ClassifiedDirectDataResponse;

/**
 * Uma chamada, síncrona, sem retry: timeout local e 5xx sem `metaDados.resultado` podem já ter sido cobrados.
 * Contrato Direct Data v3 (OpenAPI): GET /api/BoaVistaDefineLimitePositivoPJ?CNPJ=...&GERARCOMPROVANTE=Desabilitar|Habilitar,
 * autenticação `Authorization: Bearer {token}` (recomendada). O token nunca vai na URL. `Async` não é enviado.
 */
export async function fetchBoaVistaDefineLimite(input: {
  cnpj: string;
  config: Pick<LikeSerasaConfig, "baseUrl" | "token" | "timeoutMs" | "receiptEnabled">;
  fetchImpl?: typeof fetch;
}): Promise<BoaVistaProviderResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(BOA_VISTA_DEFINE_LIMITE_PATH, `${input.config.baseUrl}/`);
  url.searchParams.set("CNPJ", input.cnpj);
  url.searchParams.set("GERARCOMPROVANTE", input.config.receiptEnabled ? "Habilitar" : "Desabilitar");
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
