/**
 * PERM-30 — API canônica de permissão efetiva.
 *
 * Única autoridade de decisão: `resolveEffectiveAccess`.
 * Precedência: SUPER_ADMIN → unknown/unsupported DENY → ancestor view DENY →
 * DENY individual → ALLOW individual → snapshot do perfil | role → DENY default.
 *
 * Código novo NÃO deve ler `AppUser.permissions[]` para autorizar.
 * A bag só entra via `legacyCompatMode` (ponte temporária).
 */

import { projectLegacyBagToBaseline } from "./legacyCompat.ts";
import {
  canEffectiveAccess,
  canRevealNavigation,
  resolveEffectiveAccess,
} from "./resolveEffectiveAccess.ts";
import type {
  EffectiveAccessBaselineMap,
  EffectiveAccessInput,
  EffectiveAccessOverrideMap,
  EffectiveAccessResult,
} from "./types.ts";
import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";

/** Alias explícito — o resolvedor canônico é este. */
export const resolveCanonicalEffectiveAccess = resolveEffectiveAccess;

export const canCanonicalAccess = canEffectiveAccess;

export const canCanonicalRevealNavigation = canRevealNavigation;

export type CanonicalEffectiveAccessParts = {
  userId: string;
  role: string;
  permissionsVersion?: number | null;
  /** Overrides já no formato do contrato (ALLOW/DENY por ação). */
  overrides?: EffectiveAccessOverrideMap;
  /**
   * Snapshot do AccessProfile (contrato).
   * - `undefined` → usa preset da role
   * - objeto (mesmo `{}`) → substitui a role
   */
  profileSnapshot?: EffectiveAccessBaselineMap | null;
  /**
   * Ponte legada: só quando true a bag é projetada.
   * Default false — código novo não consulta AppUser.permissions[].
   */
  legacyCompatMode?: boolean;
  /** Só usado se legacyCompatMode=true. */
  legacyPermissions?: readonly string[];
};

/**
 * Fotografia do AccessProfile → baseline de contrato (1:1; sem mega-keys).
 * Lê `AccessProfile.permissions`, nunca `AppUser.permissions[]`.
 */
export function projectAccessProfilePermissionsToSnapshot(
  profilePermissions: readonly string[]
): EffectiveAccessBaselineMap {
  return projectLegacyBagToBaseline({
    legacyPermissions: profilePermissions,
    skipMegaKeys: true,
  }).grants;
}

/**
 * Monta o input canônico. Sem `legacyCompatMode`, a bag é ignorada.
 */
export function buildCanonicalEffectiveAccessInput(
  parts: CanonicalEffectiveAccessParts
): EffectiveAccessInput {
  const legacyCompatMode = parts.legacyCompatMode === true;

  return {
    userId: parts.userId,
    role: parts.role,
    permissionsVersion: parts.permissionsVersion ?? null,
    profileSnapshot: parts.profileSnapshot,
    overrides: parts.overrides ?? {},
    legacyPermissions: legacyCompatMode ? [...(parts.legacyPermissions ?? [])] : [],
    legacyCompatMode,
    legacySkipMegaKeys: true,
  };
}

/** Resolve a partir das partes canônicas (sem Prisma). */
export function resolveCanonicalAccessFromParts(
  parts: CanonicalEffectiveAccessParts
): EffectiveAccessResult {
  return resolveCanonicalEffectiveAccess(buildCanonicalEffectiveAccessInput(parts));
}

export function canCanonicalAccessFromParts(
  parts: CanonicalEffectiveAccessParts,
  resourceKey: string,
  action: PermissionContractAction | string
): boolean {
  const result = resolveCanonicalAccessFromParts(parts);
  return canCanonicalAccess(result, resourceKey, action);
}
