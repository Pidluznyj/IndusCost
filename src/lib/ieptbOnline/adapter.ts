import { IEPTB_ONLINE_PATH, type IeptbOnlineConfig } from "./config.js";

export type IeptbProviderResult =
  | { outcome: "SUCCESS"; status: number; body: unknown }
  | { outcome: "AUTH"; status: number }
  | { outcome: "RATE_LIMIT"; status: number }
  | { outcome: "HTTP_ERROR"; status: number }
  | { outcome: "TIMEOUT" }
  | { outcome: "NETWORK" };

/**
 * Uma chamada. Sem retry: timeout e 5xx podem já ter sido cobrados.
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
    if (response.status === 401 || response.status === 403) return { outcome: "AUTH", status: response.status };
    if (response.status === 429) return { outcome: "RATE_LIMIT", status: response.status };
    if (response.status >= 500) return { outcome: "HTTP_ERROR", status: response.status };
    if (!response.ok) return { outcome: "HTTP_ERROR", status: response.status };
    const body: unknown = await response.json().catch(() => null);
    return { outcome: "SUCCESS", status: response.status, body };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError") return { outcome: "TIMEOUT" };
    return { outcome: "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}
