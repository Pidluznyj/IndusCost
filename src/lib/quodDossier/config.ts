/**
 * Configuração do Dossiê QUOD Completo (Direct Data API v3).
 * Credencial só no processo. Preço e teto não ficam fixos no código de negócio.
 */

export const QUOD_DOSSIER_PRODUCT = "Dossiê QUOD Completo";
export const QUOD_DOSSIER_PROVIDER = "Direct Data";
export const QUOD_DOSSIER_PATH = "/api/DossieCreditoCompleto";
/** A documentação do produto não declara escala no JSON. Não converter para 0–100. */
export const QUOD_SCORE_SCALE_NOTE =
  "O Dossiê QUOD Completo não declara a escala do score no retorno. O número é exibido como veio do provedor e não é convertido para 0–100.";
export const QUOD_PROTEST_COVERAGE_NOTE =
  "Os protestos deste dossiê cobrem São Paulo, conforme a documentação Direct Data. Não são uma certidão nacional. Esta consulta não dispara o IEPTB.";

export type QuodDossierConfig = {
  enabled: boolean;
  token: string;
  baseUrl: string;
  unitPriceCents: number;
  timeoutMs: number;
  cacheTtlMs: number;
  monthlyLimitCents: number;
  maxPerCnpj: number;
  cnpjIntervalMs: number;
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

export function readQuodDossierConfig(env: NodeJS.ProcessEnv = process.env): QuodDossierConfig {
  const cacheTtlMs = positiveInt(env.QUOD_DOSSIER_CACHE_TTL_MS, DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
  return {
    enabled: flag(env.QUOD_DOSSIER_ENABLED),
    token: String(env.QUOD_DIRECT_DATA_TOKEN ?? "").trim(),
    baseUrl: String(env.QUOD_DIRECT_DATA_BASE_URL ?? "https://apiv3.directd.com.br").replace(/\/+$/, ""),
    unitPriceCents: positiveInt(env.QUOD_DOSSIER_UNIT_PRICE_CENTS, 699),
    timeoutMs: Math.max(1000, positiveInt(env.QUOD_DOSSIER_TIMEOUT_MS, 20000)),
    cacheTtlMs,
    monthlyLimitCents: positiveInt(env.QUOD_DOSSIER_MONTHLY_LIMIT_CENTS, 0),
    maxPerCnpj: Math.max(1, positiveInt(env.QUOD_DOSSIER_MAX_PER_CNPJ, 1)),
    cnpjIntervalMs: positiveInt(env.QUOD_DOSSIER_CNPJ_INTERVAL_MS, cacheTtlMs) || cacheTtlMs,
    rateLimitPerMinute: Math.max(1, positiveInt(env.QUOD_DOSSIER_RATE_LIMIT_PER_MINUTE, 5)),
  };
}

export function formatQuodPrice(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function quodBudgetMonthWindow(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const [yearText, monthText] = parts.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = civilInstant(year, month, 1);
  const end = month === 12 ? civilInstant(year + 1, 1, 1) : civilInstant(year, month + 1, 1);
  return { start, end };
}

function civilInstant(year: number, month: number, day: number): Date {
  let utc = Date.UTC(year, month - 1, day, 3, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const dayDelta = Date.UTC(year, month - 1, day) - Date.UTC(read("year"), read("month") - 1, read("day"));
    const minuteDelta = -1 * (read("hour") * 60 + read("minute"));
    const next = utc + dayDelta + minuteDelta * 60_000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

/** Só SUPER_ADMIN dispara consulta paga QUOD/IEPTB. A leitura do resultado é autenticada. */
export function canAccessQuodDossier(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "SUPER_ADMIN";
}
