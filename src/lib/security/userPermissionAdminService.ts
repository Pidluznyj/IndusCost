/**
 * Serviço admin de permissões por usuário (árvore, overrides, dual-write, auditoria).
 */

import type { AppUserRole, PrismaClient } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  PERMISSION_RESOURCE_SEEDS,
  sortPermissionResourcesForInsert,
  validatePermissionResourceCatalog,
} from "@/src/lib/permissionResourceSeedData.js";
import { filterKnownPermissions } from "@/src/lib/appAuth.js";
import {
  buildEffectiveFlagsMap,
  buildPermissionAccessSummary,
  diffUserAgainstRolePreset,
  flagsEqual,
  getOfficialRolePreset,
  listOfficialRolePresets,
  materializeLegacyPermissionsFromFlags,
  mergeRoleAndOverrideFlags,
  planApplyRolePreset,
  buildRolePermissionMatrixRows,
} from "@/src/lib/security/permissionRolePresets.js";
import type {
  PermissionFlags,
  UserPermissionOverrideGrant,
} from "@/src/lib/security/permissionTypes.js";
import {
  PermissionOverrideValidationError,
  validateAndNormalizeOverrideInputs,
} from "@/src/lib/security/permissionOverrideValidate.js";
import type { OverridePersistMode } from "@/src/lib/security/permissionOverrideState.js";
import { materializeUserLegacyBag } from "@/src/lib/security/permissionDualWrite/service.js";
import {
  buildOverrideSaveAuditPlans,
  buildPresetApplyAuditPlans,
  overridesUnchanged,
  type PermissionAuditEntryPlan,
} from "@/src/lib/security/permissionAudit.js";

export class UserPermissionAdminError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "UserPermissionAdminError";
    this.code = code;
    this.details = details;
  }
}

export type EditablePermissionTreeNode = {
  key: string;
  label: string;
  description: string;
  type: "MENU" | "SUBMENU" | "TAB" | "ACTION";
  module: string;
  parentKey: string | null;
  roleFlags: PermissionFlags;
  override: {
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
  } | null;
  effectiveFlags: PermissionFlags;
  children: EditablePermissionTreeNode[];
};

export type OverrideInput = {
  resourceKey: string;
  canView?: boolean | null;
  canExecute?: boolean | null;
  canManage?: boolean | null;
  /** Alternativa tipada (P05); se presente, tem precedência sobre can*. */
  view?: "INHERIT" | "ALLOW" | "DENY";
  execute?: "INHERIT" | "ALLOW" | "DENY";
  manage?: "INHERIT" | "ALLOW" | "DENY";
  reason?: string | null;
};

