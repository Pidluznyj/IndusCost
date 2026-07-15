import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCatalogSeedPlanReady,
  buildPermissionCatalogSeedPlan,
  createInMemoryPermissionCatalogSeedPort,
  diffCatalogSeedPlan,
  formatCatalogSeedDiffMarkdown,
  runPermissionCatalogSeed,
} from "./index.ts";

describe("permissionCatalogSeed plan", () => {
  it("gera plano com canônicos + legado e parents válidos", () => {
    const plan = buildPermissionCatalogSeedPlan();
    assertCatalogSeedPlanReady(plan);
    assert.ok(plan.rows.length >= 76 + 40, `rows ${plan.rows.length}`);
    assert.ok(plan.rows.some((r) => r.key === "commercial.sales_orders"));
    assert.ok(plan.rows.some((r) => r.key === "comissoes"));
    assert.ok(plan.rows.some((r) => r.source === "canonical_contract"));
    assert.ok(plan.rows.some((r) => r.source === "legacy_pt_seed"));

    const keys = new Set(plan.rows.map((r) => r.key));
    for (const row of plan.rows) {
      if (row.parentKey) assert.ok(keys.has(row.parentKey), row.key);
    }

    // Pais antes dos filhos
    const index = new Map(plan.rows.map((r, i) => [r.key, i]));
    for (const row of plan.rows) {
      if (!row.parentKey) continue;
      assert.ok(
        (index.get(row.parentKey) ?? Infinity) < (index.get(row.key) ?? -1),
        `${row.parentKey} before ${row.key}`
      );
    }
  });

  it("marca legado obsoleto UI de forma auditável", () => {
    const plan = buildPermissionCatalogSeedPlan();
    const dash = plan.rows.find((r) => r.key === "comissoes.tab.dashboard");
    assert.ok(dash);
    assert.equal(dash!.legacyRetain, true);
    assert.ok(dash!.description.includes("[obsolete_ui]"));
    assert.equal(dash!.isActive, true);
  });
});

describe("permissionCatalogSeed idempotence", () => {
  it("banco vazio → cria; segunda apply → zero alteração material", async () => {
    const port = createInMemoryPermissionCatalogSeedPort([]);
    const first = await runPermissionCatalogSeed({ port, dryRun: false });
    assert.ok(first.createCount > 100, `created ${first.createCount}`);
    assert.equal(first.updateCount, 0);

    const second = await runPermissionCatalogSeed({ port, dryRun: false });
    assert.equal(second.createCount, 0);
    assert.equal(second.updateCount, 0);
    assert.ok(second.unchangedCount + second.retainLegacyCount > 100);
  });

  it("dry-run não escreve", async () => {
    const port = createInMemoryPermissionCatalogSeedPort([]);
    const dry = await runPermissionCatalogSeed({ port, dryRun: true });
    assert.ok(dry.createCount > 0);
    assert.equal((await port.listResources()).length, 0);
  });

  it("banco parcial só cria ausentes", async () => {
    const plan = buildPermissionCatalogSeedPlan();
    const dashboard = plan.rows.find((r) => r.key === "dashboard")!;
    const port = createInMemoryPermissionCatalogSeedPort([
      {
        key: dashboard.key,
        label: dashboard.label,
        description: dashboard.description,
        type: dashboard.type,
        parentKey: dashboard.parentKey,
        module: dashboard.module,
        sortOrder: dashboard.sortOrder,
        isSystem: true,
        isActive: true,
      },
    ]);
    const report = await runPermissionCatalogSeed({ port, dryRun: false });
    assert.equal(report.createCount, plan.rows.length - 1);
    assert.ok(port.store.has("commercial.sales_orders"));
    assert.ok(port.store.has("comissoes"));
  });

  it("recurso legado pré-existente é atualizado só se metadados mudarem", async () => {
    const plan = buildPermissionCatalogSeedPlan();
    const legacy = plan.rows.find((r) => r.key === "comissoes")!;
    const port = createInMemoryPermissionCatalogSeedPort([
      {
        key: legacy.key,
        label: "OLD LABEL",
        description: "old",
        type: legacy.type,
        parentKey: legacy.parentKey,
        module: legacy.module,
        sortOrder: legacy.sortOrder,
        isSystem: true,
        isActive: true,
      },
    ]);
    const report = await runPermissionCatalogSeed({ port, dryRun: false });
    assert.ok(report.updateCount >= 1);
    assert.equal(port.store.get("comissoes")?.label, legacy.label);
  });

  it("parent ausente no apply falha e faz rollback", async () => {
    const port = createInMemoryPermissionCatalogSeedPort([]);
    const plan = buildPermissionCatalogSeedPlan();
    // Remove parent "commercial" from plan rows but keep a child → assert should catch
    const broken = {
      ...plan,
      rows: plan.rows.filter((r) => r.key !== "commercial"),
      issues: [
        ...plan.issues,
        { code: "MISSING_PARENT", message: "commercial.sales_orders → commercial" },
      ],
    };
    await assert.rejects(
      () => runPermissionCatalogSeed({ port, dryRun: false, plan: broken }),
      /Plano de seed inválido|MISSING_PARENT/
    );
    assert.equal(port.store.size, 0);
  });

  it("rollback de erro mid-apply restaura snapshot", async () => {
    const base = createInMemoryPermissionCatalogSeedPort([]);
    const plan = buildPermissionCatalogSeedPlan();
    let created = 0;
    const flaky = createInMemoryPermissionCatalogSeedPort([]);
    flaky.createResource = async (row) => {
      created += 1;
      if (created === 5) throw new Error("boom");
      return base.createResource.call(flaky, row);
    };
    // Rebind store to same map as create path
    flaky.store = base.store;
    flaky.listResources = async () => [...base.store.values()];
    flaky.updateResource = async (key, row) => base.updateResource.call(flaky, key, row);
    flaky.transaction = async (fn) => {
      const snapshot = new Map(
        [...base.store.entries()].map(([k, v]) => [k, { ...v }])
      );
      try {
        return await fn(flaky);
      } catch (e) {
        base.store.clear();
        for (const [k, v] of snapshot) base.store.set(k, v);
        throw e;
      }
    };

    await assert.rejects(
      () => runPermissionCatalogSeed({ port: flaky, dryRun: false, plan }),
      /boom/
    );
    assert.equal(base.store.size, 0);
  });

  it("diff markdown cobre creates", () => {
    const plan = buildPermissionCatalogSeedPlan();
    const changes = diffCatalogSeedPlan(plan, []);
    const report = {
      dryRun: true,
      createCount: changes.filter((c) => c.kind === "create").length,
      updateCount: 0,
      unchangedCount: 0,
      retainLegacyCount: 0,
      changes,
      issues: plan.issues,
      note: "test",
    };
    const md = formatCatalogSeedDiffMarkdown(report);
    assert.ok(md.includes("CREATE"));
    assert.ok(md.includes("commercial.sales_orders"));
  });
});
