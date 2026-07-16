/**
 * PERM-31 — Contrato compacto /me, cache e invalidação.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { AppUser, AppUserRole } from "@prisma/client";
import {
  buildAuthMeEffectiveAccess,
  toSessionSafeAppUser,
  tryBuildAuthMeCompactResponse,
  type AuthMeEffectiveAccess,
} from "./authMeCompact.ts";
import {
  isValidEffectiveAccessMeDto,
  validateEffectiveAccessMeDto,
} from "@/src/lib/effectiveAccessDtoValidate.js";
import {
  __resetEffectiveAccessDtoCacheForTests,
  bumpPermissionsVersionAndSyncSessions,
  getCachedEffectiveAccessDto,
  invalidatePermissionsVersionCache,
  type PermissionsVersionTx,
} from "@/src/lib/permissionsVersion.js";

function fakeUser(partial: {
  id?: string;
  role?: AppUserRole;
  permissions?: string[];
  permissionsVersion?: number;
  accessProfile?: { id: string; name: string; permissions: string[] } | null;
}): AppUser & {
  accessProfile?: { id: string; name: string; permissions: string[] } | null;
} {
  const now = new Date();
  return {
    id: partial.id ?? "u1",
    name: "User",
    email: "u@example.com",
    passwordHash: "x",
    role: partial.role ?? "VIEWER",
    permissions: partial.permissions ?? ["dashboard.view"],
    permissionsVersion: partial.permissionsVersion ?? 3,
    accessProfileId: partial.accessProfile?.id ?? null,
    accessProfile: partial.accessProfile ?? null,
    employeeId: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  } as AppUser & {
    accessProfile?: { id: string; name: string; permissions: string[] } | null;
  };
}

describe("PERM-31 authMe compact contract", () => {
  beforeEach(() => {
    __resetEffectiveAccessDtoCacheForTests();
  });

  it("contrato: user + role + version + perfil + recursos + capacidades; sem denies/warnings", () => {
    const user = fakeUser({
      role: "VIEWER",
      permissionsVersion: 5,
      accessProfile: {
        id: "ap1",
        name: "Operacional",
        permissions: ["dashboard.view"],
      },
    });
    const compact = tryBuildAuthMeCompactResponse({
      user,
      overrides: [
        {
          resourceKey: "financeiro.contas_pagar",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      accessProfilePermissions: ["dashboard.view"],
      env: { EFFECTIVE_ACCESS_DTO_IN_ME: "1" },
    });
    assert.ok(compact);
    assert.equal(compact!.authenticated, true);
    assert.equal(compact!.user.role, "VIEWER");
    assert.equal(compact!.user.permissionsVersion, 5);
    assert.equal(compact!.user.accessProfileId, "ap1");
    assert.equal(compact!.user.accessProfileName, "Operacional");

    const ea = compact!.effectiveAccess;
    assert.equal(ea.permissionsVersion, 5);
    assert.equal(ea.role, "VIEWER");
    assert.equal(ea.compatibility.mode, "session");
    assert.deepEqual(ea.appliedProfile, { id: "ap1", name: "Operacional" });
    assert.ok(ea.allowedResources.includes("finance.accounts_payable"));
    assert.ok(ea.capabilities["finance.accounts_payable"]?.canView);
    assert.equal("denies" in ea, false);
    assert.equal("warnings" in ea, false);
    assert.equal("baselineUsed" in ea, false);
    assert.equal("byResourceAction" in ea, false);
    assert.ok(isValidEffectiveAccessMeDto(ea));
    const issues = validateEffectiveAccessMeDto(ea);
    assert.deepEqual(issues, []);
  });

  it("SUPER_ADMIN: bags vazias no user; isSuperAdmin no DTO; sem catálogo expandido", () => {
    const user = fakeUser({ role: "SUPER_ADMIN", permissions: [], permissionsVersion: 1 });
    const safe = toSessionSafeAppUser(user);
    assert.deepEqual(safe.permissions, []);
    assert.deepEqual(safe.effectivePermissions, []);

    const compact = tryBuildAuthMeCompactResponse({
      user,
      env: { EFFECTIVE_ACCESS_DTO_IN_ME: "1" },
    });
    assert.ok(compact);
    assert.equal(compact!.effectiveAccess.isSuperAdmin, true);
    assert.deepEqual(compact!.effectiveAccess.allowedResources, []);
    assert.deepEqual(compact!.user.effectivePermissions, []);
  });

  it("não ecoa bag do AccessProfile no JSON do DTO", () => {
    const user = fakeUser({
      accessProfile: {
        id: "ap1",
        name: "Seller",
        permissions: ["crm.view", "dashboard.view", "secret.internal"],
      },
    });
    const compact = tryBuildAuthMeCompactResponse({
      user,
      accessProfilePermissions: ["crm.view", "dashboard.view"],
      env: { EFFECTIVE_ACCESS_DTO_IN_ME: "1" },
    });
    const json = JSON.stringify(compact);
    assert.ok(!json.includes("secret.internal"));
    assert.ok(!json.includes('"crm.view"'));
    assert.equal(compact!.effectiveAccess.appliedProfile?.name, "Seller");
  });

  it("flag off → null (fallback legado no handler)", () => {
    assert.equal(
      tryBuildAuthMeCompactResponse({
        user: fakeUser({}),
        env: { EFFECTIVE_ACCESS_DTO_IN_ME: "0" },
      }),
      null
    );
  });
});

describe("PERM-31 authMe cache + invalidação", () => {
  beforeEach(() => {
    __resetEffectiveAccessDtoCacheForTests();
  });

  it("cache hit por userId+permissionsVersion", () => {
    const args = {
      userId: "u-cache",
      role: "VIEWER" as const,
      permissionsVersion: 2,
      overrides: [
        {
          resourceKey: "financeiro.contas_pagar",
          canView: true as boolean | null,
          canExecute: null as boolean | null,
          canManage: null as boolean | null,
        },
      ],
      appliedProfile: null,
      legacyCompatMode: false,
    };
    const first = buildAuthMeEffectiveAccess(args);
    const second = buildAuthMeEffectiveAccess(args);
    assert.equal(first, second);
    assert.equal(
      getCachedEffectiveAccessDto<AuthMeEffectiveAccess>("u-cache", 2),
      first
    );
  });

  it("invalidação no bump → próxima montagem regenera", async () => {
    const built = buildAuthMeEffectiveAccess({
      userId: "u-bump",
      role: "VIEWER",
      permissionsVersion: 1,
      overrides: [
        {
          resourceKey: "financeiro.contas_pagar",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      appliedProfile: null,
    });
    assert.ok(getCachedEffectiveAccessDto("u-bump", 1));

    let currentVersion = 1;
    const tx: PermissionsVersionTx = {
      appUser: {
        update: async () => {
          currentVersion += 1;
          return { permissionsVersion: currentVersion };
        },
      },
      appSession: {
        updateMany: async () => ({}),
        update: async () => ({}),
      },
    };
    const newVersion = await bumpPermissionsVersionAndSyncSessions(tx, {
      userId: "u-bump",
    });
    assert.equal(newVersion, 2);
    assert.equal(getCachedEffectiveAccessDto("u-bump", 1), undefined);

    const rebuilt = buildAuthMeEffectiveAccess({
      userId: "u-bump",
      role: "VIEWER",
      permissionsVersion: 2,
      overrides: [
        {
          resourceKey: "financeiro.contas_pagar",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      appliedProfile: null,
    });
    assert.notEqual(rebuilt, built);
    assert.equal(rebuilt.permissionsVersion, 2);
    assert.ok(rebuilt.allowedResources.includes("finance.accounts_payable"));
  });

  it("invalidatePermissionsVersionCache limpa todas as versões do usuário", () => {
    buildAuthMeEffectiveAccess({
      userId: "u-x",
      role: "VIEWER",
      permissionsVersion: 1,
      appliedProfile: null,
    });
    buildAuthMeEffectiveAccess({
      userId: "u-x",
      role: "VIEWER",
      permissionsVersion: 2,
      appliedProfile: null,
    });
    buildAuthMeEffectiveAccess({
      userId: "u-y",
      role: "VIEWER",
      permissionsVersion: 1,
      appliedProfile: null,
    });
    invalidatePermissionsVersionCache("u-x");
    assert.equal(getCachedEffectiveAccessDto("u-x", 1), undefined);
    assert.equal(getCachedEffectiveAccessDto("u-x", 2), undefined);
    assert.ok(getCachedEffectiveAccessDto("u-y", 1));
  });
});
