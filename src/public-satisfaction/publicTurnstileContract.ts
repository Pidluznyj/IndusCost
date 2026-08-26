/**
 * Contrato da UI pública do Turnstile — funções puras, testáveis sem DOM.
 */

export type PublicTurnstileConfig = {
  required: boolean;
  siteKey: string | null;
};

export type PublicFormTurnstileFields = {
  turnstile?: PublicTurnstileConfig | null;
  turnstileSiteKey?: string | null;
};

export function readTurnstileConfigFromForm(
  form: PublicFormTurnstileFields
): PublicTurnstileConfig {
  if (form.turnstile && typeof form.turnstile.required === "boolean") {
    return {
      required: form.turnstile.required,
      siteKey: form.turnstile.siteKey ?? null,
    };
  }
  const siteKey = form.turnstileSiteKey ?? null;
  return { required: Boolean(siteKey), siteKey };
}

export type TurnstileSubmitGate = { ok: true } | { ok: false; error: string };

export function canSubmitWithTurnstile(
  config: PublicTurnstileConfig,
  token: string | null
): TurnstileSubmitGate {
  if (!config.required) return { ok: true };
  if (!config.siteKey) {
    return { ok: false, error: turnstileUserMessage("error") };
  }
  if (!token || !token.trim()) {
    return { ok: false, error: turnstileUserMessage("missing") };
  }
  return { ok: true };
}

export function turnstileUserMessage(
  kind: "expired" | "error" | "missing" | "backend"
): string {
  switch (kind) {
    case "expired":
      return "A verificação expirou. Faça a validação novamente para continuar.";
    case "missing":
      return "Conclua a verificação de segurança antes de enviar.";
    default:
      return "Não foi possível concluir a verificação de segurança. Tente novamente.";
  }
}

export function publicFormJsonLooksSafe(serialized: string): boolean {
  const lowered = serialized.toLowerCase();
  if (lowered.includes("secretkey")) return false;
  if (lowered.includes("secret_key")) return false;
  if (lowered.includes("turnstilesecret")) return false;
  if (/"secret"\s*:/.test(lowered)) return false;
  return true;
}