export function buildEditablePermissionTree(
  role: AppUserRole,
  overrides: readonly UserPermissionOverrideGrant[]
): EditablePermissionTreeNode[] {
  const overrideByKey = new Map(overrides.map((o) => [o.resourceKey, o]));
  const nodes = new Map<string, EditablePermissionTreeNode>();

  for (const seed of PERMISSION_RESOURCE_SEEDS) {
    const roleFlags = getOfficialRolePermissionFlags(role, seed.key);
    const ov = overrideByKey.get(seed.key);
    const override = ov
      ? {
          canView: ov.canView,
          canExecute: ov.canExecute,
          canManage: ov.canManage,
        }
      : null;
    nodes.set(seed.key, {
      key: seed.key,
      label: seed.label,
      description: seed.description,
      type: seed.type,
      module: seed.module,
      parentKey: seed.parentKey,
      roleFlags,
      override,
      effectiveFlags: mergeRoleAndOverrideFlags(roleFlags, ov),
      children: [],
    });
  }

  const roots: EditablePermissionTreeNode[] = [];
  for (const seed of [...PERMISSION_RESOURCE_SEEDS].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
  )) {
    const node = nodes.get(seed.key)!;
    if (seed.parentKey && nodes.has(seed.parentKey)) {
      nodes.get(seed.parentKey)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function normalizeOverrideInputs(
  inputs: readonly OverrideInput[]
): UserPermissionOverrideGrant[] {
  try {
    return validateAndNormalizeOverrideInputs(inputs).map((o) => ({
      userId: "",
      resourceKey: o.resourceKey,
      canView: o.canView,
      canExecute: o.canExecute,
      canManage: o.canManage,
      reason: o.reason ?? null,
    }));
  } catch (error) {
    if (error instanceof PermissionOverrideValidationError) {
      throw new UserPermissionAdminError(error.code, error.message, error.details);
    }
    throw error;
  }
}

export function assertCanChangeSuperAdminRole(args: {
  existingRole: AppUserRole;
  existingActive: boolean;
  nextRole: AppUserRole;
  nextActive?: boolean;
  activeSuperAdminCount: number;
}): void {
  const isLast =
    args.existingRole === "SUPER_ADMIN" &&
    args.existingActive &&
    args.activeSuperAdminCount <= 1;
  if (!isLast) return;
  if (args.nextRole !== "SUPER_ADMIN") {
    throw new UserPermissionAdminError(
      "LAST_SUPER_ADMIN",
      "Não é possível rebaixar o único Super Administrador ativo."
    );
  }
  if (args.nextActive === false) {
    throw new UserPermissionAdminError(
      "LAST_SUPER_ADMIN",
      "Não é possível inativar o único Super Administrador ativo."
    );
  }
}

export function assertSelfUsersManageLock(args: {
  isEditingSelf: boolean;
  existingRole: AppUserRole;
  existingPermissions: readonly string[];
  nextRole: AppUserRole;
  nextLegacyPermissions: readonly string[];
}): void {
  if (!args.isEditingSelf) return;
  if (args.existingRole === "SUPER_ADMIN" && args.nextRole !== "SUPER_ADMIN") {
    throw new UserPermissionAdminError(
      "CANNOT_DEMOTE_SELF",
      "Você não pode rebaixar o próprio perfil de Super Administrador."
    );
  }
  const currentlyHas =
    args.existingRole === "SUPER_ADMIN" || args.existingPermissions.includes("users.manage");
  const willKeep =
    args.nextRole === "SUPER_ADMIN" || args.nextLegacyPermissions.includes("users.manage");
  if (currentlyHas && !willKeep) {
    throw new UserPermissionAdminError(
      "CANNOT_REMOVE_OWN_USERS_MANAGE",
      "Você não pode remover a própria permissão de Usuários e Permissões."
    );
  }
}

export function buildUserPermissionsPayload(args: {
  user: {
    id: string;
    name: string;
    email: string;
    role: AppUserRole;
    isActive: boolean;
    lastLoginAt: string | null;
    permissions: string[];
  };
  overrides: UserPermissionOverrideGrant[];
  activeSuperAdminCount: number;
}) {
  const role = args.user.role;
  const effective = buildEffectiveFlagsMap(role, args.overrides);
  const tree = buildEditablePermissionTree(role, args.overrides);
  const summary = buildPermissionAccessSummary({ role, effective });
  const diff = diffUserAgainstRolePreset({ role, overrides: args.overrides, effective });
  const preset = getOfficialRolePreset(role);

  return {
    user: args.user,
    isSuperAdmin: role === "SUPER_ADMIN",
    treeReadOnly: role === "SUPER_ADMIN",
    hasCustomPermissions: args.overrides.length > 0,
    overrideCount: args.overrides.length,
    roleDefaults: preset.resources.map((r) => ({
      resourceKey: r.resourceKey,
      flags: r.flags,
    })),
    overrides: args.overrides,
    effectiveFlags: effective,
    tree,
    summary,
    diffVsRole: diff,
    warnings: {
      editingSuperAdmin: role === "SUPER_ADMIN",
      isLastSuperAdmin:
        role === "SUPER_ADMIN" &&
        args.user.isActive &&
        args.activeSuperAdminCount <= 1,
    },
  };
}

type PrismaLike = PrismaClient;

async function loadOverrides(
  prisma: PrismaLike,
  userId: string
): Promise<UserPermissionOverrideGrant[]> {
  try {
    const rows = await prisma.userPermissionOverride.findMany({ where: { userId } });
    return rows.map((r) => ({
      userId: r.userId,
      resourceKey: r.resourceKey,
      canView: r.canView,
      canExecute: r.canExecute,
      canManage: r.canManage,
      reason: r.reason,
    }));
  } catch {
    // Tabela pode não existir ainda em ambientes sem migrate — não quebra listagem.
    return [];
  }
}

function isMissingPermissionTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /permissionResource|userPermissionOverride|rolePermission|permissionAuditLog/i.test(msg) &&
    (/does not exist/i.test(msg) ||
      /P2021/.test(msg) ||
      /relation .* does not exist/i.test(msg))
  );
}

function isPermissionFkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /P2003/.test(msg) ||
    /Foreign key constraint/i.test(msg) ||
    (/foreign key/i.test(msg) && /resourceKey|PermissionResource/i.test(msg))
  );
}

function mapPermissionWriteError(error: unknown): never {
  if (isMissingPermissionTableError(error)) {
    throw new UserPermissionAdminError(
      "PERMISSION_SCHEMA_MISSING",
      "Tabelas de permissões ainda não existem. Rode as migrations e depois npm run permissions:seed."
    );
  }
  if (isPermissionFkError(error)) {
    throw new UserPermissionAdminError(
      "PERMISSION_CATALOG_MISSING",
      "Catálogo de permissões não está populado. Rode npm run permissions:seed."
    );
  }
  throw error;
}

/**
 * Garante que os PermissionResource do seed existam (necessário pela FK dos overrides).
 * Idempotente; não altera RolePermission nem AppUser.permissions.
 */
export async function ensurePermissionCatalogResources(
  prisma: PrismaLike
): Promise<void> {
  try {
    for (const row of sortPermissionResourcesForInsert()) {
      await prisma.permissionResource.upsert({
        where: { key: row.key },
        create: {
          key: row.key,
          label: row.label,
          description: row.description,
          type: row.type,
          parentKey: row.parentKey,
          module: row.module,
          sortOrder: row.sortOrder,
          isSystem: true,
          isActive: true,
        },
        update: {
          label: row.label,
          description: row.description,
          type: row.type,
          parentKey: row.parentKey,
          module: row.module,
          sortOrder: row.sortOrder,
          isSystem: true,
          isActive: true,
        },
      });
    }
  } catch (error) {
    mapPermissionWriteError(error);
  }
}

async function writeAuditPlans(
  prisma: PrismaLike,
  args: {
    actorUserId: string | null;
    targetUserId: string;
    plans: readonly PermissionAuditEntryPlan[];
  }
): Promise<void> {
  if (args.plans.length === 0) return;
  try {
    await prisma.permissionAuditLog.createMany({
      data: args.plans.map((plan) => ({
        actorUserId: args.actorUserId,
        targetUserId: args.targetUserId,
        targetRole: plan.targetRole as AppUserRole,
        resourceKey: plan.resourceKey,
        action: plan.action,
        beforeJson: (plan.beforeJson ?? undefined) as object | undefined,
        afterJson: (plan.afterJson ?? undefined) as object | undefined,
      })),
    });
  } catch (error) {
    // Fallback: cria um a um se createMany falhar (ex.: driver/JSON).
    console.warn("[permission-audit] createMany falhou; tentando create", error);
    for (const plan of args.plans) {
      try {
        await prisma.permissionAuditLog.create({
          data: {
            actorUserId: args.actorUserId,
            targetUserId: args.targetUserId,
            targetRole: plan.targetRole as AppUserRole,
            resourceKey: plan.resourceKey,
            action: plan.action,
            beforeJson: (plan.beforeJson ?? undefined) as object | undefined,
            afterJson: (plan.afterJson ?? undefined) as object | undefined,
          },
        });
      } catch (inner) {
        console.warn("[permission-audit] falha ao gravar auditoria", inner);
      }
    }
  }
}

