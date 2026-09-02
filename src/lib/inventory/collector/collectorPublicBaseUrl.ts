/**
 * Base pública do Stock Collector — validação pura e fail-closed.
 *
 * O QR GERAL DE SETOR é lido pela câmera NATIVA do iPad, que só abre o Safari
 * quando o conteúdo é uma URL ABSOLUTA. Um path relativo
 * (`/collector/sector/raw-material`) é válido como rota interna e INÚTIL como
 * QR físico. Por isso a resolução da base é fail-closed: sem base absoluta e
 * operacional, nada de QR — erro explícito de CONFIGURAÇÃO.
 *
 * Módulo puro de propósito: recebe `env` por parâmetro (nunca lê `process.env`),
 * não lança e não importa nada. Assim serve ao servidor, aos testes e ao
 * frontend (que só precisa reconhecer os códigos de erro).
 */

export const COLLECTOR_PUBLIC_BASE_URL_ENV = "INVENTORY_COLLECTOR_PUBLIC_BASE_URL";
export const COLLECTOR_PUBLIC_BASE_URL_FALLBACK_ENV = "APP_URL";

/** Nenhuma base configurada (nem a principal, nem o fallback). */
export const COLLECTOR_PUBLIC_BASE_URL_REQUIRED = "COLLECTOR_PUBLIC_BASE_URL_REQUIRED";
/** Base configurada, porém inutilizável para um QR físico. */
export const COLLECTOR_PUBLIC_BASE_URL_INVALID = "COLLECTOR_PUBLIC_BASE_URL_INVALID";

export type CollectorPublicBaseUrlErrorCode =
  | typeof COLLECTOR_PUBLIC_BASE_URL_REQUIRED
  | typeof COLLECTOR_PUBLIC_BASE_URL_INVALID;

/** Códigos que a UI humana deve tratar como "configuração do ambiente". */
export const COLLECTOR_PUBLIC_BASE_URL_ERROR_CODES: readonly string[] = [
  COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
  COLLECTOR_PUBLIC_BASE_URL_INVALID,
];

export function isCollectorPublicBaseUrlErrorCode(code: unknown): boolean {
  return typeof code === "string" && COLLECTOR_PUBLIC_BASE_URL_ERROR_CODES.includes(code);
}

export type CollectorPublicBaseUrlSource =
  | typeof COLLECTOR_PUBLIC_BASE_URL_ENV
  | typeof COLLECTOR_PUBLIC_BASE_URL_FALLBACK_ENV;

export type CollectorPublicBaseUrlSuccess = {
  ok: true;
  baseUrl: string;
  source: CollectorPublicBaseUrlSource;
};

export type CollectorPublicBaseUrlFailure = {
  ok: false;
  code: CollectorPublicBaseUrlErrorCode;
  /** Variável que forneceu o valor rejeitado; null quando nada foi configurado. */
  source: CollectorPublicBaseUrlSource | null;
  message: string;
};

export type CollectorPublicBaseUrlResolution =
  | CollectorPublicBaseUrlSuccess
  | CollectorPublicBaseUrlFailure;

/**
 * Type guard explícito: o tsconfig do projeto não liga `strictNullChecks`, e sem
 * ele o TypeScript não estreita a união pelo discriminante `ok: false`.
 */
export function isCollectorPublicBaseUrlFailure(
  resolution: CollectorPublicBaseUrlResolution
): resolution is CollectorPublicBaseUrlFailure {
  return resolution.ok !== true;
}

/**
 * Hosts de loopback onde HTTP é aceitável.
 *
 * Regra explícita: `https` é o padrão operacional (homologação/produção); `http`
 * só passa em loopback, para desenvolvimento local. HTTP remoto é recusado —
 * um QR operacional impresso não pode carregar tráfego em claro pelo tailnet.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const REQUIRED_MESSAGE =
  `QR de setor indisponível: configure ${COLLECTOR_PUBLIC_BASE_URL_ENV} ` +
  `com a URL HTTPS que o tablet usa para abrir o Collector.`;

function invalid(
  source: CollectorPublicBaseUrlSource,
  detail: string
): CollectorPublicBaseUrlResolution {
  return {
    ok: false,
    code: COLLECTOR_PUBLIC_BASE_URL_INVALID,
    source,
    message: `QR de setor indisponível: ${source} ${detail}`,
  };
}

function readEnv(env: Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? "").trim();
}

/**
 * Resolve a base pública do Collector a partir do ambiente.
 * Preferência: INVENTORY_COLLECTOR_PUBLIC_BASE_URL → APP_URL.
 * Nunca inventa host, domínio, IP ou protocolo.
 */
export function resolveCollectorPublicBaseUrl(
  env: Record<string, string | undefined>
): CollectorPublicBaseUrlResolution {
  const primary = readEnv(env, COLLECTOR_PUBLIC_BASE_URL_ENV);
  const source: CollectorPublicBaseUrlSource = primary
    ? COLLECTOR_PUBLIC_BASE_URL_ENV
    : COLLECTOR_PUBLIC_BASE_URL_FALLBACK_ENV;
  const raw = primary || readEnv(env, COLLECTOR_PUBLIC_BASE_URL_FALLBACK_ENV);

  if (!raw) {
    return {
      ok: false,
      code: COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
      source: null,
      message: REQUIRED_MESSAGE,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid(source, "não é uma URL absoluta válida.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return invalid(source, "precisa usar https:// (http:// apenas em loopback local).");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return invalid(source, "precisa usar https:// fora de localhost/127.0.0.1.");
  }
  // O QR nunca pode carregar credencial embutida na URL.
  if (parsed.username || parsed.password) {
    return invalid(source, "não pode conter usuário/senha na URL.");
  }
  if (parsed.search || parsed.hash) {
    return invalid(source, "não pode conter query string nem fragmento.");
  }

  // origin + pathname preserva subpath de reverse proxy (ex.: https://host/app).
  const baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  if (!baseUrl) {
    return invalid(source, "não é uma URL absoluta válida.");
  }
  return { ok: true, baseUrl, source };
}

/**
 * Concatena base normalizada + path absoluto.
 * Concatenação direta (e não `new URL(path, base)`) porque um path absoluto
 * descartaria o subpath da base num reverse proxy.
 */
export function joinCollectorPublicUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
