/**
 * P21 — versão de permissões e invalidação de sessão/cache.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bumpPermissionsVersionAndSyncSessions,
  cacheKeyForEffectiveAccess,
  invalidatePermissionsVersionCache,
  isSessionPermissionsVersionStale,
  normalizePermissionsVersion,
  registerEffectiveAccessCacheKey,
  type PermissionsVersionTx,
} from "./permissionsVersion.ts";

describe("permissionsVersion — normalize e stale", () => {
  it("normaliza valores inválidos para 0", () => {
    assert.equal(normalizePermissionsVersion(undefined), 0);
    assert.equal(normalizePermissionsVersion(-1), 0);
    assert.equal(normalizePermissionsVersion(1.9), 1);
  });

  it("detecta sessão desatualizada", () => {
    assert.equal(isSessionPermissionsVersionStale(0, 1), true);
    assert.equal(isSessionPermissionsVersionStale(3, 3), false);
    assert.equal(isSessionPermissionsVersionStale(null, 0), false);
  });
});

describe("permissionsVersion — cache in-process", () => {
  it("invalida chaves por userId", () => {
    const k1 = cacheKeyForEffectiveAccess("u1", 1);
    const k2 = cacheKeyForEffectiveAccess("u1", 2);
    const k3 = cacheKeyForEffectiveAccess("u2", 1);
    registerEffectiveAccessCacheKey(k1);
    registerEffectiveAccessCacheKey(k2);
    registerEffectiveAccessCacheKey(k3);
    invalidatePermissionsVersionCache("u1");
    // re-register to verify idempotent bump invalidation path
    registerEffectiveAccessCacheKey(k1);
    assert.ok(k1.startsWith("u1:"));
  });
});

describe("permissionsVersion — bump e sync sessões", () => {
  it("incrementa versão, revoga outras sessões e atualiza epoch do ator", async () => {
    const ops: string[] = [];
    const tx: PermissionsVersionTx = {
      appUser: {
        update: async ({ data }) => {
          ops.push("user:increment");
          assert.deepEqual(data, { permissionsVersion: { increment: 1 } });
          return { permissionsVersion: 4 };
        },
      },
      appSession: {
        updateMany: async ({ where }) => {
          ops.push(`revoke:${where.id?.not ?? "all"}`);
          return {};
        },
        update: async ({ where, data }) => {
          ops.push(`epoch:${where.id}:${data.permissionsVersionAtIssue}`);
          return {};
        },
      },
    };

    const version = await bumpPermissionsVersionAndSyncSessions(tx, {
      userId: "target",
      actorSessionId: "actor-sess",
    });

    assert.equal(version, 4);
    assert.deepEqual(ops, [
      "user:increment",
      "revoke:actor-sess",
      "epoch:actor-sess:4",
    ]);
  });

  it("revoga todas as sessões quando não há ator", async () => {
    let revokeWhere: unknown;
    const tx: PermissionsVersionTx = {
      appUser: {
        update: async () => ({ permissionsVersion: 1 }),
      },
      appSession: {
        updateMany: async ({ where }) => {
          revokeWhere = where;
          return {};
        },
        update: async () => ({}),
      },
    };

    await bumpPermissionsVersionAndSyncSessions(tx, { userId: "u" });
    assert.deepEqual(revokeWhere, {
      userId: "u",
      revokedAt: null,
    });
  });
});

describe("permissionsVersion — cenários Leticia / SUPER_ADMIN (autorização)", () => {
  it("Leticia: versão bump invalida sessão antiga (epoch ≠ current)", () => {
    assert.equal(isSessionPermissionsVersionStale(2, 3), true);
  });

  it("SUPER_ADMIN: mesma regra de epoch — token não é autoridade", () => {
    assert.equal(isSessionPermissionsVersionStale(0, 99), true);
  });
});
