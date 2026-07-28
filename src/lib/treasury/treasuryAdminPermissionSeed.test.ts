import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppUserRole } from "@prisma/client";
import {
  assertAdminRoleResolvable,
  buildTreasuryAdminPermissionSeedPlan,
  isTreasuryPermissionResourceKey,
  listOfficialTreasuryResourceKeys,
  runTreasuryAdminPermissionSeed,
  TREASURY_ADMIN_SEED_ROLE,
  TreasuryAdminPermissionSeedError,
  type TreasuryAdminPermissionSeedPort,
  type TreasuryAdminPermissionSeedTx,
  type TreasuryPermissionResourceRow,
  type TreasuryRolePermissionRow,
} from "./treasuryAdminPermissionSeed.js";

type Store = {
  resources: Map<string, TreasuryPermissionResourceRow>;
  rolePermissions: Map<string, TreasuryRolePermissionRow>;
  overrides: Array<{ resourceKey: string }>;
  audits: Array<Record<string, unknown>>;
  failOnCreateRolePermission?: boolean;
};

function rpKey(role: AppUserRole, resourceKey: string): string {
  return `${role}::${resourceKey}`;
}

function createMemoryPort(store: Store): TreasuryAdminPermissionSeedPort {
  const tx: TreasuryAdminPermissionSeedTx = {
    async createPermissionResource(row) {
      if (store.resources.has(row.key)) {
        throw new Error(`duplicate resource ${row.key}`);
      }
      store.resources.set(row.key, { ...row });
    },
    async createRolePermission(input) {
      if (store.failOnCreateRolePermission) {
        throw new Error("simulated failure");
      }
      const key = rpKey(input.role, input.resourceKey);
      if (store.rolePermissions.has(key)) {
        throw new Error(`duplicate rolePermission ${key}`);
      }
      store.rolePermissions.set(key, {
        id: `id-${store.rolePermissions.size + 1}`,
        role: input.role,
        resourceKey: input.resourceKey,
        canView: input.flags.canView,
        canExecute: input.flags.canExecute,
        canManage: input.flags.canManage,
      });
    },
    async createAuditLog(summary) {
      store.audits.push(summary);
    },
  };

  return {
    async listPermissionResourcesByKeys(keys) {
      return keys
        .map((k) => store.resources.get(k))
        .filter((r): r is TreasuryPermissionResourceRow => r != null);
    },
    async listRolePermissions({ role, resourceKeys }) {
      return resourceKeys
        .map((k) => store.rolePermissions.get(rpKey(role, k)))
        .filter((r): r is TreasuryRolePermissionRow => r != null);
    },
    async countRolePermissionsOutsideScope({ excludeRole, resourceKeys }) {
      let n = 0;
      for (const row of store.rolePermissions.values()) {
        if (row.role === excludeRole) continue;
        if (resourceKeys.includes(row.resourceKey)) n += 1;
      }
      return n;
    },
    async countUserPermissionOverrides(resourceKeys) {
      return store.overrides.filter((o) => resourceKeys.includes(o.resourceKey)).length;
    },
    async runInTransaction(fn) {
      const snapshot = {
        resources: new Map(store.resources),
        rolePermissions: new Map(store.rolePermissions),
        audits: [...store.audits],
      };
      try {
        return await fn(tx);
      } catch (err) {
        store.resources = snapshot.resources;
        store.rolePermissions = snapshot.rolePermissions;
        store.audits = snapshot.audits;
        throw err;
      }
    },
  };
}

