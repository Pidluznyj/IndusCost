/**
 * Motor backend de permissões hierárquicas (MENU / SUBMENU / TAB / ACTION).
 *
 * - Puro e testável via snapshot (sem UI, sem wiring amplo de rotas).
 * - SUPER_ADMIN: sempre permite.
 * - Base: RolePermission; Override por usuário sobrescreve flags não-nulas.
 * - Hierarquia: sem view no pai ⇒ filho negado.
 * - Desconhecido / inativo: nega (SUPER_ADMIN bypass).
 *
 * Não altera Fluxo de Caixa, Comissões, Relatório Presidencial nem cálculos.
 */

import type { AppUserRole } from "@prisma/client";
import {
  buildRolePermissionSeeds,
  PERMISSION_RESOURCE_SEEDS,
} from "@/src/lib/permissionResourceSeedData.js";
import {
  getPermissionCatalog,
  getPermissionCatalogMap,
  listAncestorKeys,
  listChildResources,
} from "@/src/lib/security/permissionsCatalog.js";
import type {
  PermissionAction,
  PermissionActionInput,
  PermissionDataPort,
  PermissionEvaluationSnapshot,
  PermissionFlags,
  PermissionMenuTreeNode,
  PermissionResourceNode,
  PermissionSubject,
  ResolvedUserPermissions,
  RolePermissionGrant,
  UserPermissionOverrideGrant,
} from "@/src/lib/security/permissionTypes.js";
import { PermissionAccessError } from "@/src/lib/security/permissionTypes.js";

const EMPTY_FLAGS: PermissionFlags = {
  canView: false,
  canExecute: false,
  canManage: false,
};

const FULL_FLAGS: PermissionFlags = {
  canView: true,
  canExecute: true,
  canManage: true,
};

export function normalizePermissionAction(
  action: PermissionActionInput = "view"
): PermissionAction {
  switch (action) {
    case "view":
    case "read":
      return "view";
    case "execute":
    case "create":
    case "export":
      return "execute";
    case "manage":
    case "admin":
    case "update":
    case "delete":
      return "manage";
    default:
      return "view";
  }
}

function flagForAction(flags: PermissionFlags, action: PermissionAction): boolean {
  if (action === "view") return flags.canView;
  if (action === "execute") return flags.canExecute;
  return flags.canManage;
}

function mergeOverride(
  base: PermissionFlags,
  override: UserPermissionOverrideGrant | undefined
): { flags: PermissionFlags; source: "role" | "override" | "none" } {
  if (!override) {
    const any = base.canView || base.canExecute || base.canManage;
    return { flags: base, source: any ? "role" : "none" };
  }
  const flags: PermissionFlags = {
    canView: override.canView ?? base.canView,
    canExecute: override.canExecute ?? base.canExecute,
    canManage: override.canManage ?? base.canManage,
  };
  return { flags, source: "override" };
}

/** Snapshot em memória a partir do seed (útil em testes e bootstrap sem DB). */
export function createSeedPermissionSnapshot(args: {
  role: AppUserRole;
  userId?: string;
  overrides?: UserPermissionOverrideGrant[];
  resourcePatches?: Array<Partial<PermissionResourceNode> & { key: string }>;
}): PermissionEvaluationSnapshot {
  const resources: PermissionResourceNode[] = PERMISSION_RESOURCE_SEEDS.map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    type: s.type,
    parentKey: s.parentKey,
    module: s.module,
    sortOrder: s.sortOrder,
    isSystem: s.isSystem,
    isActive: true,
  }));

  if (args.resourcePatches) {
    const byKey = new Map(resources.map((r) => [r.key, r]));
    for (const patch of args.resourcePatches) {
      const current = byKey.get(patch.key);
      if (current) Object.assign(current, patch);
    }
  }

  const rolePermissions: RolePermissionGrant[] = buildRolePermissionSeeds()
    .filter((r) => r.role === args.role)
    .map((r) => ({
      role: r.role,
      resourceKey: r.resourceKey,
      canView: r.canView,
      canExecute: r.canExecute,
      canManage: r.canManage,
    }));

  return {
    resources,
    rolePermissions,
    overrides: args.overrides ?? [],
  };
}

