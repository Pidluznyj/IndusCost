import { QUOD_DOSSIER_PATH, type QuodDossierConfig } from "./config.js";

export type QuodProviderResult =
  | { outcome: "SUCCESS"; status: number; body: unknown }
  | { outcome: "AUTH"; status: number }
  | { outcome: "RATE_LIMIT"; status: number }
  | { outcome: "HTTP_ERROR"; status: number }
  | { outcome: "TIMEOUT" }
  | { outcome: "NETWORK" };

/**
 * Uma chamada. Sem retry: timeout e 5xx podem já ter sido cobrados pelo provedor.
 * O contrato vigente da Direct Data é GET com Authorization Bearer. O token não vai na URL.
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
