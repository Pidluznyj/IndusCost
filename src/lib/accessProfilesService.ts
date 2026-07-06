import type { AccessProfile, AppUserRole, Prisma, PrismaClient } from "@prisma/client";
import {
  filterKnownPermissions,
  type AppAuthContext,
  hasPermission,
} from "@/src/lib/appAuth.js";
import { parseAppUserRole } from "@/src/lib/appAuthRoles.js";
import { SYSTEM_ACCESS_PROFILE_SEEDS } from "@/src/lib/accessProfilesSeedData.js";
import {
  applyAccessProfileToUserFields,
  applyProfilePermissionsRaw,
  permissionsMatchProfile,
} from "@/src/lib/accessProfilesUtils.js";

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

function normalizePermissionsInput(permissions: unknown): string[] {
  const filtered = filterKnownPermissions(permissions);
  return filtered.sort();
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
  input: CreateAccessProfileInput
): Promise<AccessProfileDto> {
  const name = input.name.trim();
  if (!name) throw new AccessProfileError("INVALID_NAME", "Informe o nome do perfil.");

  const permissions = normalizePermissionsInput(input.permissions ?? []);
  const roleBase = input.roleBase ?? null;

  const created = await prisma.accessProfile.create({
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
  input: UpdateAccessProfileInput
): Promise<AccessProfileDto> {
  const existing = await prisma.accessProfile.findUnique({ where: { id } });
  if (!existing) throw new AccessProfileError("NOT_FOUND", "Perfil não encontrado.");

  const data: Prisma.AccessProfileUpdateInput = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AccessProfileError("INVALID_NAME", "Nome inválido.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.roleBase !== undefined) {
    data.roleBase = input.roleBase;
  }
  if (input.permissions !== undefined) {
    data.permissions = normalizePermissionsInput(input.permissions);
  }
  if (input.isActive !== undefined) {
    if (input.isActive === false) {
      await assertCanDeactivateProfile(prisma, existing);
    }
    data.isActive = input.isActive;
  }

  if (Object.keys(data).length === 0) {
    throw new AccessProfileError("NO_CHANGES", "Nenhum campo para atualizar.");
  }

  const updated = await prisma.accessProfile.update({
    where: { id },
    data,
    include: { _count: { select: { users: true } } },
  });

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

export function parseAccessProfileBody(body: unknown): {
  name?: string;
  description?: string | null;
  roleBase?: AppUserRole | null;
  permissions?: unknown;
  isActive?: boolean;
} {
  if (!body || typeof body !== "object") return {};
  const data = body as Record<string, unknown>;
  let roleBase: AppUserRole | null | undefined = undefined;
  if (data.roleBase === null) roleBase = null;
  else if (data.roleBase !== undefined) roleBase = parseAppUserRole(data.roleBase);

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