export function resolveFlagsForResource(args: {
  subject: PermissionSubject;
  resourceKey: string;
  snapshot: PermissionEvaluationSnapshot;
}): { flags: PermissionFlags; source: "super_admin" | "role" | "override" | "none" } {
  if (args.subject.role === "SUPER_ADMIN") {
    return { flags: FULL_FLAGS, source: "super_admin" };
  }

  const roleRow = args.snapshot.rolePermissions.find(
    (r) => r.role === args.subject.role && r.resourceKey === args.resourceKey
  );
  const base: PermissionFlags = roleRow
    ? {
        canView: roleRow.canView,
        canExecute: roleRow.canExecute,
        canManage: roleRow.canManage,
      }
    : { ...EMPTY_FLAGS };

  const userId = args.subject.id;
  const override = userId
    ? args.snapshot.overrides.find(
        (o) => o.userId === userId && o.resourceKey === args.resourceKey
      )
    : undefined;

  return mergeOverride(base, override);
}

/**
 * Resolve permissões efetivas flat (role + override) para um usuário.
 * Não aplica hierarquia — use canAccessResource para decisão final.
 */
export function resolveUserPermissionsFromSnapshot(
  subject: PermissionSubject & { id: string },
  snapshot: PermissionEvaluationSnapshot
): ResolvedUserPermissions {
  const byResource: Record<string, PermissionFlags> = {};
  for (const resource of snapshot.resources) {
    byResource[resource.key] = resolveFlagsForResource({
      subject,
      resourceKey: resource.key,
      snapshot,
    }).flags;
  }
  return {
    userId: subject.id,
    role: subject.role,
    isActive: subject.isActive !== false,
    byResource,
    overrides: snapshot.overrides.filter((o) => o.userId === subject.id),
  };
}

export function canAccessResource(
  subject: PermissionSubject,
  resourceKey: string,
  action: PermissionActionInput = "view",
  snapshot?: PermissionEvaluationSnapshot
): boolean {
  const snap = snapshot ?? createSeedPermissionSnapshot({ role: subject.role, userId: subject.id });
  const normalized = normalizePermissionAction(action);

  if (subject.isActive === false && subject.role !== "SUPER_ADMIN") {
    return false;
  }

  if (subject.role === "SUPER_ADMIN") {
    return true;
  }

  const catalog = getPermissionCatalogMap(snap.resources);
  const resource = catalog.get(resourceKey);
  if (!resource) {
    return false;
  }
  if (!resource.isActive) {
    return false;
  }

  // Ancestrais devem permitir view.
  for (const ancestorKey of listAncestorKeys(resourceKey, snap.resources)) {
    const ancestor = catalog.get(ancestorKey);
    if (!ancestor || !ancestor.isActive) return false;
    const ancestorFlags = resolveFlagsForResource({
      subject,
      resourceKey: ancestorKey,
      snapshot: snap,
    }).flags;
    if (!ancestorFlags.canView) return false;
  }

  const { flags } = resolveFlagsForResource({
    subject,
    resourceKey,
    snapshot: snap,
  });
  return flagForAction(flags, normalized);
}

export function assertCanAccessResource(
  subject: PermissionSubject,
  resourceKey: string,
  action: PermissionActionInput = "view",
  snapshot?: PermissionEvaluationSnapshot
): void {
  if (!canAccessResource(subject, resourceKey, action, snapshot)) {
    throw new PermissionAccessError(resourceKey, normalizePermissionAction(action));
  }
}

