/**
 * Helpers UI do workbench Usuários e Permissões (puros / testáveis).
 */

import type { AppUserRole } from "@/src/lib/appAuthClient";
import type {
  AdminUserListItem,
  EditableTreeNodeDto,
  MatrixCellStatus,
  PermissionFlagsDto,
} from "@/src/lib/userPermissionsAdminClient";

export type AdminUsersListFilters = {
  search: string;
  role: AppUserRole | "ALL";
  active: "ALL" | "ACTIVE" | "INACTIVE";
  customOnly: boolean;
};

export function filterAdminUsersList(
  users: readonly AdminUserListItem[],
  filters: AdminUsersListFilters
): AdminUserListItem[] {
  const q = filters.search.trim().toLowerCase();
  return users.filter((u) => {
    if (filters.role !== "ALL" && u.role !== filters.role) return false;
    if (filters.active === "ACTIVE" && !u.isActive) return false;
    if (filters.active === "INACTIVE" && u.isActive) return false;
    if (filters.customOnly && !u.hasCustomPermissions) return false;
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });
}

export type DraftOverrideMap = Record<
  string,
  { canView: boolean; canExecute: boolean; canManage: boolean }
>;

export function draftFromPayloadTree(tree: EditableTreeNodeDto[]): DraftOverrideMap {
  const out: DraftOverrideMap = {};
  const walk = (nodes: EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      out[n.key] = { ...n.effectiveFlags };
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function overridesPayloadFromDraft(
  draft: DraftOverrideMap,
  roleDefaults: Array<{ resourceKey: string; flags: PermissionFlagsDto }>
): Array<{
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
}> {
  const defaults = new Map(roleDefaults.map((r) => [r.resourceKey, r.flags]));
  const out: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
  }> = [];
  for (const [resourceKey, flags] of Object.entries(draft)) {
    const base = defaults.get(resourceKey) ?? {
      canView: false,
      canExecute: false,
      canManage: false,
    };
    const canView = flags.canView === base.canView ? null : flags.canView;
    const canExecute = flags.canExecute === base.canExecute ? null : flags.canExecute;
    const canManage = flags.canManage === base.canManage ? null : flags.canManage;
    if (canView === null && canExecute === null && canManage === null) continue;
    out.push({ resourceKey, canView, canExecute, canManage });
  }
  return out;
}

export function isPermissionDraftDirty(
  draft: DraftOverrideMap,
  roleDefaults: Array<{ resourceKey: string; flags: PermissionFlagsDto }>,
  baselineOverrides: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
  }>
): boolean {
  const next = overridesPayloadFromDraft(draft, roleDefaults);
  const norm = (
    rows: Array<{
      resourceKey: string;
      canView: boolean | null;
      canExecute: boolean | null;
      canManage: boolean | null;
    }>
  ) =>
    JSON.stringify(
      [...rows]
        .map((r) => ({
          resourceKey: r.resourceKey,
          canView: r.canView,
          canExecute: r.canExecute,
          canManage: r.canManage,
        }))
        .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey))
    );
  return norm(next) !== norm(baselineOverrides);
}

export function collectTreeKeys(tree: EditableTreeNodeDto[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      keys.push(n.key);
      walk(n.children);
    }
  };
  walk(tree);
  return keys;
}

export function filterTreeBySearch(
  tree: EditableTreeNodeDto[],
  search: string
): EditableTreeNodeDto[] {
  const q = search.trim().toLowerCase();
  if (!q) return tree;
  const filterNodes = (nodes: EditableTreeNodeDto[]): EditableTreeNodeDto[] => {
    const out: EditableTreeNodeDto[] = [];
    for (const n of nodes) {
      const children = filterNodes(n.children);
      const selfMatch =
        n.label.toLowerCase().includes(q) ||
        n.key.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q);
      if (selfMatch || children.length > 0) {
        out.push({ ...n, children: selfMatch ? n.children : children });
      }
    }
    return out;
  };
  return filterNodes(tree);
}

export function setModuleFlags(
  draft: DraftOverrideMap,
  tree: EditableTreeNodeDto[],
  moduleRootKey: string,
  flags: PermissionFlagsDto
): DraftOverrideMap {
  const next = { ...draft };
  const walk = (nodes: EditableTreeNodeDto[], under = false) => {
    for (const n of nodes) {
      const match = under || n.key === moduleRootKey;
      if (match) next[n.key] = { ...flags };
      walk(n.children, match);
    }
  };
  walk(tree);
  return next;
}

export function matrixStatusLabel(status: MatrixCellStatus): string {
  if (status === "allowed") return "Permitido";
  if (status === "blocked") return "Bloqueado";
  return "Parcial";
}

export function wouldRemoveOwnUsersManage(args: {
  isEditingSelf: boolean;
  existingRole: AppUserRole;
  draft: DraftOverrideMap;
  roleDefaults: Array<{ resourceKey: string; flags: PermissionFlagsDto }>;
}): boolean {
  if (!args.isEditingSelf) return false;
  if (args.existingRole === "SUPER_ADMIN") return false;
  const next = overridesPayloadFromDraft(args.draft, args.roleDefaults);
  const effective = { ...Object.fromEntries(args.roleDefaults.map((r) => [r.resourceKey, r.flags])) };
  for (const ov of next) {
    const base = effective[ov.resourceKey] ?? {
      canView: false,
      canExecute: false,
      canManage: false,
    };
    effective[ov.resourceKey] = {
      canView: ov.canView ?? base.canView,
      canExecute: ov.canExecute ?? base.canExecute,
      canManage: ov.canManage ?? base.canManage,
    };
  }
  const adminUsers = effective["admin.usuarios"];
  return !(adminUsers?.canManage || adminUsers?.canView);
}
