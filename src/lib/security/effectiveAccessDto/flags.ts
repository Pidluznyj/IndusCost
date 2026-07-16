/**
 * Flag segura para anexar `effectiveAccess` em GET /api/auth/me (P04).
 * Default OFF — sessão/auth efetiva inalterada.
 */

export function parseEnvFlag(raw: string | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Anexa bloco effectiveAccess no /me. */
export function isEffectiveAccessDtoInMeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseEnvFlag(env.EFFECTIVE_ACCESS_DTO_IN_ME);
}

/**
 * Se true, o builder do /me projeta a bag via aliases 1:1 no DTO shadow.
 * Não altera a autoridade da bag no runtime.
 */
export function isEffectiveAccessDtoLegacyCompatEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseEnvFlag(env.EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT);
}
