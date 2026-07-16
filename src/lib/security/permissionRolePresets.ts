/**
 * Presets oficiais por role + matriz de comparação (fonte: permissionResourceSeedData).
 * Não altera filtro de dados por vendedor — só flags de tela/ação.
 */

import type { AppUserRole } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  OFFICIAL_APP_USER_ROLES,
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
  type RolePermissionFlags,
} from "@/src/lib/permissionResourceSeedData.js";
import type {
  PermissionFlags,
  UserPermissionOverrideGrant,
} from "@/src/lib/security/permissionTypes.js";
import { materializeLegacyBagFromEffectiveFlags } from "@/src/lib/security/permissionDualWrite/service.ts";

export type MatrixCellStatus = "allowed" | "blocked" | "partial";

export type RolePresetResourceRow = {
  resourceKey: string;
  label: string;
  type: PermissionResourceSeed["type"];
  parentKey: string | null;
  module: string;
  depth: number;
  flags: PermissionFlags;
};

export type OfficialRolePreset = {
  role: AppUserRole;
  label: string;
  description: string;
  resources: RolePresetResourceRow[];
};

export type RoleMatrixCell = {
  role: AppUserRole;
  status: MatrixCellStatus;
  flags: PermissionFlags;
};

export type RoleMatrixRow = {
  resourceKey: string;
  label: string;
  type: PermissionResourceSeed["type"];
  parentKey: string | null;
  depth: number;
  cells: RoleMatrixCell[];
};

export type UserVsRoleDiffItem = {
  resourceKey: string;
  label: string;
  roleFlags: PermissionFlags;
  effectiveFlags: PermissionFlags;
  hasOverride: boolean;
  changed: boolean;
};

const ROLE_META: Record<AppUserRole, { label: string; description: string }> = {
  SUPER_ADMIN: {
    label: "Super Administrador",
    description: "Acesso total ao sistema (bypass).",
  },
  ADMIN: {
    label: "Administrador",
    description: "Acesso amplo; ações críticas de ACL não vêm por padrão.",
  },
  COMMERCIAL_MANAGER: {
    label: "Gestor Comercial",
    description: "Comercial e comissões; sem admin/permissões/financeiro.",
  },
  SELLER: {
    label: "Vendedor",
    description: "Comercial limitado; filtro de dados por vendedor continua separado.",
  },
  VIEWER: {
    label: "Visualizador",
    description: "Somente leitura nas áreas autorizadas.",
  },
};

function depthOf(seed: PermissionResourceSeed, byKey: Map<string, PermissionResourceSeed>): number {
  let d = 0;
  let parent = seed.parentKey;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    d += 1;
    parent = byKey.get(parent)?.parentKey ?? null;
  }
  return d;
}

export function flagsEqual(a: PermissionFlags, b: PermissionFlags): boolean {
  return a.canView === b.canView && a.canExecute === b.canExecute && a.canManage === b.canManage;
}

export function resolveMatrixCellStatus(flags: PermissionFlags): MatrixCellStatus {
  const any = flags.canView || flags.canExecute || flags.canManage;
  if (!any) return "blocked";
  if (flags.canView && flags.canExecute && flags.canManage) return "allowed";
  if (flags.canView && !flags.canExecute && !flags.canManage) return "allowed";
  if (flags.canView) return "partial";
  return "partial";
}

export function mergeRoleAndOverrideFlags(
  roleFlags: PermissionFlags,
  override: Pick<UserPermissionOverrideGrant, "canView" | "canExecute" | "canManage"> | null | undefined
): PermissionFlags {
  if (!override) return { ...roleFlags };
  return {
    canView: override.canView ?? roleFlags.canView,
    canExecute: override.canExecute ?? roleFlags.canExecute,
    canManage: override.canManage ?? roleFlags.canManage,
  };
}

export function getOfficialRolePreset(role: AppUserRole): OfficialRolePreset {
  const byKey = new Map(PERMISSION_RESOURCE_SEEDS.map((s) => [s.key, s]));
  const meta = ROLE_META[role];
  const resources: RolePresetResourceRow[] = [...PERMISSION_RESOURCE_SEEDS]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((seed) => ({
      resourceKey: seed.key,
      label: seed.label,
      type: seed.type,
      parentKey: seed.parentKey,
      module: seed.module,
      depth: depthOf(seed, byKey),
      flags: getOfficialRolePermissionFlags(role, seed.key),
    }));
  return {
    role,
    label: meta.label,
    description: meta.description,
    resources,
  };
}

export function listOfficialRolePresets(
  roles: readonly AppUserRole[] = OFFICIAL_APP_USER_ROLES
): OfficialRolePreset[] {
  return roles.map((role) => getOfficialRolePreset(role));
}

/** Matriz roles × menus/submenus/abas (ACTION opcional via includeActions). */
export function buildRolePermissionMatrixRows(options?: {
  includeActions?: boolean;
  roles?: readonly AppUserRole[];
}): RoleMatrixRow[] {
  const includeActions = options?.includeActions === true;
  const roles = options?.roles ?? OFFICIAL_APP_USER_ROLES;
  const byKey = new Map(PERMISSION_RESOURCE_SEEDS.map((s) => [s.key, s]));
  return [...PERMISSION_RESOURCE_SEEDS]
    .filter((s) => includeActions || s.type !== "ACTION")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((seed) => {
      const cells: RoleMatrixCell[] = roles.map((role) => {
        const flags = getOfficialRolePermissionFlags(role, seed.key);
        return {
          role,
          flags,
          status: role === "SUPER_ADMIN" ? "allowed" : resolveMatrixCellStatus(flags),
        };
      });
      return {
        resourceKey: seed.key,
        label: seed.label,
        type: seed.type,
        parentKey: seed.parentKey,
        depth: depthOf(seed, byKey),
        cells,
      };
    });
}

