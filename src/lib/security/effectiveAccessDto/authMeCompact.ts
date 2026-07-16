/**
 * PERM-31 — Contrato compacto de GET /api/auth/me para o frontend.
 *
 * Entrega: usuário (slim) + role + permissionsVersion + perfil aplicado +
 * recursos/capacidades efetivos. Sem internals do resolver, auditoria ou
 * payload completo de perfil.
 */

import type { AppUser, AppUserRole } from "@prisma/client";
import {
  toSafeAppUser,
  type SafeAppUser,
  type SafeAppUserOptions,
} from "@/src/lib/appAuth.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { buildEffectiveAccessDtoFromUser } from "./buildFromUser.ts";
import {
  isEffectiveAccessDtoInMeEnabled,
  isEffectiveAccessDtoLegacyCompatEnabled,
} from "./flags.ts";
import type { SeedAxisOverride } from "./mapOverrides.ts";
import {
  getCachedEffectiveAccessDto,
  setCachedEffectiveAccessDto,
} from "@/src/lib/permissionsVersion.js";

export type AuthMeAppliedProfile = {
  id: string;
  name: string;
};

/** Bloco ACL compacto no /me (estende DTO P04 com perfil aplicado). */
export type AuthMeEffectiveAccess = EffectiveAccessMeDto & {
  appliedProfile: AuthMeAppliedProfile | null;
};

export type AuthMeCompactResponse = {
  authenticated: true;
  user: SafeAppUser;
  effectiveAccess: AuthMeEffectiveAccess;
};

export type BuildAuthMeCompactArgs = {
  user: AppUser & {
    accessProfile?: {
      id: string;
      name: string;
      permissions?: string[];
    } | null;
  };
  safeUserOptions?: SafeAppUserOptions;
  overrides?: readonly SeedAxisOverride[];
  /** Bag do perfil (servidor) — nunca ecoada no JSON. */
  accessProfilePermissions?: readonly string[] | null;
  env?: NodeJS.ProcessEnv;
};

/**
 * Monta SafeAppUser para sessão: SUPER_ADMIN sem catálogo expandido;
 * bags legadas só quando ainda necessárias (não-SA / ponte).
 */
export function toSessionSafeAppUser(
  user: AppUser,
  options: SafeAppUserOptions = {}
): SafeAppUser {
  return toSafeAppUser(user, { ...options, sessionCompact: true });
}

export function buildAuthMeEffectiveAccess(args: {
  userId: string;
  role: AppUserRole | string;
  permissionsVersion: number;
  legacyPermissions?: readonly string[];
  overrides?: readonly SeedAxisOverride[];
  accessProfilePermissions?: readonly string[] | null;
  appliedProfile: AuthMeAppliedProfile | null;
  legacyCompatMode?: boolean;
}): AuthMeEffectiveAccess {
  const cacheKeyVersion = args.permissionsVersion;
  const cached = getCachedEffectiveAccessDto<AuthMeEffectiveAccess>(
    args.userId,
    cacheKeyVersion
  );
  if (cached) return cached;

  const dto = buildEffectiveAccessDtoFromUser({
    userId: args.userId,
    role: args.role,
    legacyPermissions: args.legacyPermissions ?? [],
    overrides: args.overrides ?? [],
    accessProfilePermissions: args.accessProfilePermissions,
    legacyCompatMode: args.legacyCompatMode === true,
    permissionsVersion: args.permissionsVersion,
    audience: "session",
  }) as EffectiveAccessMeDto;

  const compact: AuthMeEffectiveAccess = {
    ...dto,
    appliedProfile: args.appliedProfile,
    compatibility: {
      ...dto.compatibility,
      mode: "session",
    },
  };

  setCachedEffectiveAccessDto(args.userId, cacheKeyVersion, compact);
  return compact;
}

/**
 * Resposta autenticada compacta de /me (ou null se DTO desligado).
 */
export function tryBuildAuthMeCompactResponse(
  args: BuildAuthMeCompactArgs
): AuthMeCompactResponse | null {
  const env = args.env ?? process.env;
  if (!isEffectiveAccessDtoInMeEnabled(env)) return null;

  const user = args.user;
  const permissionsVersion =
    typeof (user as { permissionsVersion?: number }).permissionsVersion === "number"
      ? (user as { permissionsVersion: number }).permissionsVersion
      : 0;

  const appliedProfile: AuthMeAppliedProfile | null =
    user.accessProfile?.id && user.accessProfile?.name
      ? { id: user.accessProfile.id, name: user.accessProfile.name }
      : null;

  const profilePerms =
    args.accessProfilePermissions ??
    (user.accessProfile?.permissions
      ? user.accessProfile.permissions
      : null);

  const effectiveAccess = buildAuthMeEffectiveAccess({
    userId: user.id,
    role: user.role,
    permissionsVersion,
    legacyPermissions: isEffectiveAccessDtoLegacyCompatEnabled(env)
      ? (user.permissions as string[])
      : [],
    overrides: args.overrides,
    accessProfilePermissions: profilePerms,
    appliedProfile,
    legacyCompatMode: isEffectiveAccessDtoLegacyCompatEnabled(env),
  });

  const safeUser = toSessionSafeAppUser(user, {
    ...args.safeUserOptions,
    accessProfileName:
      args.safeUserOptions?.accessProfileName ??
      appliedProfile?.name ??
      null,
  });

  return {
    authenticated: true,
    user: safeUser,
    effectiveAccess,
  };
}
