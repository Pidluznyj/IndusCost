/**
 * Projeta preset oficial da role (seed PT) → baseline em resourceKeys do contrato.
 */

import type { AppUserRole } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  OFFICIAL_APP_USER_ROLES,
} from "@/src/lib/permissionResourceSeedData.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/resources.ts";
import type {
  PermissionContractAction,
  PermissionContractResource,
} from "@/src/lib/security/permissionContract/types.ts";
import type { EffectiveAccessBaselineMap } from "./types.ts";

function isAppUserRole(role: string): role is AppUserRole {
  // Lazy: evita TDZ se houver ciclo de import com o seed.
  return (OFFICIAL_APP_USER_ROLES as readonly string[]).includes(role);
}

/** Mapeia flags seed (3 eixos) → ações do contrato suportadas no recurso. */
export function seedFlagsToContractActions(
  resource: PermissionContractResource,
  flags: { canView: boolean; canExecute: boolean; canManage: boolean }
): Partial<Record<PermissionContractAction, true>> {
  const out: Partial<Record<PermissionContractAction, true>> = {};
  const supported = new Set(resource.actions.map((a) => a.action));
  if (flags.canView && supported.has("view")) out.view = true;
  if (flags.canExecute) {
    for (const a of [
      "execute",
      "create",
      "export",
      "approve",
      "close",
      "reopen",
      "reprocess",
    ] as const) {
      if (supported.has(a)) out[a] = true;
    }
  }
  if (flags.canManage) {
    for (const a of ["manage", "update", "delete"] as const) {
      if (supported.has(a)) out[a] = true;
    }
  }
  return out;
}

function orActions(
  into: Partial<Record<PermissionContractAction, true>>,
  add: Partial<Record<PermissionContractAction, true>>
): void {
  for (const [k, v] of Object.entries(add)) {
    if (v) into[k as PermissionContractAction] = true;
  }
}

/**
 * Baseline da role a partir do seed oficial, indexado por resourceKey canônico.
 * Recursos do contrato sem ponte no seed ficam vazios (não amplia).
 */
export function buildRoleBaselineFromSeed(
  role: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): EffectiveAccessBaselineMap {
  if (role === "SUPER_ADMIN") {
    // Bypass tratado no resolvedor; baseline vazio aqui.
    return {};
  }
  if (!isAppUserRole(role)) {
    return {};
  }

  const out: Record<string, Partial<Record<PermissionContractAction, true>>> = {};

  for (const resource of resources) {
    const candidateKeys = [
      resource.resourceKey,
      ...resource.relationalResourceKeys,
    ];
    let merged = {
      canView: false,
      canExecute: false,
      canManage: false,
    };
    for (const key of candidateKeys) {
      const flags = getOfficialRolePermissionFlags(role, key);
      merged = {
        canView: merged.canView || flags.canView,
        canExecute: merged.canExecute || flags.canExecute,
        canManage: merged.canManage || flags.canManage,
      };
    }
    const actions = seedFlagsToContractActions(resource, merged);
    if (Object.keys(actions).length > 0) {
      out[resource.resourceKey] = actions;
    }
  }

  return out;
}

export function mergeBaselines(
  ...maps: Array<EffectiveAccessBaselineMap | undefined | null>
): EffectiveAccessBaselineMap {
  const out: Record<string, Partial<Record<PermissionContractAction, true>>> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [resourceKey, actions] of Object.entries(map)) {
      if (!out[resourceKey]) out[resourceKey] = {};
      orActions(out[resourceKey]!, actions);
    }
  }
  return out;
}
