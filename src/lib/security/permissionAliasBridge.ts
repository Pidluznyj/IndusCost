/**
 * Ponte PT legado ↔ resourceKey canônico para admin de permissões.
 * Garante que baseline, overrides e resumo usem a mesma identidade efetiva
 * que o resolvedor de runtime (relationalResourceKeys).
 */

import type { AppUserRole } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  type RolePermissionFlags,
} from "@/src/lib/permissionResourceSeedData.js";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";

function emptyFlags(): PermissionFlags {
  return { canView: false, canExecute: false, canManage: false };
}

function orFlags(a: PermissionFlags, b: PermissionFlags): PermissionFlags {
  return {
    canView: a.canView || b.canView,
    canExecute: a.canExecute || b.canExecute,
    canManage: a.canManage || b.canManage,
  };
}

/** Todas as chaves seed/contrato equivalentes a `resourceKey` (inclui ela mesma). */
export function listEquivalentPermissionKeys(resourceKey: string): string[] {
  const key = resourceKey.trim();
  if (!key) return [];
  const keys = new Set<string>([key]);
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    const rels = r.relationalResourceKeys ?? [];
    if (r.resourceKey === key || rels.includes(key)) {
      keys.add(r.resourceKey);
      for (const rel of rels) {
        if (rel.trim()) keys.add(rel.trim());
      }
    }
  }
  return [...keys].sort();
}

/** Aliases distintos da chave (para dual-write). */
export function listPermissionAliasKeys(resourceKey: string): string[] {
  return listEquivalentPermissionKeys(resourceKey).filter((k) => k !== resourceKey);
}

/**
 * Flags oficiais da role projetadas pela ponte PT↔canônico
 * (mesmo critério de `buildRoleBaselineFromSeed`).
 */
export function getBridgedOfficialRolePermissionFlags(
  role: AppUserRole,
  resourceKey: string
): RolePermissionFlags {
  if (role === "SUPER_ADMIN") {
    return { canView: true, canExecute: true, canManage: true };
  }
  let merged = emptyFlags();
  for (const key of listEquivalentPermissionKeys(resourceKey)) {
    merged = orFlags(merged, getOfficialRolePermissionFlags(role, key));
  }
  return merged;
}

type AxisOverride = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
};

/**
 * Resolve override efetivo para uma chave: considera aliases e DENY vence ALLOW.
 */
export function resolveBridgedOverride(
  overrides: readonly AxisOverride[],
  resourceKey: string
): AxisOverride | null {
  const equivalents = new Set(listEquivalentPermissionKeys(resourceKey));
  const matches = overrides.filter((o) => equivalents.has(o.resourceKey));
  if (matches.length === 0) return null;

  const pick = (axis: "canView" | "canExecute" | "canManage"): boolean | null => {
    let sawAllow = false;
    let sawNull = false;
    for (const m of matches) {
      const v = m[axis];
      if (v === false) return false;
      if (v === true) sawAllow = true;
      if (v === null || v === undefined) sawNull = true;
    }
    if (sawAllow) return true;
    if (sawNull) return null;
    return null;
  };

  return {
    resourceKey,
    canView: pick("canView"),
    canExecute: pick("canExecute"),
    canManage: pick("canManage"),
  };
}

/** Expande overrides para dual-write em todos os aliases equivalentes. */
export function expandOverridesToAliases<T extends AxisOverride>(
  overrides: readonly T[]
): T[] {
  const byKey = new Map<string, T>();
  for (const ov of overrides) {
    for (const key of listEquivalentPermissionKeys(ov.resourceKey)) {
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...ov, resourceKey: key });
        continue;
      }
      // Deny wins ao fundir dual-write.
      const mergeAxis = (a: boolean | null, b: boolean | null): boolean | null => {
        if (a === false || b === false) return false;
        if (a === true || b === true) return true;
        return null;
      };
      byKey.set(key, {
        ...prev,
        resourceKey: key,
        canView: mergeAxis(prev.canView, ov.canView),
        canExecute: mergeAxis(prev.canExecute, ov.canExecute),
        canManage: mergeAxis(prev.canManage, ov.canManage),
      });
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.resourceKey.localeCompare(b.resourceKey)
  );
}
