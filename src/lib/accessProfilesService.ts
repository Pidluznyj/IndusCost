import type { AccessProfile, AppUserRole, Prisma, PrismaClient } from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  filterKnownPermissions,
  type AppAuthContext,
  hasPermission,
} from "@/src/lib/appAuth.js";
import { bumpPermissionsVersionAndSyncSessions } from "@/src/lib/permissionsVersion.js";
import { parseAppUserRole } from "@/src/lib/appAuthRoles.js";
import { SYSTEM_ACCESS_PROFILE_SEEDS } from "@/src/lib/accessProfilesSeedData.js";
import {
  applyAccessProfileToUserFields,
  applyProfilePermissionsRaw,
  permissionsMatchProfile,
} from "@/src/lib/accessProfilesUtils.js";
import {
  buildAccessProfileAuditPlans,
  buildAccessProfileUserApplyAuditPlans,
  type PermissionAuditEntryPlan,
} from "@/src/lib/security/permissionAudit.js";

const KNOWN_PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** Códigos de validação → HTTP 400 (nunca 500). */
export const ACCESS_PROFILE_VALIDATION_CODES = new Set([
  "INVALID_NAME",
  "EMPTY_PERMISSIONS",
  "UNKNOWN_PERMISSIONS",
  "CONFIRM_REQUIRED",
  "NO_CHANGES",
  "INVALID_BODY",
  "INVALID_ROLE_BASE",
]);

/** Códigos de conflito/regra de negócio → HTTP 409. */
export const ACCESS_PROFILE_CONFLICT_CODES = new Set([
  "NAME_ALREADY_EXISTS",
  "LAST_ADMIN_PROFILE",
  "SYSTEM_PROFILE_PROTECTED",
  "PROFILE_IN_USE",
  "INACTIVE_PROFILE",
  "INVALID_PROFILE",
]);

export {
  applyAccessProfileToUserFields,
  applyProfilePermissionsRaw,
  permissionsMatchProfile,
} from "@/src/lib/accessProfilesUtils.js";