export async function countActiveSuperAdminsDb(prisma: PrismaLike): Promise<number> {
  return prisma.appUser.count({
    where: { role: "SUPER_ADMIN", isActive: true },
  });
}

export async function getUserPermissionsAdmin(
  prisma: PrismaLike,
  userId: string
) {
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      permissions: true,
    },
  });
  if (!user) {
    throw new UserPermissionAdminError("NOT_FOUND", "Usuário não encontrado.");
  }
  const [overrides, activeSuperAdminCount] = await Promise.all([
    loadOverrides(prisma, userId),
    countActiveSuperAdminsDb(prisma),
  ]);
  return buildUserPermissionsPayload({
    user: {
      ...user,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    overrides,
    activeSuperAdminCount,
  });
}

export async function listPermissionPresetsAdmin() {
  return {
    presets: listOfficialRolePresets(),
    matrix: buildRolePermissionMatrixRows({ includeActions: true }),
    catalogIssues: validatePermissionResourceCatalog(),
  };
}

export async function saveUserPermissionOverrides(
  prisma: PrismaLike,
  args: {
    userId: string;
    actorUserId: string | null;
    overrides: readonly OverrideInput[];
    isEditingSelf: boolean;
    reason?: string | null;
    /** differential (default) | absolute — ver permissionOverrideState. */
    mode?: OverridePersistMode;
    /**
     * Concorrência otimista: se informado e ≠ count atual, falha com CONFLICT.
     * Rollback: não grava; cliente recarrega.
     */
    ifMatchOverrideCount?: number;
  }
) {
  const user = await prisma.appUser.findUnique({ where: { id: args.userId } });
  if (!user) throw new UserPermissionAdminError("NOT_FOUND", "Usuário não encontrado.");
  if (user.role === "SUPER_ADMIN") {
    throw new UserPermissionAdminError(
      "SUPER_ADMIN_READONLY",
      "SUPER_ADMIN tem acesso total; não há overrides editáveis."
    );
  }

  const beforeOverrides = await loadOverrides(prisma, args.userId);

  if (
    typeof args.ifMatchOverrideCount === "number" &&
    args.ifMatchOverrideCount !== beforeOverrides.length
  ) {
    throw new UserPermissionAdminError(
      "CONFLICT",
      "Overrides foram alterados por outra sessão. Recarregue e tente novamente.",
      {
        expected: args.ifMatchOverrideCount,
        actual: beforeOverrides.length,
      }
    );
  }

  let normalized = normalizeOverrideInputs(args.overrides).map((o) => ({
    ...o,
    userId: args.userId,
  }));

  // Modo absoluto a partir de um draft parcial: completa DENY nos baselines allow não enviados.
  if (args.mode === "absolute") {
    const byKey = new Map(normalized.map((o) => [o.resourceKey, o]));
    const preset = getOfficialRolePreset(user.role);
    for (const row of preset.resources) {
      const existing = byKey.get(row.resourceKey);
      if (existing) continue;
      const flags = row.flags;
      if (!flags.canView && !flags.canExecute && !flags.canManage) continue;
      byKey.set(row.resourceKey, {
        userId: args.userId,
        resourceKey: row.resourceKey,
        canView: flags.canView ? false : null,
        canExecute: flags.canExecute ? false : null,
        canManage: flags.canManage ? false : null,
        reason: "absolute-restriction",
      });
    }
    normalized = [...byKey.values()];
  }

  // Sem mudança real → não grava DB nem auditoria (evita ruído).
  if (overridesUnchanged(beforeOverrides, normalized)) {
    return getUserPermissionsAdmin(prisma, args.userId);
  }

  const effective = buildEffectiveFlagsMap(user.role, normalized);
  const dual = materializeUserLegacyBag({
    effectiveByResourceKey: effective,
    previousLegacyPermissions: user.permissions,
    dryRun: false,
    filterKnown: true,
  });
  const legacyPermissions = dual.legacyPermissions;

  assertSelfUsersManageLock({
    isEditingSelf: args.isEditingSelf,
    existingRole: user.role,
    existingPermissions: user.permissions,
    nextRole: user.role,
    nextLegacyPermissions: legacyPermissions,
  });

  const reason =
    args.reason?.trim() ||
    normalized.map((o) => o.reason?.trim()).find((r) => r) ||
    null;

  // FK UserPermissionOverride.resourceKey → PermissionResource.key
  await ensurePermissionCatalogResources(prisma);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId: args.userId } });
      for (const ov of normalized) {
        await tx.userPermissionOverride.create({
          data: {
            userId: args.userId,
            resourceKey: ov.resourceKey,
            canView: ov.canView,
            canExecute: ov.canExecute,
            canManage: ov.canManage,
            reason: ov.reason ?? null,
          },
        });
      }
      await tx.appUser.update({
        where: { id: args.userId },
        data: { permissions: legacyPermissions },
      });
    });
  } catch (error) {
    mapPermissionWriteError(error);
  }

  const plans = buildOverrideSaveAuditPlans({
    targetRole: user.role,
    before: beforeOverrides,
    after: normalized,
    reason,
  });
  await writeAuditPlans(prisma, {
    actorUserId: args.actorUserId,
    targetUserId: args.userId,
    plans,
  });

  return getUserPermissionsAdmin(prisma, args.userId);
}

