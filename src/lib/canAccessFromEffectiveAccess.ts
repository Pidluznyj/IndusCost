/**
 * PERM-30 — Decisão de acesso no frontend a partir do DTO canônico (`/me.effectiveAccess`).
 * Não lê `AppUser.permissions[]` / `effectivePermissions`.
 */

import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";

export type EffectiveAccessDtoLike = Pick<
  EffectiveAccessMeDto,
  | "isSuperAdmin"
  | "actionsByResource"
  | "allowedResources"
  | "navigationReveal"
  | "capabilities"
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

/**
 * Gate para `hasPermission("crm.view")` etc.: só true se alguma action do contrato
 * que lista essa chave legada estiver liberada no DTO. Sem DTO → caller usa bag.
 */
export function legacyPermissionGrantedByDto(
  dto: EffectiveAccessDtoLike | null | undefined,
  legacyPermissionKey: string
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const legacy = legacyPermissionKey.trim();
  if (!legacy) return false;

  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const a of r.actions) {
      if (!a.legacyPermissionKeys.includes(legacy)) continue;
      const listed = dto.actionsByResource[r.resourceKey];
      if (listed?.includes(a.action)) return true;
      const cap = dto.capabilities?.[r.resourceKey];
      if (!cap) continue;
      if (a.action === "view" && cap.canView) return true;
      if (a.action === "manage" && cap.canManage) return true;
      if (
        (a.action === "execute" ||
          a.action === "create" ||
          a.action === "export" ||
          a.action === "approve" ||
          a.action === "close" ||
          a.action === "reopen" ||
          a.action === "reprocess") &&
        cap.canExecute
      ) {
        return true;
      }
    }
  }
  return false;
}