export type AccessProfileDto = {
  id: string;
  name: string;
  description: string | null;
  roleBase: AppUserRole | null;
  systemKey: string | null;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AccessProfileListOptions = {
  activeOnly?: boolean;
  search?: string;
  includeInactive?: boolean;
};

function toDto(profile: AccessProfile, userCount = 0): AccessProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    roleBase: profile.roleBase,
    systemKey: profile.systemKey,
    permissions: filterKnownPermissions(profile.permissions),
    isSystem: profile.isSystem,
    isActive: profile.isActive,
    userCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function canManageAccessProfiles(
  auth: Pick<AppAuthContext, "role" | "permissions" | "effectivePermissions">
): boolean {
  return (
    auth.role === "SUPER_ADMIN" ||
    hasPermission(auth, "accessProfiles.manage") ||
    hasPermission(auth, "users.manage")
  );
}

export function canViewAccessProfiles(
  auth: Pick<AppAuthContext, "role" | "permissions" | "effectivePermissions">
): boolean {
  return (
    canManageAccessProfiles(auth) || hasPermission(auth, "accessProfiles.view")
  );
}

export async function ensureSystemAccessProfiles(prisma: PrismaClient): Promise<void> {
  for (const seed of SYSTEM_ACCESS_PROFILE_SEEDS) {
    await prisma.accessProfile.upsert({
      where: { systemKey: seed.systemKey },
      create: {
        name: seed.name,
        description: seed.description,
        roleBase: seed.roleBase,
        systemKey: seed.systemKey,
        permissions: seed.permissions,
        isSystem: true,
        isActive: true,
      },
      update: {},
    });
  }
}

export async function listAccessProfiles(
  prisma: PrismaClient,
  options: AccessProfileListOptions = {}
): Promise<AccessProfileDto[]> {
  await ensureSystemAccessProfiles(prisma);

  const where: Prisma.AccessProfileWhereInput = {};
  if (options.activeOnly) {
    where.isActive = true;
  } else if (!options.includeInactive) {
    where.isActive = true;
  }
  if (options.search?.trim()) {
    where.name = { contains: options.search.trim(), mode: "insensitive" };
  }

  const rows = await prisma.accessProfile.findMany({
    where,
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  return rows.map((row) => toDto(row, row._count.users));
}

export async function getAccessProfileById(
  prisma: PrismaClient,
  id: string
): Promise<AccessProfileDto | null> {
  const row = await prisma.accessProfile.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  return row ? toDto(row, row._count.users) : null;
}

/**
 * Separa chaves do catálogo legado das desconhecidas (P28).
 * Compatibilidade controlada: só bag keys do PERMISSION_CATALOG são aceitas.
 */
export function parseAccessProfilePermissionsInput(permissions: unknown): {
  known: string[];
  unknown: string[];
} {
  if (!Array.isArray(permissions)) {
    return { known: [], unknown: [] };
  }
  const known: string[] = [];
  const unknown: string[] = [];
  for (const raw of permissions) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (!key) continue;
    if (KNOWN_PERMISSION_KEY_SET.has(key)) {
      if (!known.includes(key)) known.push(key);
    } else if (!unknown.includes(key)) {
      unknown.push(key);
    }
  }
  return { known: known.sort(), unknown: unknown.sort() };
}

function normalizePermissionsInput(
  permissions: unknown,
  options?: { allowEmpty?: boolean; roleBase?: AppUserRole | null }
): string[] {
  const { known, unknown } = parseAccessProfilePermissionsInput(permissions);
  if (unknown.length > 0) {
    const sample = unknown.slice(0, 5).join(", ");
    const more = unknown.length > 5 ? ` (+${unknown.length - 5})` : "";
    throw new AccessProfileError(
      "UNKNOWN_PERMISSIONS",
      `Permissões não registradas no catálogo: ${sample}${more}. Remova chaves inválidas ou use apenas aliases legados conhecidos.`
    );
  }
  const roleBase = options?.roleBase ?? null;
  const allowEmpty = options?.allowEmpty === true || roleBase === "SUPER_ADMIN";
  if (!allowEmpty && known.length === 0) {
    throw new AccessProfileError(
      "EMPTY_PERMISSIONS",
      "Selecione ao menos uma permissão registrada ou defina role Super administrador."
    );
  }
  return known;
}

async function assertNameAvailable(
  prisma: PrismaClient,
  name: string,
  excludeId?: string
): Promise<void> {
  const existing = await prisma.accessProfile.findFirst({
    where: {
      name,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new AccessProfileError(
      "NAME_ALREADY_EXISTS",
      "Já existe um perfil com este nome."
    );
  }
}

function hasAdminCapability(permissions: string[], roleBase: AppUserRole | null): boolean {
  if (roleBase === "SUPER_ADMIN") return true;
  return permissions.includes("users.manage") || permissions.includes("accessProfiles.manage");
}

export async function countActiveAdminProfiles(
  prisma: PrismaClient,
  excludeId?: string
): Promise<number> {
  const profiles = await prisma.accessProfile.findMany({
    where: {
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { permissions: true, roleBase: true },
  });
  return profiles.filter((p) => hasAdminCapability(p.permissions, p.roleBase)).length;
}

export type CreateAccessProfileInput = {
  name: string;
  description?: string | null;
  roleBase?: AppUserRole | null;
  permissions?: unknown;
  isActive?: boolean;
};

export async function createAccessProfile(
  prisma: PrismaClient,
  input: CreateAccessProfileInput & { actorUserId?: string | null }
): Promise<AccessProfileDto> {
  const name = input.name.trim();
  if (!name) throw new AccessProfileError("INVALID_NAME", "Informe o nome do perfil.");

  const roleBase = input.roleBase ?? null;
  const permissions = normalizePermissionsInput(input.permissions ?? [], {
    roleBase,
  });

  await assertNameAvailable(prisma, name);

  const created = await prisma.$transaction(async (tx) => {
    return tx.accessProfile.create({
      data: {
        name,
        description: input.description?.trim() || null,
        roleBase,
        permissions,
        isSystem: false,
        isActive: input.isActive !== false,
      },
      include: { _count: { select: { users: true } } },
    });
  });

  await writeAccessProfileAuditPlans(prisma, {
    actorUserId: input.actorUserId ?? null,
    targetUserId: null,
    plans: buildAccessProfileAuditPlans({
      kind: "created",
      profileId: created.id,
      profileName: created.name,
      after: {
        permissionCount: permissions.length,
        roleBase: created.roleBase,
      },
    }),
  });

  return toDto(created, created._count.users);
}

export type UpdateAccessProfileInput = {
  name?: string;
  description?: string | null;
  roleBase?: AppUserRole | null;
  permissions?: unknown;
  isActive?: boolean;
};

export async function updateAccessProfile(
  prisma: PrismaClient,
  id: string,
  input: UpdateAccessProfileInput & { actorUserId?: string | null }
): Promise<AccessProfileDto> {
  const existing = await prisma.accessProfile.findUnique({ where: { id } });
  if (!existing) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");

  const data: Prisma.AccessProfileUpdateInput = {};
  const nextRoleBase =
    input.roleBase !== undefined ? input.roleBase : existing.roleBase;

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AccessProfileError("INVALID_NAME", "Nome inválido.");
    if (existing.isSystem && name !== existing.name) {
      throw new AccessProfileError(
        "SYSTEM_PROFILE_PROTECTED",
        "Perfis de sistema não podem ser renomeados."
      );
    }
    await assertNameAvailable(prisma, name, id);
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.roleBase !== undefined) {
    if (existing.isSystem && input.roleBase !== existing.roleBase) {
      throw new AccessProfileError(
        "SYSTEM_PROFILE_PROTECTED",
        "A role base de perfis de sistema não pode ser alterada."
      );
    }
    data.roleBase = input.roleBase;
  }
  if (input.permissions !== undefined) {
    // Snapshot: editar permissões NÃO propaga a usuários (apply é explícito).
    data.permissions = normalizePermissionsInput(input.permissions, {
      roleBase: nextRoleBase,
    });
  }
  if (input.isActive !== undefined) {
    if (input.isActive === false) {
      await assertCanDeactivateProfile(prisma, existing);
    }
    data.isActive = input.isActive;
  }

  if (Object.keys(data).length === 0) {
    const current = await getAccessProfileById(prisma, id);
    if (!current) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");
    return current;
  }

  const updated = await prisma.$transaction(async (tx) => {
    return tx.accessProfile.update({
      where: { id },
      data,
      include: { _count: { select: { users: true } } },
    });
  });

  const beforeCount = Array.isArray(existing.permissions) ? existing.permissions.length : 0;
  const afterCount = Array.isArray(updated.permissions) ? updated.permissions.length : 0;
  if (
    beforeCount !== afterCount ||
    existing.roleBase !== updated.roleBase ||
    existing.name !== updated.name ||
    existing.isActive !== updated.isActive
  ) {
    await writeAccessProfileAuditPlans(prisma, {
      actorUserId: input.actorUserId ?? null,
      targetUserId: null,
      plans: buildAccessProfileAuditPlans({
        kind: "updated",
        profileId: updated.id,
        profileName: updated.name,
        before: {
          permissionCount: beforeCount,
          roleBase: existing.roleBase,
        },
        after: {
          permissionCount: afterCount,
          roleBase: updated.roleBase,
        },
      }),
    });
  }

  return toDto(updated, updated._count.users);
}

async function assertCanDeactivateProfile(
  prisma: PrismaClient,
  profile: AccessProfile
): Promise<void> {
  if (!hasAdminCapability(profile.permissions, profile.roleBase)) return;

  const otherAdmins = await countActiveAdminProfiles(prisma, profile.id);
  if (otherAdmins === 0) {
    throw new AccessProfileError(
      "LAST_ADMIN_PROFILE",
      "Este é o último perfil ativo com permissões administrativas. Ative outro perfil administrativo antes de inativar."
    );
  }
}

export async function setAccessProfileStatus(
  prisma: PrismaClient,
  id: string,
  isActive: boolean
): Promise<AccessProfileDto> {
  return updateAccessProfile(prisma, id, { isActive });
}

export async function deleteAccessProfile(
  prisma: PrismaClient,
  id: string
): Promise<void> {
  const existing = await prisma.accessProfile.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");
  if (existing.isSystem) {
    throw new AccessProfileError(
      "SYSTEM_PROFILE_PROTECTED",
      "Perfis de sistema não podem ser excluídos. Inative o perfil se necessário."
    );
  }
  if (existing._count.users > 0) {
    throw new AccessProfileError(
      "PROFILE_IN_USE",
      `Perfil em uso por ${existing._count.users} usuário(s). Inative em vez de excluir.`
    );
  }
  await prisma.accessProfile.delete({ where: { id } });
}

export async function duplicateAccessProfile(
  prisma: PrismaClient,
  id: string,
  name?: string
): Promise<AccessProfileDto> {
  const source = await prisma.accessProfile.findUnique({ where: { id } });
  if (!source) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");

  const baseName = name?.trim() || `${source.name} (cópia)`;
  let candidate = baseName;
  let suffix = 2;
  while (await prisma.accessProfile.findUnique({ where: { name: candidate } })) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return createAccessProfile(prisma, {
    name: candidate,
    description: source.description,
    roleBase: source.roleBase,
    permissions: source.permissions,
    isActive: true,
  });
}

export async function resolveAccessProfileForUser(
  prisma: PrismaClient,
  accessProfileId: string | null | undefined
): Promise<AccessProfile | null> {
  if (!accessProfileId) return null;
  const profile = await prisma.accessProfile.findUnique({ where: { id: accessProfileId } });
  if (!profile) throw new AccessProfileError("INVALID_PROFILE", "Perfil de acesso inválido.");
  if (!profile.isActive) {
    throw new AccessProfileError("INACTIVE_PROFILE", "Perfil de acesso está inativo.");
  }
  return profile;
}

export type AccessProfileLinkedUserDto = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  permissions: string[];
  matchesProfile: boolean;
};

/** Usuários com FK no perfil (não implica permissões iguais ao snapshot atual). */
export async function listAccessProfileLinkedUsers(
  prisma: PrismaClient,
  profileId: string
): Promise<{ profile: AccessProfileDto; users: AccessProfileLinkedUserDto[] }> {
  const profile = await getAccessProfileById(prisma, profileId);
  if (!profile) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");

  const users = await prisma.appUser.findMany({
    where: { accessProfileId: profileId },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      permissions: true,
    },
  });

  return {
    profile,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      permissions: filterKnownPermissions(u.permissions),
      matchesProfile: permissionsMatchProfile(u.permissions, profile.permissions),
    })),
  };
}

