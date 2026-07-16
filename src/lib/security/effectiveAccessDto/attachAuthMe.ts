/**
 * Anexo opcional de effectiveAccess em respostas /api/auth/me (P04).
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
  permissions: string[];
};

/**
 * Retorna o DTO shadow para /me, ou null se a flag estiver off.
 * Nunca lança — falha vira null + log do caller.
 */
export function tryBuildEffectiveAccessForAuthMe(args: {
  user: AuthMeUserForEffectiveAccess;
  overrides?: readonly SeedAxisOverride[];
  env?: NodeJS.ProcessEnv;
}): EffectiveAccessMeDto | null {
  const env = args.env ?? process.env;
  if (!isEffectiveAccessDtoInMeEnabled(env)) return null;

  return buildEffectiveAccessDtoFromUser({
    userId: args.user.id,
    role: args.user.role,
    legacyPermissions: args.user.permissions,
    overrides: args.overrides ?? [],
    legacyCompatMode: isEffectiveAccessDtoLegacyCompatEnabled(env),
    audience: "session",
  }) as EffectiveAccessMeDto;
}
