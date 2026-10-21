/**
 * Protestos Nacional — IEPTB Online (Direct Data API v3).
 * Contrato confirmado no catálogo: GET /api/ProtestosOnline?Cnpj=
 * Token só no processo, nunca na URL. Desligado por padrão.
 */

export const IEPTB_ONLINE_PRODUCT = "Protestos Nacional — IEPTB Online";
export const IEPTB_ONLINE_PROVIDER = "Direct Data";
export const IEPTB_ONLINE_PATH = "/api/ProtestosOnline";
export const IEPTB_COVERAGE_NOTE =
  "Consulta ao Instituto de Estudos de Protesto de Títulos do Brasil (IEPTB Online), abrangência federal conforme o catálogo Direct Data. Não substitui o protesto interno Nomus nem os protestos do dossiê QUOD (cobertura declarada de São Paulo).";
export const IEPTB_EMPTY_NOTE =
  "Nenhum protesto identificado na consulta IEPTB. Isso vale somente para esta fonte, com retorno completo e bem-sucedido. Não significa ausência de protesto interno nem de ocorrência no QUOD.";

export type IeptbOnlineConfig = {
  enabled: boolean;
  token: string;
  baseUrl: string;
  unitPriceCents: number;
  timeoutMs: number;
  cacheTtlMs: number;
  rateLimitPerMinute: number;
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function flag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function readIeptbOnlineConfig(env: NodeJS.ProcessEnv = process.env): IeptbOnlineConfig {
  const cacheTtlMs = positiveInt(env.IEPTB_ONLINE_CACHE_TTL_MS, DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
  const token = String(env.IEPTB_ONLINE_TOKEN ?? env.QUOD_DIRECT_DATA_TOKEN ?? "").trim();
  const baseUrl = String(
    env.IEPTB_ONLINE_BASE_URL ?? env.QUOD_DIRECT_DATA_BASE_URL ?? "https://apiv3.directd.com.br"
  ).replace(/\/+$/, "");
  return {
    enabled: flag(env.IEPTB_ONLINE_ENABLED),
    token,
    baseUrl,
    unitPriceCents: positiveInt(env.IEPTB_ONLINE_UNIT_PRICE_CENTS, 350),
    timeoutMs: Math.max(1000, positiveInt(env.IEPTB_ONLINE_TIMEOUT_MS, 20000)),
    cacheTtlMs,
    rateLimitPerMinute: Math.max(1, positiveInt(env.IEPTB_ONLINE_RATE_LIMIT_PER_MINUTE, 5)),
  };
}
