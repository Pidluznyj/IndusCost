/**
 * PERM-29 — Atribuição de perfil + exceções individuais (ALLOW/DENY/INHERIT) + save round-trip.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppUserRole } from "@prisma/client";
import {
  assertCanChangeSuperAdminRole,
  buildUserPermissionsPayload,
  normalizeOverrideInputs,
  resolveUserPermissionBaselineFlags,
  restoreUserPermissionBaseline,
  saveUserPermissionOverrides,
  UserPermissionAdminError,
} from "./userPermissionAdminService.ts";
import {
  buildSaveOverridesFromMatrix,
  buildUserPermissionMatrixModel,
  USER_PERMISSION_PRECEDENCE_NOTICE,
} from "@/src/lib/userPermissionsMatrix.ts";
import { applyDenyOnResource, applyAllowOnResource, clearMatrixOverrideForResource } from "@/src/lib/userPermissionsMatrix.ts";
import { canEffectiveAccess, resolveEffectiveAccess } from "@/src/lib/security/effectiveAccess/index.ts";

/** Chaves legadas conhecidas (bag) — projetam para recursos da matriz. */
const PROFILE_PERMS = ["dashboard.view", "crm.view"];

function makePrismaMock(args: {
  role?: AppUserRole;
  permissions?: string[];
  accessProfile?: {
    id: string;
    name: string;
    permissions: string[];
    roleBase: AppUserRole | null;
  } | null;
  overrides?: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason?: string | null;
  }>;
}) {
  let overrides = [...(args.overrides ?? [])];
  const accessProfile = args.accessProfile ?? null;
  const user = {
    id: "user-1",
    name: "Target",
    email: "t@example.com",
    role: args.role ?? ("SELLER" as AppUserRole),
    isActive: true,
    lastLoginAt: null as Date | null,
    permissions: args.permissions ?? [...PROFILE_PERMS],
    permissionsVersion: 0,
    accessProfile,
  };

  const prisma = {
    appUser: {
      async findUnique() {
        return { ...user, accessProfile: user.accessProfile };
      },
      async count() {
        return user.role === "SUPER_ADMIN" ? 1 : 0;
      },
      async update(updateArgs: {
        data: {
          role?: AppUserRole;
          permissions?: string[];
          permissionsVersion?: { increment: number };
        };
      }) {
        if (updateArgs.data.role) user.role = updateArgs.data.role;
        if (updateArgs.data.permissions) user.permissions = updateArgs.data.permissions;
        if (updateArgs.data.permissionsVersion?.increment) {
          user.permissionsVersion += updateArgs.data.permissionsVersion.increment;
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
      async create(createArgs: {
        data: {
          resourceKey: string;
          canView: boolean | null;
          canExecute: boolean | null;
          canManage: boolean | null;
          reason?: string | null;
        };
      }) {
        overrides.push({
          resourceKey: createArgs.data.resourceKey,
          canView: createArgs.data.canView,
          canExecute: createArgs.data.canExecute,
          canManage: createArgs.data.canManage,
          reason: createArgs.data.reason ?? null,
        });
        return createArgs.data;
      },
    },
    permissionAuditLog: {
      async createMany() {
        return { count: 0 };
      },
      async create() {
        return {};
      },
    },
    rolePermission: {
      async count() {
        return 0;
      },
    },
    async $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      return fn(prisma);
    },
  };

  return {
    prisma: prisma as never,
    user,
    getOverrides: () => overrides,
  };
}

describe("PERM-29 user permission assign", () => {
  it("notice documenta precedência SUPER_ADMIN / deny / allow / perfil / deny default", () => {
    const n = USER_PERMISSION_PRECEDENCE_NOTICE.toLowerCase();
    assert.ok(n.includes("super_admin"));
    assert.ok(n.includes("deny"));
    assert.ok(n.includes("allow"));
    assert.ok(n.includes("perfil") || n.includes("snapshot"));
  });

  it("resolver: SUPER_ADMIN > DENY > ALLOW > profile snapshot > DENY default", () => {
    // Contrato oficial usa resourceKeys EN (commercial.*); admin matrix usa aliases PT.
    const profileSnapshot = {
      "finance.accounts_payable": { view: true },
    };

    const withProfile = resolveEffectiveAccess({
      userId: "u",
      role: "VIEWER",
      profileSnapshot,
      overrides: {},
    });
    assert.equal(canEffectiveAccess(withProfile, "finance.accounts_payable", "view"), true);
    assert.equal(
      withProfile.byResourceAction["finance.accounts_payable"]?.view?.source,
      "PROFILE"
    );

    const denied = resolveEffectiveAccess({
      userId: "u",
      role: "VIEWER",
      profileSnapshot,
      overrides: { "finance.accounts_payable": { view: "deny" } },
    });
    assert.equal(canEffectiveAccess(denied, "finance.accounts_payable", "view"), false);
    assert.equal(
      denied.byResourceAction["finance.accounts_payable"]?.view?.source,
      "OVERRIDE_DENY"
    );

    const allowed = resolveEffectiveAccess({
      userId: "u",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: { "finance.accounts_payable": { view: "allow" } },
    });
    assert.equal(canEffectiveAccess(allowed, "finance.accounts_payable", "view"), true);
    assert.equal(
      allowed.byResourceAction["finance.accounts_payable"]?.view?.source,
      "OVERRIDE_ALLOW"
    );

    const sa = resolveEffectiveAccess({
      userId: "sa",
      role: "SUPER_ADMIN",
      profileSnapshot: {},
      overrides: { "finance.accounts_payable": { view: "deny" } },
      permissionsVersion: 1,
    });
    assert.equal(canEffectiveAccess(sa, "finance.accounts_payable", "view"), true);

    const bare = resolveEffectiveAccess({
      userId: "b",
      role: "VIEWER",
      profileSnapshot: {},
      overrides: {},
    });
    assert.equal(canEffectiveAccess(bare, "finance.accounts_payable", "view"), false);
  });

  it("baseline com AccessProfile substitui role no payload (INHERIT = fotografia)", () => {
    const profile = {
      id: "ap1",
      name: "Seller AP",
      permissions: PROFILE_PERMS,
      roleBase: "SELLER" as AppUserRole,
    };
    const baseline = resolveUserPermissionBaselineFlags({
      role: "ADMIN",
      accessProfile: profile,
    });
    const roleOnly = resolveUserPermissionBaselineFlags({
      role: "ADMIN",
      accessProfile: null,
    });
    // Perfil SELLER tipicamente não concede admin.usuarios; ADMIN role sim.
    assert.equal(baseline["admin.usuarios"]?.canManage ?? false, false);
    assert.equal(roleOnly["admin.usuarios"]?.canManage, true);

    const payload = buildUserPermissionsPayload({
      user: {
        id: "user-1",
        name: "T",
        email: "t@x.com",
        role: "SELLER",
        isActive: true,
        lastLoginAt: null,
        permissions: PROFILE_PERMS,
      },
      overrides: [],
      activeSuperAdminCount: 0,
      accessProfile: profile,
    });
    assert.ok(payload.accessProfile?.id === "ap1");
    assert.equal(payload.hasCustomPermissions, false);
    // Sem overrides: roleDefaults (baseline) alinhado ao efetivo da árvore
    const model = buildUserPermissionMatrixModel(payload.tree, {
      profileFlagsByKey: payload.profileFlags,
    });
    const overrides = buildSaveOverridesFromMatrix(model.draft, payload.roleDefaults);
    assert.equal(overrides.length, 0, "INHERIT puro não deve gerar overrides");
  });

  it("ALLOW / DENY / INHERIT: save + reload preserva fotografia + exceções", async () => {
    const profile = {
      id: "ap1",
      name: "Seller AP",
      permissions: PROFILE_PERMS,
      roleBase: "SELLER" as AppUserRole,
    };
    const { prisma, user, getOverrides } = makePrismaMock({
      role: "SELLER",
      permissions: PROFILE_PERMS,
      accessProfile: profile,
      overrides: [],
    });

    const before = buildUserPermissionsPayload({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: true,
        lastLoginAt: null,
        permissions: user.permissions,
      },
      overrides: [],
      activeSuperAdminCount: 0,
      accessProfile: profile,
    });
    let model = buildUserPermissionMatrixModel(before.tree, {
      profileFlagsByKey: before.profileFlags,
    });

    // DENY em recurso do perfil
    let draft = applyDenyOnResource(model.draft, "comercial.crm");
    // ALLOW em recurso fora do perfil (se existir na árvore)
    const financeKey = before.tree
      .flatMap(function walk(n: { key: string; children: typeof before.tree }): string[] {
        return [n.key, ...n.children.flatMap(walk)];
      })
      .find((k) => k.startsWith("finance"));
    if (financeKey) {
      draft = applyAllowOnResource(draft, financeKey, { view: true });
    }

    let toSave = buildSaveOverridesFromMatrix(draft, before.roleDefaults);
    assert.ok(toSave.some((o) => o.resourceKey === "comercial.crm" && o.canView === false));

    const versionBefore = user.permissionsVersion;
    await saveUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      overrides: toSave,
    });
    assert.ok(user.permissionsVersion > versionBefore, "bump permissionsVersion");
    assert.ok(getOverrides().some((o) => o.resourceKey === "comercial.crm" && o.canView === false));

    // INHERIT: limpar override de comercial.crm → volta ao snapshot
    draft = clearMatrixOverrideForResource(draft, model.baseline, "comercial.crm");
    toSave = buildSaveOverridesFromMatrix(draft, before.roleDefaults);
    assert.ok(!toSave.some((o) => o.resourceKey === "comercial.crm"));

    await saveUserPermissionOverrides(prisma, {
      userId: "user-1",
      actorUserId: "actor-1",
      isEditingSelf: false,
      overrides: toSave,
    });

    const afterOverrides = getOverrides();
    const reloaded = buildUserPermissionsPayload({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: true,
        lastLoginAt: null,
        permissions: user.permissions,
      },
      overrides: afterOverrides.map((o) => ({
        userId: user.id,
        resourceKey: o.resourceKey,
        canView: o.canView,
        canExecute: o.canExecute,
        canManage: o.canManage,
        reason: o.reason ?? null,
      })),
      activeSuperAdminCount: 0,
      accessProfile: profile,
    });
    model = buildUserPermissionMatrixModel(reloaded.tree, {
      profileFlagsByKey: reloaded.profileFlags,
    });
    const again = buildSaveOverridesFromMatrix(model.draft, reloaded.roleDefaults);
    assert.deepEqual(
      again.map((o) => o.resourceKey).sort(),
      afterOverrides.map((o) => o.resourceKey).sort(),
      "reload deve reproduzir o mesmo conjunto de overrides"
    );
  });

  it("recurso desconhecido é rejeitado (não 500)", () => {
    assert.throws(
      () => normalizeOverrideInputs([{ resourceKey: "recurso.fantasma.xyz", canView: true }]),
      (err: unknown) =>
        err instanceof UserPermissionAdminError && err.code === "UNKNOWN_RESOURCE"
    );
  });

  it("último SUPER_ADMIN não pode ser rebaixado", () => {
    assert.throws(
      () =>
        assertCanChangeSuperAdminRole({
          existingRole: "SUPER_ADMIN",
          existingActive: true,
          nextRole: "ADMIN",
          activeSuperAdminCount: 1,
        }),
      (err: unknown) =>
        err instanceof UserPermissionAdminError && err.code === "LAST_SUPER_ADMIN"
    );
  });

  it("restore com AccessProfile reaplica snapshot e limpa overrides", async () => {
    const profile = {
      id: "ap1",
      name: "Seller AP",
      permissions: PROFILE_PERMS,
      roleBase: "SELLER" as AppUserRole,
    };
    const { prisma, user, getOverrides } = makePrismaMock({
      role: "SELLER",
      permissions: ["dashboard.view", "extra.legacy"],
      accessProfile: profile,
      overrides: [
        {
          resourceKey: "comercial.crm",
          canView: false,
          canExecute: null,
          canManage: null,
        },
      ],
    });

    const versionBefore = user.permissionsVersion;
    await restoreUserPermissionBaseline(prisma, {
      userId: "user-1",
      actorUserId: "actor",
      confirmClearOverrides: true,
      isEditingSelf: false,
    });
    assert.equal(getOverrides().length, 0);
    assert.ok(user.permissionsVersion > versionBefore);
    for (const key of PROFILE_PERMS) {
      assert.ok(user.permissions.includes(key), `snapshot deve incluir ${key}`);
    }
  });
});
