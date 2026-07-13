/**
 * Tipos do motor relacional de permissões (MENU → SUBMENU → TAB → ACTION).
 * Independente do catálogo legado `permissionCatalog.ts` (chaves *.view).
 */

import type { AppUserRole } from "@prisma/client";

export type PermissionResourceType = "MENU" | "SUBMENU" | "TAB" | "ACTION";

/** Ações do modelo relacional (flags RolePermission / Override). */
export type PermissionAction = "view" | "execute" | "manage";

/** Aliases aceitos na API do motor → flag canônica. */
export type PermissionActionInput =
  | PermissionAction
  | "read"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "admin";

export type PermissionFlags = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

export type PermissionResourceNode = {
  key: string;
  label: string;
  description: string | null;
  type: PermissionResourceType;
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
};

export type RolePermissionGrant = {
  role: AppUserRole;
  resourceKey: string;
} & PermissionFlags;

export type UserPermissionOverrideGrant = {
  userId: string;
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
  reason?: string | null;
};

/** Sujeito mínimo para checagem (não exige AppUser completo). */
export type PermissionSubject = {
  id?: string;
  role: AppUserRole;
  isActive?: boolean;
};

export type ResolvedResourcePermission = {
  resourceKey: string;
  flags: PermissionFlags;
  source: "super_admin" | "role" | "override" | "none";
};

export type ResolvedUserPermissions = {
  userId: string;
  role: AppUserRole;
  isActive: boolean;
  /** Flags efetivas por recurso (após role + override; sem aplicar hierarquia ainda). */
  byResource: Record<string, PermissionFlags>;
  overrides: UserPermissionOverrideGrant[];
};

export type PermissionMenuTreeNode = {
  key: string;
  label: string;
  type: PermissionResourceType;
  module: string;
  children: PermissionMenuTreeNode[];
};

export type PermissionDeniedError = {
  code: "PERMISSION_DENIED";
  message: string;
  resourceKey: string;
  action: PermissionAction;
};

export class PermissionAccessError extends Error {
  readonly code = "PERMISSION_DENIED" as const;
  readonly resourceKey: string;
  readonly action: PermissionAction;

  constructor(resourceKey: string, action: PermissionAction, message?: string) {
    super(
      message ??
        `Acesso negado ao recurso "${resourceKey}" (ação: ${action}).`
    );
    this.name = "PermissionAccessError";
    this.resourceKey = resourceKey;
    this.action = action;
  }
}

/** Snapshot usado pelo motor puro (testável sem DB). */
export type PermissionEvaluationSnapshot = {
  resources: PermissionResourceNode[];
  rolePermissions: RolePermissionGrant[];
  overrides: UserPermissionOverrideGrant[];
};

/** Porta de dados para getUserPermissions(userId) — Prisma ou mock. */
export type PermissionDataPort = {
  findUser(userId: string): Promise<{
    id: string;
    role: AppUserRole;
    isActive: boolean;
  } | null>;
  listResources(): Promise<PermissionResourceNode[]>;
  listRolePermissions(role: AppUserRole): Promise<RolePermissionGrant[]>;
  listUserOverrides(userId: string): Promise<UserPermissionOverrideGrant[]>;
};
