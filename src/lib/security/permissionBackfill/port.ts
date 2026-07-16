/**
 * Portas in-memory e Prisma para backfill.
 */

import type { PrismaClient } from "@prisma/client";
import { buildOverrideSaveAuditPlans } from "@/src/lib/security/permissionAudit.ts";
import type {
  BackfillOverrideRow,
  BackfillPort,
  BackfillPortUser,
} from "./types.ts";

function mapOverrides(
  rows: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason: string | null;
  }>
): BackfillOverrideRow[] {
  return rows.map((o) => ({
    resourceKey: o.resourceKey,
    canView: o.canView,
    canExecute: o.canExecute,
    canManage: o.canManage,
    reason: o.reason ?? "p20-backfill",
  }));
}

export function createInMemoryBackfillPort(
  users: BackfillPortUser[]
): BackfillPort & { store: Map<string, BackfillPortUser>; auditLog: unknown[] } {
  const store = new Map(users.map((u) => [u.userId, structuredClone(u)]));
  const auditLog: unknown[] = [];

  const port: BackfillPort & { store: Map<string, BackfillPortUser>; auditLog: unknown[] } = {
    store,
    auditLog,
    async loadUsers(userIds) {
      const all = [...store.values()];
      if (!userIds?.length) return all.map((u) => structuredClone(u));
      const set = new Set(userIds);
      return all.filter((u) => set.has(u.userId)).map((u) => structuredClone(u));
    },
    async loadUser(userId) {
      const u = store.get(userId);
      return u ? structuredClone(u) : null;
    },
    async replaceOverrides(userId, overrides) {
      const u = store.get(userId);
      if (!u) throw new Error(`missing user ${userId}`);
      u.overrides = structuredClone(overrides);
    },
    async writeAudit(args) {
      auditLog.push({
        ...args,
        plans: buildOverrideSaveAuditPlans({
          targetRole: args.targetRole,
          before: args.before,
          after: args.after,
          reason: args.reason,
        }),
      });
    },
    async transaction(fn) {
      const snapshot = new Map(
        [...store.entries()].map(([k, v]) => [k, structuredClone(v)])
      );
      try {
        return await fn(port);
      } catch (e) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw e;
      }
    },
  };
  return port;
}

export function createPrismaBackfillPort(prisma: PrismaClient): BackfillPort {
  return {
    async loadUsers(userIds) {
      const users = await prisma.appUser.findMany({
        where: userIds?.length ? { id: { in: userIds }, isActive: true } : { isActive: true },
        select: {
          id: true,
          role: true,
          permissions: true,
          accessProfileId: true,
          accessProfile: { select: { permissions: true } },
          permissionOverrides: {
            select: {
              resourceKey: true,
              canView: true,
              canExecute: true,
              canManage: true,
              reason: true,
            },
          },
        },
        orderBy: { id: "asc" },
      });
      return users.map((u) => ({
        userId: u.id,
        role: u.role,
        legacyPermissions: u.permissions,
        accessProfileId: u.accessProfileId,
        accessProfilePermissions: u.accessProfile?.permissions ?? [],
        overrides: mapOverrides(u.permissionOverrides),
      }));
    },
    async loadUser(userId) {
      const list = await this.loadUsers([userId]);
      return list[0] ?? null;
    },
    async replaceOverrides(userId, overrides) {
      await prisma.$transaction(async (tx) => {
        await tx.userPermissionOverride.deleteMany({ where: { userId } });
        for (const ov of overrides) {
          await tx.userPermissionOverride.create({
            data: {
              userId,
              resourceKey: ov.resourceKey,
              canView: ov.canView,
              canExecute: ov.canExecute,
              canManage: ov.canManage,
              reason: ov.reason,
            },
          });
        }
      });
    },
    async writeAudit(args) {
      const plans = buildOverrideSaveAuditPlans({
        targetRole: args.targetRole,
        before: args.before,
        after: args.after,
        reason: args.reason,
      });
      for (const plan of plans) {
        await prisma.permissionAuditLog.create({
          data: {
            actorUserId: args.actorUserId,
            targetUserId: args.targetUserId,
            targetRole: plan.targetRole,
            resourceKey: plan.resourceKey,
            action: plan.action,
            beforeJson: plan.beforeJson ?? undefined,
            afterJson: plan.afterJson ?? undefined,
          },
        });
      }
    },
    async transaction(fn) {
      return prisma.$transaction(async () => fn(this));
    },
  };
}
