/**
 * Snapshot de avaliação para um AppUser autenticado.
 * Combina RolePermission (seed) + aliases do catálogo legado em AppUser.permissions.
 */

import { getEffectivePermissions } from "@/src/lib/appAuth.js";
import {
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
} from "@/src/lib/permissionResourceSeedData.js";
import { createSeedPermissionSnapshot } from "@/src/lib/security/permissionService.js";
import type {
  PermissionEvaluationSnapshot,
  PermissionSubject,
  UserPermissionOverrideGrant,
} from "@/src/lib/security/permissionTypes.js";
import type { AppUserRole } from "@prisma/client";

export type AuthPermissionInput = {
  id: string;
  role: AppUserRole;
  permissions?: string[];
  effectivePermissions?: string[];
  isActive?: boolean;
};

function seedByKey(): Map<string, PermissionResourceSeed> {
  return new Map(PERMISSION_RESOURCE_SEEDS.map((s) => [s.key, s]));
}

function isManageAlias(key: string): boolean {
  return (
    key === "users.manage" ||
    key === "accessProfiles.manage" ||
    /\.(manage|admin)$/.test(key)
  );
}

function isExecuteAlias(key: string): boolean {
  return /\.(execute|export|sync|create|apply)$/.test(key);
}

/**
 * Constrói snapshot: base por role (seed) + overrides derivados de chaves legadas.
 * Ao conceder um filho via alias, eleva `canView` dos ancestrais (senão a hierarquia bloquearia).
 * NÃO propaga view de MENU para TABs (ex.: só `finance.view` não libera aba).
 */
export function buildPermissionSnapshotForAuth(
  auth: AuthPermissionInput
): PermissionEvaluationSnapshot {
  const effective =
    auth.effectivePermissions ??
    getEffectivePermissions({
      role: auth.role,
      permissions: auth.permissions ?? [],
    });

  const base = createSeedPermissionSnapshot({
    role: auth.role,
    userId: auth.id,
  });

  const byKey = seedByKey();
  const overrideMap = new Map<string, UserPermissionOverrideGrant>();

  const ensureViewAncestor = (resourceKey: string) => {
    let parent = byKey.get(resourceKey)?.parentKey ?? null;
    while (parent) {
      const existing = overrideMap.get(parent);
      if (existing) {
        if (existing.canView !== true) existing.canView = true;
      } else {
        overrideMap.set(parent, {
          userId: auth.id,
          resourceKey: parent,
          canView: true,
          canExecute: null,
          canManage: null,
          reason: "legacy-alias-ancestor",
        });
      }
      parent = byKey.get(parent)?.parentKey ?? null;
    }
  };

  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    const hits = seed.legacyAliasKeys.filter((k) => effective.includes(k));
    if (hits.length === 0) continue;

    const canManage = hits.some(isManageAlias);
    const canExecute = hits.some(isExecuteAlias);
    const prev = overrideMap.get(seed.key);
    overrideMap.set(seed.key, {
      userId: auth.id,
      resourceKey: seed.key,
      canView: true,
      canExecute: canExecute ? true : (prev?.canExecute ?? null),
      canManage: canManage ? true : (prev?.canManage ?? null),
      reason: "legacy-alias",
    });
    ensureViewAncestor(seed.key);
  }

  return {
    resources: base.resources,
    rolePermissions: base.rolePermissions,
    overrides: [...base.overrides, ...overrideMap.values()],
  };
}

export function toAuthPermissionSubject(auth: AuthPermissionInput): PermissionSubject {
  return {
    id: auth.id,
    role: auth.role,
    isActive: auth.isActive,
  };
}
