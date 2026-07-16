/**
 * PERM-30 — Decisão de acesso no frontend a partir do DTO canônico (`/me.effectiveAccess`).
 * Não lê `AppUser.permissions[]` / `effectivePermissions`.
 */

import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";

export type EffectiveAccessDtoLike = Pick<
  EffectiveAccessMeDto,
  "isSuperAdmin" | "actionsByResource" | "allowedResources" | "navigationReveal"
>;

/**
 * Decide allow/deny para resourceKey × action usando o DTO produzido pelo resolvedor canônico.
 * Ausência de grant = DENY (exceto SUPER_ADMIN).
 */
export function canAccessFromEffectiveAccessDto(
  dto: EffectiveAccessDtoLike | null | undefined,
  resourceKey: string,
  action: string = "view"
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const key = resourceKey.trim();
  if (!key) return false;
  const act = action.trim().toLowerCase();
  if (!act) return false;
  const actions = dto.actionsByResource[key];
  if (!actions || actions.length === 0) return false;
  return actions.includes(act as (typeof actions)[number]);
}

/** Navegação / accordion a partir do DTO canônico. */
export function canRevealFromEffectiveAccessDto(
  dto: EffectiveAccessDtoLike | null | undefined,
  resourceKey: string
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const key = resourceKey.trim();
  if (!key) return false;
  return dto.navigationReveal.includes(key);
}
