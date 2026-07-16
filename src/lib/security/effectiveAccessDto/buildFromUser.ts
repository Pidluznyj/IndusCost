/**
 * Monta DTO a partir de dados de AppUser (sem alterar sessão efetiva).
 */

import {
  resolveEffectiveAccess,
  type EffectiveAccessInput,
} from "@/src/lib/security/effectiveAccess/index.js";
import { buildEffectiveAccessDto } from "./buildEffectiveAccessDto.ts";
import { mapSeedAxisOverridesToContract, type SeedAxisOverride } from "./mapOverrides.ts";
import type { EffectiveAccessAdminDto, EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER } from "@/src/lib/effectiveAccessDtoTypes.js";

export type BuildEffectiveAccessDtoFromUserArgs = {
  userId: string;
  role: string;
  /** Bag AppUser.permissions[] */
  legacyPermissions?: readonly string[];
  overrides?: readonly SeedAxisOverride[];
  /**
   * Se definido, substitui role preset (ex.: {} para restrição absoluta).
   * Omitir no /me padrão → usa role preset.
   */
  profileSnapshot?: EffectiveAccessInput["profileSnapshot"];
  legacyCompatMode?: boolean;
  permissionsVersion?: number | null;
  audience?: "session" | "admin";
};

export function buildEffectiveAccessDtoFromUser(
  args: BuildEffectiveAccessDtoFromUserArgs
): EffectiveAccessMeDto | EffectiveAccessAdminDto {
  const legacy = args.legacyPermissions ?? [];
  const input: EffectiveAccessInput = {
    userId: args.userId,
    role: args.role,
    permissionsVersion:
      args.permissionsVersion ?? EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
    profileSnapshot: args.profileSnapshot,
    overrides: mapSeedAxisOverridesToContract(args.overrides ?? []),
    legacyPermissions: legacy,
    legacyCompatMode: args.legacyCompatMode === true,
    legacySkipMegaKeys: true,
  };

  const result = resolveEffectiveAccess(input);
  return buildEffectiveAccessDto({
    result,
    permissionsVersion: input.permissionsVersion,
    legacyPermissionsPresent: legacy.length > 0,
    audience: args.audience ?? "session",
  });
}
