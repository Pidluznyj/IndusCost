/**
 * Cloudflare Turnstile — validação SEMPRE server-side.
 *
 * Postura fail-closed: se o segredo está configurado, a proteção é obrigatória
 * e nenhuma resposta vira SUBMITTED sem o siteverify aprovar. O bypass de
 * desenvolvimento é ignorado por completo quando NODE_ENV=production — não há
 * combinação de variáveis que o reative lá.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 8_000;

export type SatisfactionTurnstileMode = "required" | "disabled";

export type SatisfactionTurnstileConfig = {
  mode: SatisfactionTurnstileMode;
  siteKey: string | null;
  secretKey: string | null;
  /** Só pode ser true fora de produção. */
  devBypassEnabled: boolean;
};

function readFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Resolve a configuração efetiva.
 *
 * - `SATISFACTION_TURNSTILE_MODE=disabled` desliga explicitamente (útil em
 *   homologação sem site key). Qualquer outro valor com segredo presente =
 *   obrigatório.
 * - Sem segredo, não há como validar: modo `disabled`. Em produção isso é
 *   sinalizado por `isMisconfiguredForProduction`, para o runbook pegar.
 */
export function resolveTurnstileConfig(
  env: NodeJS.ProcessEnv = process.env
): SatisfactionTurnstileConfig {
  const isProduction = env.NODE_ENV === "production";
  const siteKey = (env.SATISFACTION_TURNSTILE_SITE_KEY ?? "").trim() || null;
  const secretKey = (env.SATISFACTION_TURNSTILE_SECRET_KEY ?? "").trim() || null;
  const explicitMode = (env.SATISFACTION_TURNSTILE_MODE ?? "").trim().toLowerCase();

  const disabledByFlag = explicitMode === "disabled" || explicitMode === "off";
  const mode: SatisfactionTurnstileMode =
    secretKey && !disabledByFlag ? "required" : "disabled";

  return {
    mode,
    siteKey,
    secretKey,
    // Em produção o bypass simplesmente não existe.
    devBypassEnabled: !isProduction && readFlag(env.SATISFACTION_TURNSTILE_DEV_BYPASS),
  };
}

/** Produção com proteção desligada é um desvio a reportar, não um estado normal. */
export function isMisconfiguredForProduction(
  config: SatisfactionTurnstileConfig,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.NODE_ENV === "production" && config.mode !== "required";
}

export type SatisfactionTurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "MISSING_TOKEN" | "REJECTED" | "UNAVAILABLE" };

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Verifica o token do desafio contra o siteverify da Cloudflare.
 *
 * `fetchImpl` é injetável para os testes — nenhuma suíte toca a rede.
 * Falha de rede resulta em UNAVAILABLE, e o chamador NÃO persiste a resposta:
 * indisponibilidade não vira permissão.
 */
export async function verifyTurnstileToken(
  token: string | null,
  config: SatisfactionTurnstileConfig,
  fetchImpl?: FetchLike
): Promise<SatisfactionTurnstileResult> {
  if (config.mode === "disabled") return { ok: true, skipped: true };
  if (config.devBypassEnabled) return { ok: true, skipped: true };

  if (!token || !token.trim()) return { ok: false, reason: "MISSING_TOKEN" };
  if (!config.secretKey) return { ok: false, reason: "UNAVAILABLE" };

  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike)) ?? null;
  if (!doFetch) return { ok: false, reason: "UNAVAILABLE" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret: config.secretKey, response: token }).toString();
    const response = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "UNAVAILABLE" };
    const payload = (await response.json()) as { success?: unknown };
    return payload?.success === true ? { ok: true, skipped: false } : { ok: false, reason: "REJECTED" };
  } catch {
    // Sem detalhe do erro no log: a mensagem pode carregar o token.
    return { ok: false, reason: "UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

export function turnstileFailureMessage(
  reason: Extract<SatisfactionTurnstileResult, { ok: false }>["reason"]
): string {
  switch (reason) {
    case "MISSING_TOKEN":
      return "Confirme que você não é um robô para enviar a pesquisa.";
    case "REJECTED":
      return "Não foi possível confirmar a verificação de segurança. Tente novamente.";
    default:
      return "Verificação de segurança indisponível no momento. Tente novamente em instantes.";
  }
}
