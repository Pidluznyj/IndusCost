/**
 * Contrato da UI pública do Turnstile — funções puras, testáveis sem DOM.
 *
 * A site key pública já viaja no DTO como `turnstileSiteKey`.
 * O secret nunca entra aqui.
 */

export const TURNSTILE_COPY = {
  title: "Verificação de segurança",
  help: "Para proteger esta pesquisa contra envios automatizados, conclua a verificação abaixo.",
  loading: "Carregando verificação de segurança...",
  expired: "A verificação expirou. Valide novamente.",
  error: "Não foi possível carregar a verificação de segurança. Tente novamente.",
  missing: "Conclua a verificação de segurança antes de enviar.",
} as const;

export type PublicTurnstileUiStatus = "loading" | "ready" | "verified" | "expired" | "error";

export function turnstileIsRequired(siteKey: string | null | undefined): boolean {
  return Boolean(siteKey && siteKey.trim());
}

export type TurnstileSubmitGate = { ok: true } | { ok: false; error: string };

export function canSubmitWithTurnstile(
  siteKey: string | null | undefined,
  token: string | null | undefined
): TurnstileSubmitGate {
  if (!turnstileIsRequired(siteKey)) return { ok: true };
  if (!token || !token.trim()) {
    return { ok: false, error: TURNSTILE_COPY.missing };
  }
  return { ok: true };
}

export function isSurveySubmitDisabled(input: {
  submitting: boolean;
  siteKey: string | null | undefined;
  token: string | null | undefined;
}): boolean {
  if (input.submitting) return true;
  if (!turnstileIsRequired(input.siteKey)) return false;
  return !input.token?.trim();
}

export type SubmitOutcomeKind =
  | "ok"
  | "ALREADY_ANSWERED"
  | "TURNSTILE"
  | "VALIDATION"
  | "NETWORK"
  | "OTHER";

/** Token single-use: falha após consumo exige novo desafio. Idempotência de ALREADY_ANSWERED não. */
export function shouldResetTurnstileAfterSubmit(outcome: SubmitOutcomeKind): boolean {
  return outcome !== "ok" && outcome !== "ALREADY_ANSWERED";
}

export function publicFormJsonLooksSafe(serialized: string): boolean {
  const lowered = serialized.toLowerCase();
  if (lowered.includes("secretkey")) return false;
  if (lowered.includes("secret_key")) return false;
  if (lowered.includes("turnstilesecret")) return false;
  if (/"secret"\s*:/.test(lowered)) return false;
  return true;
}
