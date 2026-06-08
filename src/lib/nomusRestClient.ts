/** Cliente HTTP mínimo para APIs REST Nomus — sem logar credenciais. */

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

export function buildNomusHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const customHeaderName = (env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) {
    headers[customHeaderName] = customHeaderValue;
  }

  return headers;
}

/** Monta URL sem duplicar `/rest/rest` quando NOMUS_BASE_URL já termina em `/rest/`. */
export function buildNomusUrl(baseUrl: string, resource: string, query?: Record<string, string>): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  const url = new URL(normalizedResource, normalizedBase);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

export function redactNomusUrlForLog(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return `${parsed.origin}${parsed.pathname}${parsed.search ? "?…" : ""}`;
}

export function redactHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? "***" : value;
  }
  return redacted;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchNomusJsonOptions = {
  maxRetries?: number;
  retryBaseMs?: number;
  logPrefix?: string;
};

export async function fetchNomusJson(
  url: URL,
  options: FetchNomusJsonOptions = {}
): Promise<unknown> {
  const maxRetries = options.maxRetries ?? 6;
  const retryBaseMs = options.retryBaseMs ?? 700;
  const logPrefix = options.logPrefix ?? "[nomus]";
  const headers = buildNomusHeaders();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();

    const body = await res.text().catch(() => "");
    if (res.status === 429 && attempt < maxRetries) {
      let waitMs: number | null = null;
      try {
        const parsed = JSON.parse(body) as { tempoAteLiberar?: unknown };
        const tempo = Number(parsed?.tempoAteLiberar);
        if (Number.isFinite(tempo) && tempo > 0) waitMs = tempo * 1000 + 1000;
      } catch {
        waitMs = null;
      }
      if (waitMs == null) {
        const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000 + 1000
            : retryBaseMs * Math.pow(2, attempt);
      }
      console.warn(
        `${logPrefix} rate limit 429 em ${redactNomusUrlForLog(url)}; aguardando ${(waitMs / 1000).toFixed(0)}s.`
      );
      await sleep(waitMs);
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`Falha HTTP ${res.status} em ${redactNomusUrlForLog(url)}: ${body.slice(0, 300)}`);
    }
    await sleep(retryBaseMs * Math.pow(2, attempt));
  }

  throw new Error("Estado inesperado no retry HTTP Nomus.");
}