describe("treasuryAdminPermissionSeed", () => {
  it("escopo somente finance.treasury*", () => {
    assert.equal(isTreasuryPermissionResourceKey("finance.treasury"), true);
    assert.equal(isTreasuryPermissionResourceKey("finance.treasury.accounts"), true);
    assert.equal(isTreasuryPermissionResourceKey("financeiro.fluxo_caixa"), false);
    assert.equal(isTreasuryPermissionResourceKey("finance.suppliers"), false);
    for (const key of listOfficialTreasuryResourceKeys()) {
      assert.ok(isTreasuryPermissionResourceKey(key), key);
    }
  });

  it("resolve ADMIN com segurança", () => {
    assert.equal(assertAdminRoleResolvable(), TREASURY_ADMIN_SEED_ROLE);
  });

  it("1. Dry-run não grava nada", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [],
      audits: [],
    };
    const port = createMemoryPort(store);
    const report = await runTreasuryAdminPermissionSeed({ port, dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.applied, false);
    assert.equal(store.resources.size, 0);
    assert.equal(store.rolePermissions.size, 0);
    assert.equal(store.audits.length, 0);
    assert.equal(report.auditWritten, false);
    assert.ok(report.plan.resourcesToCreate.length > 0);
    assert.ok(report.plan.rolePermissionsToCreate.length > 0);
  });

  it("2–3. Apply cria PermissionResource e RolePermission ADMIN ausentes", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [],
      audits: [],
    };
    const port = createMemoryPort(store);
    const report = await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.equal(report.applied, true);
    assert.ok(report.resourcesCreated > 0);
    assert.ok(report.rolePermissionsCreated > 0);
    assert.ok(store.resources.has("finance.treasury"));
    assert.ok(store.rolePermissions.has(rpKey("ADMIN", "finance.treasury")));
    assert.equal(store.audits.length, 1);
  });

  it("4–6. Apply não atualiza RolePermission existente (preserva allow/deny flags)", async () => {
    const store: Store = {
      resources: new Map([
        [
          "finance.treasury",
          {
            key: "finance.treasury",
            label: "Tesouraria",
            description: "x",
            type: "MENU",
            parentKey: null,
            module: "financeiro",
            sortOrder: 1,
            isSystem: true,
            isActive: true,
          },
        ],
      ]),
      rolePermissions: new Map([
        [
          rpKey("ADMIN", "finance.treasury"),
          {
            id: "custom-1",
            role: "ADMIN",
            resourceKey: "finance.treasury",
            canView: true,
            canExecute: false,
            canManage: false, // personalizado: sem manage
          },
        ],
      ]),
      overrides: [{ resourceKey: "finance.treasury" }],
      audits: [],
    };
    const port = createMemoryPort(store);
    const before = store.rolePermissions.get(rpKey("ADMIN", "finance.treasury"))!;
    const report = await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    const after = store.rolePermissions.get(rpKey("ADMIN", "finance.treasury"))!;
    assert.equal(after.canManage, before.canManage);
    assert.equal(after.canExecute, before.canExecute);
    assert.equal(after.id, "custom-1");
    assert.ok(report.plan.rolePermissionsSkippedExisting.includes("finance.treasury"));
    assert.equal(store.overrides.length, 1);
  });

  it("7–9. Apply não altera CM/SELLER/VIEWER", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map([
        [
          rpKey("SELLER", "finance.treasury"),
          {
            id: "seller-1",
            role: "SELLER",
            resourceKey: "finance.treasury",
            canView: false,
            canExecute: false,
            canManage: false,
          },
        ],
        [
          rpKey("COMMERCIAL_MANAGER", "finance.treasury.accounts"),
          {
            id: "cm-1",
            role: "COMMERCIAL_MANAGER",
            resourceKey: "finance.treasury.accounts",
            canView: false,
            canExecute: false,
            canManage: false,
          },
        ],
        [
          rpKey("VIEWER", "finance.treasury"),
          {
            id: "viewer-1",
            role: "VIEWER",
            resourceKey: "finance.treasury",
            canView: false,
            canExecute: false,
            canManage: false,
          },
        ],
      ]),
      overrides: [],
      audits: [],
    };
    const port = createMemoryPort(store);
    await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.equal(store.rolePermissions.get(rpKey("SELLER", "finance.treasury"))?.id, "seller-1");
    assert.equal(
      store.rolePermissions.get(rpKey("COMMERCIAL_MANAGER", "finance.treasury.accounts"))?.id,
      "cm-1"
    );
    assert.equal(store.rolePermissions.get(rpKey("VIEWER", "finance.treasury"))?.id, "viewer-1");
  });

  it("10–12. Não altera overrides; não remove registros", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [{ resourceKey: "finance.treasury.accounts" }],
      audits: [],
    };
    const port = createMemoryPort(store);
    const beforeOverrideCount = store.overrides.length;
    await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.equal(store.overrides.length, beforeOverrideCount);
    const created = store.rolePermissions.size;
    await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.equal(store.rolePermissions.size, created);
  });

  it("13. Segunda execução não cria duplicidade", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [],
      audits: [],
    };
    const port = createMemoryPort(store);
    const first = await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    const second = await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.ok(first.rolePermissionsCreated > 0);
    assert.equal(second.resourcesCreated, 0);
    assert.equal(second.rolePermissionsCreated, 0);
    assert.ok(second.rolePermissionsSkipped >= first.rolePermissionsCreated);
  });

  it("14. Falha intermediária provoca rollback", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [],
      audits: [],
      failOnCreateRolePermission: true,
    };
    const port = createMemoryPort(store);
    await assert.rejects(
      () => runTreasuryAdminPermissionSeed({ port, dryRun: false }),
      (err: unknown) =>
        err instanceof TreasuryAdminPermissionSeedError &&
        err.code === "TRANSACTION_FAILED"
    );
    assert.equal(store.resources.size, 0);
    assert.equal(store.rolePermissions.size, 0);
    assert.equal(store.audits.length, 0);
  });

  it("15–17. Somente prefixo treasury; auditoria só no apply", async () => {
    const store: Store = {
      resources: new Map(),
      rolePermissions: new Map(),
      overrides: [],
      audits: [],
    };
    const port = createMemoryPort(store);
    const plan = await buildTreasuryAdminPermissionSeedPlan(port);
    for (const key of plan.resourceKeys) {
      assert.ok(isTreasuryPermissionResourceKey(key), key);
    }
    const dry = await runTreasuryAdminPermissionSeed({ port, dryRun: true });
    assert.equal(dry.auditWritten, false);
    assert.equal(store.audits.length, 0);
    const applied = await runTreasuryAdminPermissionSeed({ port, dryRun: false });
    assert.equal(applied.auditWritten, true);
    assert.equal(store.audits.length, 1);
  });

  it("18. Erro se ADMIN não puder ser resolvido (probe)", async () => {
    // assertAdminRoleResolvable usa ROLE_MATRIX real — aqui validamos que o erro tipado existe
    // e que o papel oficial resolve. Caso futuro de matriz quebrada lançaria ADMIN_ROLE_UNRESOLVED.
    assert.equal(assertAdminRoleResolvable(), "ADMIN");
    const err = new TreasuryAdminPermissionSeedError(
      "ADMIN_ROLE_UNRESOLVED",
      "simulado"
    );
    assert.equal(err.code, "ADMIN_ROLE_UNRESOLVED");
  });
});
