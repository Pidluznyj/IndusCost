import {
  classifyDirectDataHttpResponse,
  classifyDirectDataNetworkError,
  type ClassifiedDirectDataResponse,
} from "@/src/lib/directData/classifyProviderResponse.js";
import { IEPTB_ONLINE_PATH, type IeptbOnlineConfig } from "./config.js";

export type IeptbProviderResult = ClassifiedDirectDataResponse;

/**
 * Uma chamada. Sem retry: timeout local e 5xx sem resultado oficial podem já ter sido cobrados.
 * Contrato Direct Data: GET /api/ProtestosOnline?Cnpj= com Bearer.
 * Token nunca vai na URL. CPF não é enviado na consulta de CNPJ.
 */
export async function fetchIeptbOnline(input: {
  cnpj: string;
  config: Pick<IeptbOnlineConfig, "baseUrl" | "token" | "timeoutMs">;
  fetchImpl?: typeof fetch;
}): Promise<IeptbProviderResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(IEPTB_ONLINE_PATH, `${input.config.baseUrl}/`);
  url.searchParams.set("Cnpj", input.cnpj);
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