/**
 * Efetivo = baseline ⊕ override (null = INHERIT).
 * `baselineFlagsByKey` opcional: snapshot do AccessProfile (substitui preset da role).
 */
export function buildEffectiveFlagsMap(
  role: AppUserRole,
  overrides: readonly UserPermissionOverrideGrant[],
  baselineFlagsByKey?: Readonly<Record<string, PermissionFlags>> | null
): Record<string, PermissionFlags> {
  const overrideByKey = new Map(overrides.map((o) => [o.resourceKey, o]));
  const out: Record<string, PermissionFlags> = {};
  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    const baseline =
      baselineFlagsByKey?.[seed.key] ?? getOfficialRolePermissionFlags(role, seed.key);
    out[seed.key] = mergeRoleAndOverrideFlags(baseline, overrideByKey.get(seed.key));
  }
  return out;
}

export function diffUserAgainstRolePreset(args: {
  role: AppUserRole;
  overrides: readonly UserPermissionOverrideGrant[];
  effective?: Record<string, PermissionFlags>;
  /** Quando informado (ex.: snapshot de perfil), diff vs este baseline e não vs role seed. */
  baselineFlagsByKey?: Readonly<Record<string, PermissionFlags>> | null;
}): UserVsRoleDiffItem[] {
  const effective =
    args.effective ??
    buildEffectiveFlagsMap(args.role, args.overrides, args.baselineFlagsByKey);
  const overrideKeys = new Set(args.overrides.map((o) => o.resourceKey));
  const items: UserVsRoleDiffItem[] = [];
  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    const roleFlags =
      args.baselineFlagsByKey?.[seed.key] ??
      getOfficialRolePermissionFlags(args.role, seed.key);
    const effectiveFlags = effective[seed.key] ?? roleFlags;
    const hasOverride = overrideKeys.has(seed.key);
    const changed = hasOverride || !flagsEqual(roleFlags, effectiveFlags);
    if (!changed) continue;
    items.push({
      resourceKey: seed.key,
      label: seed.label,
      roleFlags,
      effectiveFlags,
      hasOverride,
      changed: true,
    });
  }
  return items;
}

/**
 * Materializa AppUser.permissions[] a partir das flags efetivas (dual-write P06).
 * Idempotente; aliases 1:1; deny remove chave mapeada; preserva unmapped de catálogo.
 * Não injeta baseline de role — o mapa `effectiveByKey` é a fonte.
 */
export function materializeLegacyPermissionsFromFlags(
  effectiveByKey: Record<string, PermissionFlags>,
  previousLegacyPermissions: readonly string[] = []
): string[] {
  return materializeLegacyBagFromEffectiveFlags(
    effectiveByKey,
    previousLegacyPermissions
  );
}

export type ApplyPresetPlan = {
  role: AppUserRole;
  legacyPermissions: string[];
  clearOverrideKeys: string[];
  hasCustomOverrides: boolean;
  requiresConfirmation: boolean;
  unchanged: boolean;
};

/** Plano idempotente para aplicar preset — não remove override sem confirmação. */
export function planApplyRolePreset(args: {
  role: AppUserRole;
  currentOverrides: readonly UserPermissionOverrideGrant[];
  currentLegacyPermissions: readonly string[];
  confirmClearOverrides?: boolean;
}): ApplyPresetPlan | { error: "CONFIRM_CLEAR_OVERRIDES_REQUIRED"; overrideCount: number } {
  const hasCustomOverrides = args.currentOverrides.length > 0;
  if (hasCustomOverrides && !args.confirmClearOverrides) {
    return {
      error: "CONFIRM_CLEAR_OVERRIDES_REQUIRED",
      overrideCount: args.currentOverrides.length,
    };
  }

  const effective = buildEffectiveFlagsMap(args.role, []);
  const legacyPermissions = materializeLegacyPermissionsFromFlags(
    effective,
    args.currentLegacyPermissions
  );
  const clearOverrideKeys = args.currentOverrides.map((o) => o.resourceKey);

  const legacySame =
    legacyPermissions.length === args.currentLegacyPermissions.length &&
    legacyPermissions.every((k) => args.currentLegacyPermissions.includes(k));
  const unchanged = clearOverrideKeys.length === 0 && legacySame;

  return {
    role: args.role,
    legacyPermissions,
    clearOverrideKeys,
    hasCustomOverrides,
    requiresConfirmation: false,
    unchanged,
  };
}

export function buildPermissionAccessSummary(args: {
  role: AppUserRole;
  effective: Record<string, PermissionFlags>;
}): {
  menusAllowed: string[];
  submenusAllowed: string[];
  tabsBlocked: string[];
  criticalActionsAllowed: string[];
} {
  const menusAllowed: string[] = [];
  const submenusAllowed: string[] = [];
  const tabsBlocked: string[] = [];
  const criticalActionsAllowed: string[] = [];

  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    const flags = args.effective[seed.key] ?? getOfficialRolePermissionFlags(args.role, seed.key);
    const allowed = flags.canView || flags.canExecute || flags.canManage;
    if (seed.type === "MENU" && allowed) menusAllowed.push(seed.label);
    if (seed.type === "SUBMENU" && allowed) submenusAllowed.push(seed.label);
    if (seed.type === "TAB" && !allowed) tabsBlocked.push(seed.label);
    if (
      seed.type === "ACTION" &&
      (flags.canManage || seed.key === "admin.permissoes.action.manage") &&
      allowed
    ) {
      criticalActionsAllowed.push(seed.label);
    }
  }

  return { menusAllowed, submenusAllowed, tabsBlocked, criticalActionsAllowed };
}

export { OFFICIAL_APP_USER_ROLES, ROLE_META };
