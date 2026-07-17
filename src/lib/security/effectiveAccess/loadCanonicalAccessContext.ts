/**
 * PERM-30 — Carrega overrides + snapshot de perfil para o resolvedor canônico.
 * Não usa AppUser.permissions[] na decisão.
 * Fail-closed: erros de leitura propagam (guard → 500); perfil vinculado sem
 * row → snapshot vazio (deny-by-default), nunca fallback silencioso para role.
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
  const rows = await prisma.userPermissionOverride.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { resourceKey: "asc" }],
    select: {
      resourceKey: true,
      canView: true,
      canExecute: true,
      canManage: true,
    },
  });
  return rows;
}

export async function loadUserAccessProfileSnapshot(
  prisma: PrismaLike,
  userId: string
): Promise<EffectiveAccessBaselineMap | undefined> {
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      accessProfileId: true,
      accessProfile: {
        select: { permissions: true },
      },
    },
  });
  if (!user) return undefined;
  // Perfil vinculado: snapshot (mesmo vazio) substitui role — nunca falha aberta.
  if (user.accessProfileId) {
    if (!user.accessProfile) {
      return {};
    }
    return projectAccessProfilePermissionsToSnapshot(
      filterKnownPermissions(user.accessProfile.permissions)
    );
  }
  return undefined;
}

/** Loaders prontos para `createRequireResourceGuards` / middleware. */
export function createCanonicalAccessLoaders(prisma: PrismaLike) {
  return {
    loadOverrides: (userId: string) => loadUserPermissionOverrides(prisma, userId),
    loadProfileSnapshot: (userId: string) =>
      loadUserAccessProfileSnapshot(prisma, userId),
  };
}