export async function clearUserPermissionOverrides(
  prisma: PrismaLike,
  args: {
    userId: string;
    actorUserId: string | null;
    confirm: boolean;
    isEditingSelf: boolean;
    reason?: string | null;
  }
) {
  if (!args.confirm) {
    throw new UserPermissionAdminError(
      "CONFIRM_REQUIRED",
      "Confirme a limpeza das permissões customizadas."
    );
  }
  return applyRolePresetToUser(prisma, {
    userId: args.userId,
    actorUserId: args.actorUserId,
    confirmClearOverrides: true,
    isEditingSelf: args.isEditingSelf,
    auditKind: "restore",
    reason: args.reason,
  });
}

export async function applyRolePresetToUser(
  prisma: PrismaLike,
  args: {
    userId: string;
    actorUserId: string | null;
    role?: AppUserRole;
    confirmClearOverrides?: boolean;
    isEditingSelf: boolean;
    auditKind?: "preset" | "restore" | "role_change";
    reason?: string | null;
  }
) {
  const user = await prisma.appUser.findUnique({ where: { id: args.userId } });
  if (!user) throw new UserPermissionAdminError("NOT_FOUND", "Usuário não encontrado.");

  const nextRole = args.role ?? user.role;
  const activeSuperAdminCount = await countActiveSuperAdminsDb(prisma);
  assertCanChangeSuperAdminRole({
    existingRole: user.role,
    existingActive: user.isActive,
    nextRole,
    activeSuperAdminCount,
  });

  const beforeOverrides = await loadOverrides(prisma, args.userId);
  const plan = planApplyRolePreset({
    role: nextRole,
    currentOverrides: beforeOverrides,
    currentLegacyPermissions: user.permissions,
    confirmClearOverrides: args.confirmClearOverrides,
  });

  if ("error" in plan) {
    throw new UserPermissionAdminError(
      plan.error,
      "Este usuário tem permissões customizadas. Confirme para removê-las e aplicar o preset.",
      { overrideCount: plan.overrideCount }
    );
  }

  assertSelfUsersManageLock({
    isEditingSelf: args.isEditingSelf,
    existingRole: user.role,
    existingPermissions: user.permissions,
    nextRole,
    nextLegacyPermissions: plan.legacyPermissions,
  });

  if (plan.unchanged && nextRole === user.role) {
    return getUserPermissionsAdmin(prisma, args.userId);
  }

  const legacyPermissions = filterKnownPermissions(plan.legacyPermissions);
  const auditKind =
    args.auditKind ??
    (nextRole !== user.role ? "role_change" : "preset");

  // Garante catálogo (FK de auditoria/consistência). Erros de schema viram mensagem clara.
  await ensurePermissionCatalogResources(prisma);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId: args.userId } });
      await tx.appUser.update({
        where: { id: args.userId },
        data: {
          role: nextRole,
          permissions: legacyPermissions,
        },
      });
    });
  } catch (error) {
    mapPermissionWriteError(error);
  }

  const plans = buildPresetApplyAuditPlans({
    beforeRole: user.role,
    afterRole: nextRole,
    beforeOverrides,
    beforePermissions: user.permissions,
    afterPermissions: legacyPermissions,
    kind: auditKind === "role_change" ? "preset" : auditKind,
    reason: args.reason,
  });
  await writeAuditPlans(prisma, {
    actorUserId: args.actorUserId,
    targetUserId: args.userId,
    plans,
  });

  return getUserPermissionsAdmin(prisma, args.userId);
}