export function getAllowedMenuTree(
  subject: PermissionSubject,
  snapshot?: PermissionEvaluationSnapshot
): PermissionMenuTreeNode[] {
  const snap = snapshot ?? createSeedPermissionSnapshot({ role: subject.role, userId: subject.id });
  const catalog = getPermissionCatalog(snap.resources).filter(
    (r) => r.type === "MENU" || r.type === "SUBMENU"
  );

  const allowed = catalog.filter((r) =>
    canAccessResource(subject, r.key, "view", snap)
  );
  const byParent = new Map<string | null, PermissionResourceNode[]>();
  for (const node of allowed) {
    const parent = node.parentKey;
    // Só aninha SUBMENU sob MENU se ambos permitidos; MENU raiz parentKey null.
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }

  const build = (parentKey: string | null): PermissionMenuTreeNode[] => {
    const children = (byParent.get(parentKey) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
    );
    return children.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      module: c.module,
      children: build(c.key),
    }));
  };

  return build(null);
}

export function getAllowedTabs(
  subject: PermissionSubject,
  parentResourceKey: string,
  snapshot?: PermissionEvaluationSnapshot
): PermissionResourceNode[] {
  const snap = snapshot ?? createSeedPermissionSnapshot({ role: subject.role, userId: subject.id });
  if (!canAccessResource(subject, parentResourceKey, "view", snap)) {
    return [];
  }
  return listChildResources(parentResourceKey, "TAB", snap.resources).filter((tab) =>
    canAccessResource(subject, tab.key, "view", snap)
  );
}

/**
 * Carrega permissões do usuário via porta de dados (Prisma ou mock).
 * Não altera AppUser.permissions[] legado.
 */
export async function getUserPermissions(
  userId: string,
  port: PermissionDataPort
): Promise<ResolvedUserPermissions | null> {
  const user = await port.findUser(userId);
  if (!user) return null;

  const [resources, rolePermissions, overrides] = await Promise.all([
    port.listResources(),
    port.listRolePermissions(user.role),
    port.listUserOverrides(userId),
  ]);

  const snapshot: PermissionEvaluationSnapshot = {
    resources: resources.length > 0 ? resources : getPermissionCatalog(),
    rolePermissions,
    overrides,
  };

  return resolveUserPermissionsFromSnapshot(
    { id: user.id, role: user.role, isActive: user.isActive },
    snapshot
  );
}

/** Adapter Prisma — caller injeta o client (sem importar src/lib/prisma neste módulo). */
export function createPrismaPermissionDataPort(
  prisma: import("@prisma/client").PrismaClient
): PermissionDataPort {
  return {
    findUser: (userId) =>
      prisma.appUser.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      }),
    listResources: async () => {
      const rows = await prisma.permissionResource.findMany();
      return rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        type: r.type,
        parentKey: r.parentKey,
        module: r.module,
        sortOrder: r.sortOrder,
        isSystem: r.isSystem,
        isActive: r.isActive,
      }));
    },
    listRolePermissions: async (role) => {
      const rows = await prisma.rolePermission.findMany({ where: { role } });
      return rows.map((r) => ({
        role: r.role,
        resourceKey: r.resourceKey,
        canView: r.canView,
        canExecute: r.canExecute,
        canManage: r.canManage,
      }));
    },
    listUserOverrides: async (userId) => {
      const rows = await prisma.userPermissionOverride.findMany({ where: { userId } });
      return rows.map((r) => ({
        userId: r.userId,
        resourceKey: r.resourceKey,
        canView: r.canView,
        canExecute: r.canExecute,
        canManage: r.canManage,
        reason: r.reason,
      }));
    },
  };
}

/** Helper de teste / bootstrap: porta em memória a partir de snapshot. */
export function createInMemoryPermissionPort(
  users: Array<{ id: string; role: AppUserRole; isActive?: boolean }>,
  snapshot: PermissionEvaluationSnapshot
): PermissionDataPort {
  const userMap = new Map(users.map((u) => [u.id, u]));
  return {
    async findUser(userId) {
      const u = userMap.get(userId);
      if (!u) return null;
      return { id: u.id, role: u.role, isActive: u.isActive !== false };
    },
    async listResources() {
      return snapshot.resources;
    },
    async listRolePermissions(role) {
      return snapshot.rolePermissions.filter((r) => r.role === role);
    },
    async listUserOverrides(userId) {
      return snapshot.overrides.filter((o) => o.userId === userId);
    },
  };
}

export { getPermissionCatalog, PermissionAccessError };
