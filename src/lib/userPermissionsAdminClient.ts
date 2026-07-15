/** Client HTTP — admin de permissões por usuário / presets. */

import { fetchJsonOk } from "@/src/lib/http";
import type { AppUserRole, AuthUser } from "@/src/lib/appAuthClient";

export type MatrixCellStatus = "allowed" | "blocked" | "partial";

export type AdminUserListItem = AuthUser & {
  hasCustomPermissions?: boolean;
  overrideCount?: number;
};

export type PermissionFlagsDto = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

export type EditableTreeNodeDto = {
  key: string;
  label: string;
  description: string;
  type: "MENU" | "SUBMENU" | "TAB" | "ACTION";
  module: string;
  parentKey: string | null;
  roleFlags: PermissionFlagsDto;
  override: {
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
  } | null;
  effectiveFlags: PermissionFlagsDto;
  children: EditableTreeNodeDto[];
};

export type UserPermissionsPayload = {
  user: {
    id: string;
    name: string;
    email: string;
    role: AppUserRole;
    isActive: boolean;
    lastLoginAt: string | null;
    permissions: string[];
  };
  isSuperAdmin: boolean;
  treeReadOnly: boolean;
  hasCustomPermissions: boolean;
  overrideCount: number;
  roleDefaults: Array<{ resourceKey: string; flags: PermissionFlagsDto }>;
  overrides: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason?: string | null;
  }>;
  effectiveFlags: Record<string, PermissionFlagsDto>;
  tree: EditableTreeNodeDto[];
  summary: {
    menusAllowed: string[];
    submenusAllowed: string[];
    tabsBlocked: string[];
    criticalActionsAllowed: string[];
  };
  diffVsRole: Array<{
    resourceKey: string;
    label: string;
    roleFlags: PermissionFlagsDto;
    effectiveFlags: PermissionFlagsDto;
    hasOverride: boolean;
    changed: boolean;
  }>;
  warnings: {
    editingSuperAdmin: boolean;
    isLastSuperAdmin: boolean;
  };
};

export type RoleMatrixRowDto = {
  resourceKey: string;
  label: string;
  type: string;
  parentKey: string | null;
  depth: number;
  cells: Array<{
    role: AppUserRole;
    status: MatrixCellStatus;
    flags: PermissionFlagsDto;
  }>;
};

export type PermissionPresetsPayload = {
  presets: Array<{
    role: AppUserRole;
    label: string;
    description: string;
  }>;
  matrix: RoleMatrixRowDto[];
};

export type PermissionAuditEntry = {
  id: string;
  action: string;
  resourceKey: string | null;
  targetRole: AppUserRole | null;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};

export async function fetchAdminUsersList(): Promise<AdminUserListItem[]> {
  const res = await fetchJsonOk<{ users: AdminUserListItem[] }>("/api/admin/users");
  return Array.isArray(res.users) ? res.users : [];
}

export async function fetchPermissionPresets(): Promise<PermissionPresetsPayload> {
  return fetchJsonOk<PermissionPresetsPayload>("/api/admin/permission-presets");
}

export async function reloadPermissionCatalog(): Promise<{ ok: boolean }> {
  return fetchJsonOk<{ ok: boolean }>("/api/admin/permissions/reload-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function fetchUserPermissions(userId: string): Promise<UserPermissionsPayload> {
  return fetchJsonOk<UserPermissionsPayload>(`/api/admin/users/${userId}/permissions`);
}

export async function saveUserPermissionOverrides(
  userId: string,
  overrides: Array<{
    resourceKey: string;
    canView?: boolean | null;
    canExecute?: boolean | null;
    canManage?: boolean | null;
  }>
): Promise<UserPermissionsPayload> {
  return fetchJsonOk<UserPermissionsPayload>(`/api/admin/users/${userId}/permission-overrides`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overrides }),
  });
}

export async function applyUserPermissionPreset(
  userId: string,
  body: { role?: AppUserRole; confirmClearOverrides?: boolean }
): Promise<UserPermissionsPayload> {
  return fetchJsonOk<UserPermissionsPayload>(
    `/api/admin/users/${userId}/permissions/apply-preset`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export async function restoreUserRoleDefault(
  userId: string,
  confirmClearOverrides: boolean
): Promise<UserPermissionsPayload> {
  return fetchJsonOk<UserPermissionsPayload>(
    `/api/admin/users/${userId}/permissions/restore-role-default`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmClearOverrides }),
    }
  );
}

export async function clearUserPermissionOverrides(
  userId: string,
  confirm: boolean
): Promise<UserPermissionsPayload> {
  return fetchJsonOk<UserPermissionsPayload>(
    `/api/admin/users/${userId}/permission-overrides?confirm=${confirm ? "1" : "0"}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    }
  );
}

export async function fetchUserPermissionAudit(
  userId: string
): Promise<PermissionAuditEntry[]> {
  const res = await fetchJsonOk<{ entries: PermissionAuditEntry[] }>(
    `/api/admin/users/${userId}/permission-audit`
  );
  return Array.isArray(res.entries) ? res.entries : [];
}

export async function deleteAdminUser(userId: string): Promise<{
  success: true;
  deletedUserId: string;
  email: string;
  name: string;
}> {
  return fetchJsonOk(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}
