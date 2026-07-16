import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  saveUserPermissionOverrides,
  applyRolePresetToUser,
  clearUserPermissionOverrides,
  UserPermissionAdminError,
} from "./userPermissionAdminService.ts";
import { PermissionAuditActions } from "./permissionAudit.ts";
import type { AppUserRole } from "@prisma/client";

type AuditRow = {
  action: string;
  resourceKey: string | null;
  targetUserId: string;
};

function makePrismaMock(args: {
  role?: AppUserRole;
  permissions?: string[];
  overrides?: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason?: string | null;
  }>;
}) {
  const audits: AuditRow[] = [];
  let overrides = [...(args.overrides ?? [])];
  const user = {
    id: "user-1",
    name: "Target",
    email: "t@example.com",
    role: args.role ?? ("SELLER" as AppUserRole),
    isActive: true,
    lastLoginAt: null as Date | null,
    permissions: args.permissions ?? [],
    permissionsVersion: 0,
  };

  const prisma = {
    appUser: {
      async findUnique() {
        return { ...user };
      },
      async count() {
        return user.role === "SUPER_ADMIN" ? 1 : 0;
      },
      async update(_args: {
        data: {
          role?: AppUserRole;
          permissions?: string[];
          permissionsVersion?: { increment: number };
        };
      }) {
        if (_args.data.role) user.role = _args.data.role;
        if (_args.data.permissions) user.permissions = _args.data.permissions;
        if (_args.data.permissionsVersion?.increment) {
          user.permissionsVersion += _args.data.permissionsVersion.increment;
        }
        return { ...user, permissionsVersion: user.permissionsVersion };
      },
    },
    appSession: {
      async updateMany() {
        return { count: 0 };
      },
      async update() {
        return {};
      },
    },
    permissionResource: {
      async upsert() {
        return {};
      },
      async findUnique() {
        return null;
      },
      async create() {
        return {};
      },
      async update() {
        return {};
      },
      async count() {
        return 0;
      },
    },
    userPermissionOverride: {
      async findMany() {
        return overrides.map((o) => ({
          userId: user.id,
          ...o,
          reason: o.reason ?? null,
        }));
      },
      async deleteMany() {
        overrides = [];
        return { count: 0 };
      },
      async create(args: {
        data: {
          resourceKey: string;
          canView: boolean | null;
          canExecute: boolean | null;
          canManage: boolean | null;
          reason?: string | null;
        };
      }) {
        overrides.push({
          resourceKey: args.data.resourceKey,
          canView: args.data.canView,
          canExecute: args.data.canExecute,
          canManage: args.data.canManage,
          reason: args.data.reason ?? null,
        });
        return args.data;
      },
    },
    permissionAuditLog: {
      async createMany(args: {
        data: Array<{ action: string; resourceKey: string | null; targetUserId: string }>;
      }) {
        for (const row of args.data) {
          audits.push({
            action: row.action,
            resourceKey: row.resourceKey,
            targetUserId: row.targetUserId,
          });
        }
        return { count: args.data.length };
      },
      async create(args: {
        data: { action: string; resourceKey: string | null; targetUserId: string };
      }) {
        audits.push({
          action: args.data.action,
          resourceKey: args.data.resourceKey,
          targetUserId: args.data.targetUserId,
        });
        return args.data;
      },
    },
    async $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      return fn(prisma);
    },
  };

  return { prisma: prisma as never, audits, getOverrides: () => overrides };
}

describe("userPermissionAdminService — auditoria", () => {
  it("salvar override cria auditoria", async () => {
    const { prisma, audits } = makePrismaMock({ overrides: [] });
    await saveUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      overrides: [{ resourceKey: "comercial.crm", canView: true }],
      reason: "teste",
    });
    assert.ok(audits.some((a) => a.action === PermissionAuditActions.OVERRIDE_CREATED));
  });

  it("remover override cria auditoria", async () => {
    const { prisma, audits } = makePrismaMock({
      overrides: [
        {
          resourceKey: "comercial.crm",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
    });
    await saveUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      overrides: [],
    });
    assert.ok(audits.some((a) => a.action === PermissionAuditActions.OVERRIDE_REMOVED));
  });

  it("aplicar preset cria auditoria", async () => {
    const { prisma, audits } = makePrismaMock({
      overrides: [
        {
          resourceKey: "comercial.crm",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      permissions: ["legacy.x"],
    });
    await applyRolePresetToUser(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      confirmClearOverrides: true,
      auditKind: "preset",
    });
    assert.ok(audits.some((a) => a.action === PermissionAuditActions.PRESET_APPLIED));
    assert.ok(audits.some((a) => a.action === PermissionAuditActions.OVERRIDE_REMOVED));
  });

  it("clear overrides (restore) cria PERMISSIONS_RESTORED_TO_DEFAULT", async () => {
    const { prisma, audits } = makePrismaMock({
      overrides: [
        {
          resourceKey: "comercial.crm",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
    });
    await clearUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      confirm: true,
      isEditingSelf: false,
    });
    assert.ok(
      audits.some((a) => a.action === PermissionAuditActions.PERMISSIONS_RESTORED_TO_DEFAULT)
    );
  });

  it("salvar sem mudança real não gera auditoria", async () => {
    const existing = {
      resourceKey: "comercial.crm",
      canView: true as boolean | null,
      canExecute: null as boolean | null,
      canManage: null as boolean | null,
    };
    const { prisma, audits } = makePrismaMock({ overrides: [existing] });
    await saveUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      overrides: [{ resourceKey: "comercial.crm", canView: true }],
    });
    assert.equal(audits.length, 0);
  });

  it("FK de catálogo ausente vira PERMISSION_CATALOG_MISSING", async () => {
    const { prisma } = makePrismaMock({ overrides: [] });
    // Força falha no create de override (simula FK para PermissionResource).
    (prisma as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).$transaction =
      async (fn) => {
        const tx = {
          userPermissionOverride: {
            async deleteMany() {
              return { count: 0 };
            },
            async create() {
              const err = new Error(
                "Foreign key constraint failed on the field: `resourceKey` (P2003)"
              );
              throw err;
            },
          },
          appUser: {
            async update() {
              return { permissionsVersion: 0 };
            },
          },
          appSession: {
            async updateMany() {
              return { count: 0 };
            },
            async update() {
              return {};
            },
          },
        };
        return fn(tx);
      };
    await assert.rejects(
      () =>
        saveUserPermissionOverrides(prisma, {
          userId: "user-1",
          actorUserId: "actor-1",
          isEditingSelf: false,
          overrides: [{ resourceKey: "comercial.crm", canView: true }],
        }),
      (err: unknown) =>
        err instanceof UserPermissionAdminError && err.code === "PERMISSION_CATALOG_MISSING"
    );
  });
});
