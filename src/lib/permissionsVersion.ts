/**
 * P21 — invalidação de sessão/cache por `permissionsVersion`.
 * Token/sessão identifica usuário; versão é autoridade de freshness de ACL.
 */

export const PERMISSIONS_VERSION_STALE_CODE = "PERMISSIONS_VERSION_STALE";

export function normalizePermissionsVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function isSessionPermissionsVersionStale(
  sessionVersionAtIssue: unknown,
  userPermissionsVersion: unknown
): boolean {
  return (
    normalizePermissionsVersion(sessionVersionAtIssue) !==
    normalizePermissionsVersion(userPermissionsVersion)
  );
}

/** Cache leve in-process (invalidado no bump). */
const effectiveAccessCacheKeys = new Set<string>();

export function cacheKeyForEffectiveAccess(userId: string, version: number): string {
  return `${userId}:${normalizePermissionsVersion(version)}`;
}

export function invalidatePermissionsVersionCache(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of [...effectiveAccessCacheKeys]) {
    if (key.startsWith(prefix)) effectiveAccessCacheKeys.delete(key);
  }
}

export function registerEffectiveAccessCacheKey(key: string): void {
  effectiveAccessCacheKeys.add(key);
}

export type PermissionsVersionTx = {
  appUser: {
    update: (args: {
      where: { id: string };
      data: { permissionsVersion: { increment: number } };
      select: { permissionsVersion: true };
    }) => Promise<{ permissionsVersion: number }>;
  };
  appSession: {
    updateMany: (args: {
      where: {
        userId: string;
        revokedAt: null;
        id?: { not: string };
      };
      data: { revokedAt: Date };
    }) => Promise<unknown>;
    update: (args: {
      where: { id: string };
      data: { permissionsVersionAtIssue: number };
    }) => Promise<unknown>;
  };
};

/**
 * Incrementa versão e invalida sessões do alvo.
 * Mantém sessão do ator (self-edit) com epoch atualizado.
 */
export async function bumpPermissionsVersionAndSyncSessions(
  tx: PermissionsVersionTx,
  args: {
    userId: string;
    actorSessionId?: string | null;
  }
): Promise<number> {
  const updated = await tx.appUser.update({
    where: { id: args.userId },
    data: { permissionsVersion: { increment: 1 } },
    select: { permissionsVersion: true },
  });
  const newVersion = normalizePermissionsVersion(updated.permissionsVersion);
  invalidatePermissionsVersionCache(args.userId);

  await tx.appSession.updateMany({
    where: {
      userId: args.userId,
      revokedAt: null,
      ...(args.actorSessionId ? { id: { not: args.actorSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });

  if (args.actorSessionId) {
    await tx.appSession.update({
      where: { id: args.actorSessionId },
      data: { permissionsVersionAtIssue: newVersion },
    });
  }

  return newVersion;
}
