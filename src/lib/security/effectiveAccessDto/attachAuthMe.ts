/**
 * Anexo de effectiveAccess em respostas /api/auth/me (P04 / PERM-30).
 * Default ON — desligar com EFFECTIVE_ACCESS_DTO_IN_ME=0.
 */

import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { buildEffectiveAccessDtoFromUser } from "./buildFromUser.ts";
import {
  isEffectiveAccessDtoInMeEnabled,
  isEffectiveAccessDtoLegacyCompatEnabled,
} from "./flags.ts";
import type { SeedAxisOverride } from "./mapOverrides.ts";

export type AuthMeUserForEffectiveAccess = {
  id: string;
  role: string;
  /** Bag — só usada se EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT=1. */
  permissions?: string[];
  permissionsVersion?: number | null;
  /** Bag do AccessProfile vinculado (fotografia), não AppUser.permissions. */
  accessProfilePermissions?: string[] | null;
};

/**
 * Retorna o DTO canônico para /me, ou null se a flag estiver off.
 * Nunca lança — falha vira null + log do caller.
 */
export function tryBuildEffectiveAccessForAuthMe(args: {
  user: AuthMeUserForEffectiveAccess;
  overrides?: readonly SeedAxisOverride[];
  env?: NodeJS.ProcessEnv;
}): EffectiveAccessMeDto | null {
  const env = args.env ?? process.env;
  if (!isEffectiveAccessDtoInMeEnabled(env)) return null;

  const legacyCompat = isEffectiveAccessDtoLegacyCompatEnabled(env);

  return buildEffectiveAccessDtoFromUser({
    userId: args.user.id,
    role: args.user.role,
    legacyPermissions: legacyCompat ? (args.user.permissions ?? []) : [],
    overrides: args.overrides ?? [],
    accessProfilePermissions: args.user.accessProfilePermissions,
    legacyCompatMode: legacyCompat,
    permissionsVersion: args.user.permissionsVersion,
    audience: "session",
  }) as EffectiveAccessMeDto;
}
