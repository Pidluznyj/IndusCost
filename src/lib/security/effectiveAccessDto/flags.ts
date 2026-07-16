/**
 * Flags do DTO de acesso efetivo (P04 / PERM-30).
 */

export function parseEnvFlag(raw: string | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Anexa bloco effectiveAccess no /me.
 * PERM-30: default ON (ausente = true). Desligar: EFFECTIVE_ACCESS_DTO_IN_ME=0.
 */
export function isEffectiveAccessDtoInMeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.EFFECTIVE_ACCESS_DTO_IN_ME;
  if (raw == null || raw.trim() === "") return true;
  return parseEnvFlag(raw);
}

/**
 * Se true, o builder do /me projeta a bag via aliases 1:1 (ponte).
 * Default OFF — decisão canônica sem AppUser.permissions[].
 */
export function isEffectiveAccessDtoLegacyCompatEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseEnvFlag(env.EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT);
}