export async function updateUserRoleAdmin(
  prisma: PrismaLike,
  args: {
    userId: string;
    actorUserId: string | null;
    role: AppUserRole;
    confirmClearOverrides?: boolean;
    isEditingSelf: boolean;
    reason?: string | null;
  }
) {
  return applyRolePresetToUser(prisma, {
    userId: args.userId,
    actorUserId: args.actorUserId,
    role: args.role,
    confirmClearOverrides: args.confirmClearOverrides,
    isEditingSelf: args.isEditingSelf,
    auditKind: "role_change",
    reason: args.reason,
  });
}

export async function listUserPermissionAudit(
  prisma: PrismaLike,
  userId: string,
  limit = 50
) {
  try {
    const rows = await prisma.permissionAuditLog.findMany({
      where: { targetUserId: userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
      include: {
        actorUser: { select: { id: true, name: true, email: true } },
      },
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceKey: r.resourceKey,
        targetRole: r.targetRole,
        beforeJson: r.beforeJson,
        afterJson: r.afterJson,
        createdAt: r.createdAt.toISOString(),
        actor: r.actorUser
          ? { id: r.actorUser.id, name: r.actorUser.name, email: r.actorUser.email }
          : null,
      })),
    };
  } catch {
    return { entries: [] };
  }
}

export async function reloadPermissionCatalogStatus(prisma: PrismaLike) {
  const issues = validatePermissionResourceCatalog();
  // Garante catálogo no DB (FK dos overrides); idempotente.
  await ensurePermissionCatalogResources(prisma);
  let dbResourceCount = 0;
  let dbRolePermissionCount = 0;
  try {
    dbResourceCount = await prisma.permissionResource.count();
    dbRolePermissionCount = await prisma.rolePermission.count();
  } catch {
    // ignore — ensure já mapeou schema ausente
  }
  return {
    ok: issues.length === 0 && dbResourceCount > 0,
    issues,
    seedResourceCount: PERMISSION_RESOURCE_SEEDS.length,
    dbResourceCount,
    dbRolePermissionCount,
    presets: listOfficialRolePresets().map((p) => ({
      role: p.role,
      label: p.label,
      resourceCount: p.resources.length,
    })),
  };
}

export function computePendingOverrideChanges(args: {
  baseline: readonly UserPermissionOverrideGrant[];
  draft: readonly OverrideInput[];
}): boolean {
  const normalized = normalizeOverrideInputs(args.draft);
  if (normalized.length !== args.baseline.length) return true;
  const byKey = new Map(args.baseline.map((o) => [o.resourceKey, o]));
  for (const d of normalized) {
    const b = byKey.get(d.resourceKey);
    if (!b) return true;
    if (
      !flagsEqual(
        {
          canView: d.canView ?? false,
          canExecute: d.canExecute ?? false,
          canManage: d.canManage ?? false,
        },
        {
          canView: b.canView ?? false,
          canExecute: b.canExecute ?? false,
          canManage: b.canManage ?? false,
        }
      )
    ) {
      // null vs false: compare nullable carefully
      if (d.canView !== b.canView || d.canExecute !== b.canExecute || d.canManage !== b.canManage) {
        return true;
      }
    }
  }
  return false;
}

export { flagsEqual, materializeLegacyPermissionsFromFlags, planApplyRolePreset };