export type AccessProfileApplyPreviewUser = {
  id: string;
  name: string;
  email: string;
  beforePermissions: string[];
  afterPermissions: string[];
  beforeRole: AppUserRole;
  afterRole: AppUserRole;
  willChange: boolean;
  matchesProfileBefore: boolean;
  gained: string[];
  lost: string[];
};

export type AccessProfileApplyPreview = {
  profileId: string;
  profileName: string;
  profilePermissions: string[];
  users: AccessProfileApplyPreviewUser[];
  changeCount: number;
  customizedCount: number;
};

function computeApplyTarget(
  profile: AccessProfile,
  user: { role: AppUserRole; permissions: string[] }
): {
  afterRole: AppUserRole;
  afterPermissions: string[];
} {
  const applied = applyAccessProfileToUserFields({
    roleBase: profile.roleBase,
    permissions: profile.permissions,
  });
  return {
    afterRole: applied.role ?? user.role,
    afterPermissions: filterKnownPermissions(applied.permissions).sort(),
  };
}

export async function previewApplyAccessProfile(
  prisma: PrismaClient,
  profileId: string,
  userIds?: string[] | null
): Promise<AccessProfileApplyPreview> {
  const profileRow = await prisma.accessProfile.findUnique({ where: { id: profileId } });
  if (!profileRow) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");

  // Com userIds: aplica/vincula aos usuários informados (mesmo sem FK prévia).
  // Sem userIds: reaplica aos já vinculados ao perfil.
  const where: Prisma.AppUserWhereInput =
    userIds && userIds.length > 0
      ? { id: { in: userIds } }
      : { accessProfileId: profileId };

  const users = await prisma.appUser.findMany({
    where,
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
    },
  });

  const profilePermissions = filterKnownPermissions(profileRow.permissions).sort();
  const previewUsers: AccessProfileApplyPreviewUser[] = users.map((u) => {
    const beforePermissions = filterKnownPermissions(u.permissions).sort();
    const target = computeApplyTarget(profileRow, u);
    const beforeSet = new Set(beforePermissions);
    const afterSet = new Set(target.afterPermissions);
    const gained = target.afterPermissions.filter((k) => !beforeSet.has(k));
    const lost = beforePermissions.filter((k) => !afterSet.has(k));
    const willChange =
      u.role !== target.afterRole ||
      gained.length > 0 ||
      lost.length > 0;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      beforePermissions,
      afterPermissions: target.afterPermissions,
      beforeRole: u.role,
      afterRole: target.afterRole,
      willChange,
      matchesProfileBefore: permissionsMatchProfile(u.permissions, profileRow.permissions),
      gained,
      lost,
    };
  });

  return {
    profileId: profileRow.id,
    profileName: profileRow.name,
    profilePermissions,
    users: previewUsers,
    changeCount: previewUsers.filter((u) => u.willChange).length,
    customizedCount: previewUsers.filter((u) => !u.matchesProfileBefore).length,
  };
}

