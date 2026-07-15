import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectiveFlagsMap, materializeLegacyPermissionsFromFlags } from "@/src/lib/security/permissionRolePresets.js";
import {
  applyDualWrite,
  buildDualWriteAliasIndex,
  buildDualWriteCompatibilityReport,
  createInMemoryDualWritePort,
  formatDualWriteCompatibilityMarkdown,
  getDualWriteAliasIndex,
  listAliasCollisions,
  listCatalogKeysWithoutStructuralAlias,
  materializeStructuredToLegacy,
  planLegacyToStructured,
  planStructuredToLegacy,
  projectLegacyToStructured,
  roundTripLegacy,
  roundTripStructured,
} from "./index.ts";
import { buildAllDualWriteFixtures } from "./fixtures.ts";

describe("permissionDualWrite alias index", () => {
  it("indexa aliases do seed e reporta colisões", () => {
    const index = buildDualWriteAliasIndex();
    assert.ok(index.mappedLegacyKeys.size > 20);
    assert.ok(index.byLegacy.has("dashboard.view") || index.mappedLegacyKeys.size > 0);
    const collisions = listAliasCollisions(index);
    assert.ok(Array.isArray(collisions));
  });

  it("lista chaves de catálogo sem mapeamento estrutural", () => {
    const unmapped = listCatalogKeysWithoutStructuralAlias();
    assert.ok(unmapped.length > 0);
  });
});

describe("permissionDualWrite materialize", () => {
  it("estrutura → legado preserva unmapped de catálogo", () => {
    const effective = buildEffectiveFlagsMap("VIEWER", []);
    const previous = materializeLegacyPermissionsFromFlags(effective, []);
    const unmapped = "pricing.view";
    assert.equal(getDualWriteAliasIndex().mappedLegacyKeys.has(unmapped), false);
    assert.equal(getDualWriteAliasIndex().catalogKeys.has(unmapped), true);
    const withExtra = [...previous, unmapped];
    const result = materializeStructuredToLegacy({
      effectiveByResourceKey: effective,
      previousLegacyPermissions: withExtra,
    });
    assert.ok(result.preservedUnmappedKeys.includes(unmapped));
    assert.ok(result.legacyPermissions.includes(unmapped));
    assert.deepEqual(result.legacyPermissions, [...result.legacyPermissions].sort());
  });

  it("não apaga unmapped ao materializar de flags vazias no resource", () => {
    const result = materializeStructuredToLegacy({
      effectiveByResourceKey: {},
      previousLegacyPermissions: ["pricing.view"],
    });
    assert.ok(result.legacyPermissions.includes("pricing.view"));
    assert.deepEqual(result.preservedUnmappedKeys, ["pricing.view"]);
  });

  it("idempotente: mesma entrada → mesma saída", () => {
    const effective = buildEffectiveFlagsMap("SELLER", []);
    const a = materializeLegacyPermissionsFromFlags(effective, ["pricing.view"]);
    const b = materializeLegacyPermissionsFromFlags(effective, a);
    assert.deepEqual(a, b);
  });
});

describe("permissionDualWrite round-trip", () => {
  it("estrutura → legado → estrutura não perde eixos (role presets)", () => {
    for (const role of ["VIEWER", "SELLER", "ADMIN"] as const) {
      const flags = buildEffectiveFlagsMap(role, []);
      const sparse = Object.fromEntries(
        Object.entries(flags).filter(
          ([, f]) => f.canView || f.canExecute || f.canManage
        )
      );
      const rt = roundTripStructured(sparse);
      assert.equal(
        rt.compatible,
        true,
        `${role} asymmetries: ${JSON.stringify(rt.asymmetries.slice(0, 5))}`
      );
    }
  });

  it("legado → estrutura → legado sem ganho/perda (fixtures)", () => {
    for (const fx of buildAllDualWriteFixtures()) {
      const rt = roundTripLegacy(fx.legacyPermissions);
      assert.equal(
        rt.compatible,
        true,
        `${fx.id} lost=${rt.lostMapped} gained=${rt.gainedMapped}`
      );
      assert.deepEqual(rt.backLegacy, [...new Set(fx.legacyPermissions)].sort());
    }
  });
});

