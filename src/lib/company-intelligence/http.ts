const ALLOWED_HOSTS = new Set([
  "publica.cnpj.ws",
  "brasilapi.com.br",
  "api.bcb.gov.br",
  "olinda.bcb.gov.br",
]);

export const COMPANY_INTELLIGENCE_USER_AGENT = "IndusCost-CompanyIntelligence/1.0";
export const CNPJ_PROVIDER_TIMEOUT_MS = 15_000;
export const BCB_HTTP_TIMEOUT_MS = 8_000;

export class KnownHostFetchError extends Error {
  readonly kind: "timeout" | "blocked" | "network";

  constructor(message: string, kind: "timeout" | "blocked" | "network") {
    super(message);
    this.name = "KnownHostFetchError";
    this.kind = kind;
  }
}

export function assertAllowedHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new KnownHostFetchError("URL externa inválida.", "blocked");
  }
  if (parsed.protocol !== "https:") {
    throw new KnownHostFetchError("Somente HTTPS em hosts conhecidos.", "blocked");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new KnownHostFetchError("Host externo não permitido.", "blocked");
  }
  return parsed;
}

export async function fetchKnownHostJson(
  url: string,
  options: {
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
  }
): Promise<{ status: number; json: unknown }> {
  assertAllowedHttpsUrl(url);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": COMPANY_INTELLIGENCE_USER_AGENT,
        ...options.headers,
      },
    });
    let json: unknown = null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("json") || res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    return { status: res.status, json };
  } catch (error) {
    if (error instanceof KnownHostFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new KnownHostFetchError("Tempo esgotado na consulta externa.", "timeout");
    }
    throw new KnownHostFetchError("Falha de rede na consulta externa.", "network");
  } finally {
    clearTimeout(timer);
  }
}