export type ApplyAccessProfileResult = {
  applied: number;
  skipped: number;
  results: Array<{
    userId: string;
    status: "applied" | "skipped_unchanged" | "skipped_customized";
  }>;
};

/**
 * Aplica snapshot do perfil aos usuários (manual).
 * Não é chamado ao salvar o perfil — anti-cascade.
 * Transacional; em erro faz rollback.
 */
export async function applyAccessProfileToUsers(
  prisma: PrismaClient,
  args: {
    profileId: string;
    userIds?: string[] | null;
    confirm: boolean;
    actorUserId?: string | null;
    /** Se false, pula usuários que já customizaram permissões. Default true com confirm. */
    overwriteCustomized?: boolean;
  }
): Promise<ApplyAccessProfileResult> {
  if (!args.confirm) {
    throw new AccessProfileError(
      "CONFIRM_REQUIRED",
      "Confirme a aplicação manual do perfil aos usuários selecionados."
    );
  }

  const preview = await previewApplyAccessProfile(
    prisma,
    args.profileId,
    args.userIds
  );
  const overwriteCustomized = args.overwriteCustomized !== false;

  if (preview.customizedCount > 0 && !overwriteCustomized) {
    // still allow apply for matching users only
  }

  const results: ApplyAccessProfileResult["results"] = [];
  let applied = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const u of preview.users) {
      if (!u.matchesProfileBefore && !overwriteCustomized) {
        results.push({ userId: u.id, status: "skipped_customized" });
        skipped += 1;
        continue;
      }
      // P06: aplica fotografia do perfil — limpa overrides, vincula FK, dual-write bag + bump.
      await tx.userPermissionOverride.deleteMany({ where: { userId: u.id } });
      await tx.appUser.update({
        where: { id: u.id },
        data: {
          accessProfileId: preview.profileId,
          role: u.afterRole,
          permissions: u.afterPermissions,
        },
      });
      await bumpPermissionsVersionAndSyncSessions(tx, { userId: u.id });
      if (!u.willChange) {
        results.push({ userId: u.id, status: "skipped_unchanged" });
        skipped += 1;
        continue;
      }
      results.push({ userId: u.id, status: "applied" });
      applied += 1;
    }
  });

  if (applied > 0) {
    const applyPlans: PermissionAuditEntryPlan[] = [];
    for (const r of results) {
      if (r.status !== "applied") continue;
      const u = preview.users.find((x) => x.id === r.userId);
      if (!u) continue;
      applyPlans.push(
        ...buildAccessProfileUserApplyAuditPlans({
          profileId: preview.profileId,
          profileName: preview.profileName,
          targetRole: u.afterRole,
          userId: u.id,
        })
      );
    }
    await writeAccessProfileAuditPlans(prisma, {
      actorUserId: args.actorUserId ?? null,
      targetUserId: null,
      plans: [
        ...buildAccessProfileAuditPlans({
          kind: "applied",
          profileId: preview.profileId,
          profileName: preview.profileName,
          after: {
            permissionCount: preview.profilePermissions.length,
            appliedUserCount: applied,
          },
        }),
        ...applyPlans,
      ],
    });
  }

  return { applied, skipped, results };
}