describe("permissionDualWrite plans", () => {
  it("planLegacyToStructured dry-run é compatível e não aplica", () => {
    const plan = planLegacyToStructured({
      role: "VIEWER",
      legacyPermissions: ["dashboard.view", "pricing.view"],
      dryRun: true,
    });
    assert.equal(plan.direction, "legacy_to_structured");
    assert.equal(plan.dryRun, true);
    assert.equal(plan.compatible, true);
    assert.deepEqual(plan.beforeLegacy, plan.afterLegacy);
  });

  it("planStructuredToLegacy preserva unmapped", () => {
    const effective = buildEffectiveFlagsMap("VIEWER", []);
    const plan = planStructuredToLegacy({
      effectiveByResourceKey: effective,
      previousLegacyPermissions: [
        ...materializeLegacyPermissionsFromFlags(effective, []),
        "pricing.view",
      ],
      dryRun: true,
    });
    assert.ok(plan.preservedUnmapped.includes("pricing.view"));
  });
});

describe("permissionDualWrite apply integration (memory)", () => {
  it("structured→legacy apply grava permissions e preserva unmapped", async () => {
    const effective = buildEffectiveFlagsMap("VIEWER", []);
    const port = createInMemoryDualWritePort([
      {
        userId: "u1",
        role: "VIEWER",
        legacyPermissions: ["pricing.view"],
        overrides: [],
      },
    ]);
    const dry = await applyDualWrite({
      port,
      userId: "u1",
      dryRun: true,
      effectiveByResourceKey: effective,
    });
    assert.equal(dry.applied, false);
    assert.ok(dry.afterLegacy.includes("pricing.view"));

    const applied = await applyDualWrite({
      port,
      userId: "u1",
      dryRun: false,
      effectiveByResourceKey: effective,
    });
    assert.equal(applied.applied, true);
    assert.ok(port.store.get("u1")!.legacyPermissions.includes("pricing.view"));
  });

  it("backfill exige confirm e não regrava permissions[]", async () => {
    const port = createInMemoryDualWritePort([
      {
        userId: "u2",
        role: "VIEWER",
        legacyPermissions: ["dashboard.view"],
        overrides: [],
      },
    ]);
    const before = [...port.store.get("u2")!.legacyPermissions];

    await assert.rejects(
      () =>
        applyDualWrite({
          port,
          userId: "u2",
          dryRun: false,
          backfillStructuredFromLegacy: true,
        }),
      /BACKFILL_CONFIRM/
    );

    const dry = await applyDualWrite({
      port,
      userId: "u2",
      dryRun: true,
      backfillStructuredFromLegacy: true,
    });
    assert.equal(dry.applied, false);

    const applied = await applyDualWrite({
      port,
      userId: "u2",
      dryRun: false,
      backfillStructuredFromLegacy: true,
      confirmBackfillApply: true,
    });
    assert.equal(applied.applied, true);
    assert.deepEqual(port.store.get("u2")!.legacyPermissions, before);
    assert.ok(port.store.get("u2")!.overrides.length > 0);
  });
});

describe("permissionDualWrite compatibility report", () => {
  it("fixtures fictícias + presets sem ganho/perda", () => {
    const report = buildDualWriteCompatibilityReport(buildAllDualWriteFixtures());
    assert.equal(report.allCompatible, true, formatDualWriteCompatibilityMarkdown(report));
    assert.ok(report.catalogUnmappedLegacyKeys.length > 0);
  });
});

describe("permissionDualWrite project", () => {
  it("eleva ancestral com elevateAncestors true", () => {
    const index = getDualWriteAliasIndex();
    // pick any child with parent
    let child: string | null = null;
    let parent: string | null = null;
    for (const [k, p] of index.parentByResource) {
      if (p && (index.byResource.get(k)?.length ?? 0) > 0) {
        child = k;
        parent = p;
        break;
      }
    }
    if (!child || !parent) return;
    const alias = index.byResource.get(child)![0].legacyKey;
    const withElevate = projectLegacyToStructured({
      role: "VIEWER",
      legacyPermissions: [alias],
      elevateAncestors: true,
    });
    assert.equal(withElevate.projectedFlags[parent!]?.canView, true);
    const without = projectLegacyToStructured({
      role: "VIEWER",
      legacyPermissions: [alias],
      elevateAncestors: false,
    });
    assert.equal(without.projectedFlags[parent!]?.canView ?? false, false);
  });
});
