/**
 * Configuração da consulta LIKE SERASA — Boa Vista "Define Limite Positivo Pessoa Jurídica", via Direct Data (API v3).
 *
 * Nome exibido: LIKE SERASA. Provedor comercial: Direct Data. Fonte dos dados: Boa Vista. O produto NÃO é da Serasa
 * e a interface nunca pode sugerir isso.
 *
 * Credenciais só no processo do servidor (nunca no Git, na URL ou no frontend). O preço é o valor AUTORIZADO para
 * exibição e registro (padrão R$ 21,50 = 2150 centavos); a cobrança real é da Direct Data.
 *
 * A chamada real só é permitida em produção: ver environmentGate.ts (fail-closed).
 */

export const LIKE_SERASA_DISPLAY_NAME = "LIKE SERASA";
export const BOA_VISTA_DEFINE_LIMITE_PRODUCT = "Boa Vista — Define Limite Positivo Pessoa Jurídica";
export const BOA_VISTA_DEFINE_LIMITE_PROVIDER = "Direct Data";
export const BOA_VISTA_DEFINE_LIMITE_SOURCE = "Boa Vista";
export const BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION = "Boa Vista — consulta disponibilizada pela Direct Data.";
/** Confirmado no OpenAPI v3 da Direct Data (swagger/v3/swagger.json): GET, parâmetros CNPJ e GERARCOMPROVANTE. */
export const BOA_VISTA_DEFINE_LIMITE_PATH = "/api/BoaVistaDefineLimitePositivoPJ";
/** Versão do parser gravada em cada consulta (muda quando a normalização muda). */
export const BOA_VISTA_DEFINE_LIMITE_PARSER_VERSION = "bvdl-pj-1";
/** O OpenAPI declara `score.score` como string sem escala ou faixa. Não converter nem reescalar. */
export const BOA_VISTA_SCORE_SCALE_NOTE =
  "A Boa Vista devolve o score como texto, sem declarar a escala no retorno. O valor é exibido como veio e não é convertido para o Score de Confiança V1.";
export const BOA_VISTA_LIMIT_NOTE =
  "Limite sugerido pelo fornecedor. É uma evidência externa: não altera o limite aprovado internamente nem a decisão de crédito do IndusCost.";

export const DEFAULT_LIKE_SERASA_UNIT_PRICE_CENTS = 2150;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LikeSerasaConfig = {
  /** Habilitação explícita da consulta real (uma das condições do gate; nunca suficiente sozinha). */
  liveEnabled: boolean;
  /** Modo de demonstração com fixtures sintéticas (só fora de produção; nunca chama o provedor). */
  demoEnabled: boolean;
  token: string;
  baseUrl: string;
  unitPriceCents: number;
  timeoutMs: number;
  cacheTtlMs: number;
  rateLimitPerMinute: number;
  /** GERARCOMPROVANTE=Habilitar na consulta real (a doc manda conferir as "Obs" do produto; padrão desligado). */
  receiptEnabled: boolean;
  /** Guardar o retorno bruto (redigido) para auditoria. Padrão desligado: minimização de dados. */
  storeRawPayload: boolean;
};

function flag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value == null || String(value).trim() === "") return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function readLikeSerasaConfig(env: NodeJS.ProcessEnv = process.env): LikeSerasaConfig {
  const cacheTtlMs = positiveInt(env.LIKE_SERASA_CACHE_TTL_MS, DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
  return {
    liveEnabled: flag(env.LIKE_SERASA_LIVE_ENABLED),
    demoEnabled: flag(env.LIKE_SERASA_DEMO_ENABLED),
    token: String(env.LIKE_SERASA_DIRECT_DATA_TOKEN ?? "").trim(),
    baseUrl: String(env.LIKE_SERASA_DIRECT_DATA_BASE_URL ?? "https://apiv3.directd.com.br").replace(/\/+$/, ""),
    unitPriceCents: positiveInt(env.LIKE_SERASA_UNIT_PRICE_CENTS, DEFAULT_LIKE_SERASA_UNIT_PRICE_CENTS),
    timeoutMs: Math.max(1000, positiveInt(env.LIKE_SERASA_TIMEOUT_MS, 25000)),
    cacheTtlMs,
    rateLimitPerMinute: Math.max(1, positiveInt(env.LIKE_SERASA_RATE_LIMIT_PER_MINUTE, 5)),
    receiptEnabled: flag(env.LIKE_SERASA_RECEIPT_ENABLED),
    storeRawPayload: flag(env.LIKE_SERASA_STORE_RAW_PAYLOAD),
  };
}

export function formatLikeSerasaPrice(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Só SUPER_ADMIN dispara consulta paga (mesma política do QUOD). A leitura do resultado é autenticada. */
export function canRequestLikeSerasa(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "SUPER_ADMIN";
}