async function writeAccessProfileAuditPlans(
  prisma: PrismaClient,
  args: {
    actorUserId: string | null;
    targetUserId: string | null;
    plans: readonly PermissionAuditEntryPlan[];
  }
): Promise<void> {
  if (args.plans.length === 0) return;
  try {
    await prisma.permissionAuditLog.createMany({
      data: args.plans.map((plan) => ({
        actorUserId: args.actorUserId,
        targetUserId:
          plan.action === "ACCESS_PROFILE_APPLIED" &&
          plan.afterJson &&
          typeof plan.afterJson === "object" &&
          typeof (plan.afterJson as { userId?: string }).userId === "string"
            ? (plan.afterJson as { userId: string }).userId
            : args.targetUserId,
        targetRole: plan.targetRole as AppUserRole,
        resourceKey: plan.resourceKey,
        action: plan.action,
        beforeJson: (plan.beforeJson ?? undefined) as object | undefined,
        afterJson: (plan.afterJson ?? undefined) as object | undefined,
      })),
    });
  } catch (error) {
    console.warn("[access-profile-audit] falha ao gravar auditoria", error);
  }
}

export function parseAccessProfileBody(body: unknown): {
  name?: string;
  description?: string | null;
  roleBase?: AppUserRole | null;
  permissions?: unknown;
  isActive?: boolean;
} {
  if (!body || typeof body !== "object") {
    throw new AccessProfileError("INVALID_BODY", "Payload inválido para perfil de acesso.");
  }
  const data = body as Record<string, unknown>;
  let roleBase: AppUserRole | null | undefined = undefined;
  if (data.roleBase === null || data.roleBase === "") {
    roleBase = null;
  } else if (data.roleBase !== undefined) {
    const parsed = parseAppUserRole(data.roleBase);
    if (parsed == null) {
      throw new AccessProfileError(
        "INVALID_ROLE_BASE",
        "Role base inválida. Use SUPER_ADMIN, ADMIN, COMMERCIAL_MANAGER, SELLER ou VIEWER."
      );
    }
    roleBase = parsed;
  }

  return {
    name: typeof data.name === "string" ? data.name : undefined,
    description:
      data.description === null
        ? null
        : typeof data.description === "string"
          ? data.description
          : undefined,
    roleBase,
    permissions: data.permissions,
    isActive: data.isActive === undefined ? undefined : Boolean(data.isActive),
  };
}

export class AccessProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AccessProfileError";
  }
}
