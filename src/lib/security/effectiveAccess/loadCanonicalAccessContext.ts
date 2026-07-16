/**
 * PERM-30 — Carrega overrides + snapshot de perfil para o resolvedor canônico.
 * Não usa AppUser.permissions[] na decisão.
 */

import type { PrismaClient } from "@prisma/client";
import { filterKnownPermissions } from "@/src/lib/appAuth.js";
import { projectAccessProfilePermissionsToSnapshot } from "./canonicalEffectiveAccess.ts";
import type { EffectiveAccessBaselineMap } from "./types.ts";
import type { SeedAxisOverride } from "@/src/lib/security/effectiveAccessDto/mapOverrides.js";

type PrismaLike = Pick<PrismaClient, "userPermissionOverride" | "appUser">;

export async function loadUserPermissionOverrides(
  prisma: PrismaLike,
  userId: string
): Promise<SeedAxisOverride[]> {
  try {
    const rows = await prisma.userPermissionOverride.findMany({
      where: { userId },
      select: {
        resourceKey: true,
        canView: true,
        canExecute: true,
        canManage: true,
      },
    });
    return rows;
  } catch {
    return [];
  }
}

export async function loadUserAccessProfileSnapshot(
  prisma: PrismaLike,
  userId: string
): Promise<EffectiveAccessBaselineMap | undefined> {
  try {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      select: {
        accessProfile: {
          select: { permissions: true },
        },
      },
    });
    if (!user?.accessProfile) return undefined;
    return projectAccessProfilePermissionsToSnapshot(
      filterKnownPermissions(user.accessProfile.permissions)
    );
  } catch {
    return undefined;
  }
}

/** Loaders prontos para `createRequireResourceGuards` / middleware. */
export function createCanonicalAccessLoaders(prisma: PrismaLike) {
  return {
    loadOverrides: (userId: string) => loadUserPermissionOverrides(prisma, userId),
    loadProfileSnapshot: (userId: string) =>
      loadUserAccessProfileSnapshot(prisma, userId),
  };
}
