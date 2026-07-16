/**
 * Monta DTO a partir do resolvedor canônico (PERM-30).
 * Sem `legacyCompatMode`, não usa AppUser.permissions[] na decisão.
 */

import {
  buildCanonicalEffectiveAccessInput,
  projectAccessProfilePermissionsToSnapshot,
  resolveCanonicalEffectiveAccess,
  type EffectiveAccessInput,
} from "@/src/lib/security/effectiveAccess/index.js";
import { buildEffectiveAccessDto } from "./buildEffectiveAccessDto.ts";
import { mapSeedAxisOverridesToContract, type SeedAxisOverride } from "./mapOverrides.ts";
import type { EffectiveAccessAdminDto, EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER } from "@/src/lib/effectiveAccessDtoTypes.js";

export type BuildEffectiveAccessDtoFromUserArgs = {
  userId: string;
  role: string;
  /**
   * Bag AppUser.permissions[] — só entra na decisão se legacyCompatMode=true.
   * Código novo não deve depender dela.
   */
  legacyPermissions?: readonly string[];
  overrides?: readonly SeedAxisOverride[];
  /**
   * Snapshot do AccessProfile já em formato contrato, ou
   * permissões do perfil (bag do perfil — não do usuário) via accessProfilePermissions.
   */
  profileSnapshot?: EffectiveAccessInput["profileSnapshot"];
  /** Bag do AccessProfile (fotografia) — projetada para snapshot. */
  accessProfilePermissions?: readonly string[] | null;
  /** true = ponte bag; default false (canônico). */
  legacyCompatMode?: boolean;
  permissionsVersion?: number | null;
  audience?: "session" | "admin";
};

export function buildEffectiveAccessDtoFromUser(
  args: BuildEffectiveAccessDtoFromUserArgs
): EffectiveAccessMeDto | EffectiveAccessAdminDto {
  const legacyCompatMode = args.legacyCompatMode === true;
  const legacy = args.legacyPermissions ?? [];

  let profileSnapshot = args.profileSnapshot;
  if (
    profileSnapshot === undefined &&
    args.accessProfilePermissions != null
  ) {
    profileSnapshot = projectAccessProfilePermissionsToSnapshot(
      args.accessProfilePermissions
    );
  }

  const input = buildCanonicalEffectiveAccessInput({
    userId: args.userId,
    role: args.role,
    permissionsVersion:
      args.permissionsVersion ?? EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
    profileSnapshot,
    overrides: mapSeedAxisOverridesToContract(args.overrides ?? []),
    legacyCompatMode,
    legacyPermissions: legacy,
  });

  const result = resolveCanonicalEffectiveAccess(input);
  return buildEffectiveAccessDto({
    result,
    permissionsVersion: input.permissionsVersion,
    legacyPermissionsPresent: legacy.length > 0,
    /** Decisão canônica: bag não é autoridade quando compat off. */
    legacyBagAuthoritative: legacyCompatMode,
    audience: args.audience ?? "session",
  });
}
