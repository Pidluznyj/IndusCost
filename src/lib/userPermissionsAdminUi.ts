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
import { buildPersistableOverridesFromDraft } from "@/src/lib/security/permissionOverrideValidate";
import type { OverridePersistMode } from "@/src/lib/security/permissionOverrideState";

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
      u.role.toLowerCase().includes(q) ||
      (u.employeeName?.toLowerCase().includes(q) ?? false) ||
      (u.employeeDepartment?.toLowerCase().includes(q) ?? false)
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
  roleDefaults: Array<{ resourceKey: string; flags: PermissionFlagsDto }>,
  mode: OverridePersistMode = "differential"
): Array<{
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
}> {
  return buildPersistableOverridesFromDraft({
    draft,
    roleDefaults: roleDefaults.map((r) => ({
      resourceKey: r.resourceKey,
      flags: r.flags,
    })),
    mode,
  });
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

/** Rótulos amigáveis para o tipo hierárquico (evitar MENU/TAB crus na UI). */
export function permissionResourceTypeLabel(
  type: "MENU" | "SUBMENU" | "TAB" | "ACTION" | string
): string {
  switch (type) {
    case "MENU":
      return "Menu";
    case "SUBMENU":
      return "Submenu";
    case "TAB":
      return "Aba";
    case "ACTION":
      return "Ação";
    default:
      return type;
  }
}

/** Resumo legível de flags Ver/Executar/Gerenciar. */
export function formatPermissionFlagsHuman(flags: {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
}): string {
  const parts: string[] = [];
  parts.push(flags.canView ? "Ver" : "Sem ver");
  if (flags.canExecute) parts.push("Executar");
  if (flags.canManage) parts.push("Gerenciar");
  return parts.join(" · ");
}

export function flattenPermissionTreeLabels(
  tree: readonly EditableTreeNodeDto[]
): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: readonly EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      map.set(n.key, n.label);
      walk(n.children);
    }
  };
  walk(tree);
  return map;
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
