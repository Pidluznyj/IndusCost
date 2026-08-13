/**
 * Contrato puro da elevação administrativa temporária (step-up).
 * Sem crypto, Express ou Prisma — seguro no bundle frontend.
 *
 * Distinto de:
 *  - sessão principal (`induscost_session`)
 *  - bootstrap de recuperação (`induscost_bootstrap_admin`)
 */

export const ADMIN_ELEVATION_COOKIE_NAME = "induscost_admin_elevation";
export const ADMIN_ELEVATION_TTL_MS = 15 * 60 * 1000;
export const ADMIN_ELEVATION_PURPOSE = "adminElevation" as const;

export const ADMIN_ELEVATION_REQUIRED_CODE = "ADMIN_ELEVATION_REQUIRED";
export const BOOTSTRAP_ADMIN_REQUIRED_CODE = "BOOTSTRAP_ADMIN_REQUIRED";

/** 401 que NÃO significam sessão principal inválida. */
export const NON_SESSION_UNAUTHORIZED_CODES = [
  BOOTSTRAP_ADMIN_REQUIRED_CODE,
  "INVALID_CREDENTIALS",
] as const;

export type NonSessionUnauthorizedCode =
  (typeof NON_SESSION_UNAUTHORIZED_CODES)[number];

export function isNonSessionUnauthorizedCode(
  code: string | undefined
): code is NonSessionUnauthorizedCode {
  if (!code) return false;
  return (NON_SESSION_UNAUTHORIZED_CODES as readonly string[]).includes(code);
}

export type AdminElevationStatus = {
  active: boolean;
  expiresAt: string | null;
  ttlMs: number;
};
