import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectiveFlagsMap, materializeLegacyPermissionsFromFlags } from "@/src/lib/security/permissionRolePresets.js";
import {
  applyDualWrite,
  buildDualWriteAliasIndex,
  buildDualWriteCompatibilityReport,
  createInMemoryDualWritePort,
  getDualWriteAliasIndex,
  listAliasCollisions,
  listCatalogKeysWithoutStructuralAlias,
  materializeStructuredToLegacy,
  materializeUserLegacyBag,
  planLegacyToStructured,
  planStructuredToLegacy,
  projectLegacyToStructured,
  roundTripLegacy,
  roundTripStructured,
} from "./index.ts";
import { buildAllDualWriteFixtures, buildLeticiaStructuredFlags } from "./fixtures.ts";

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
    const unmapped = "reports.material_demand.view";
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
      previousLegacyPermissions: ["reports.material_demand.view"],
    });
    assert.ok(result.legacyPermissions.includes("reports.material_demand.view"));
    assert.deepEqual(result.preservedUnmappedKeys, ["reports.material_demand.view"]);
  });

  it("idempotente: mesma entrada → mesma saída", () => {
    const effective = buildEffectiveFlagsMap("SELLER", []);
    const a = materializeLegacyPermissionsFromFlags(effective, ["reports.material_demand.view"]);
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
      legacyPermissions: ["dashboard.view", "reports.material_demand.view"],
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
        "reports.material_demand.view",
      ],
      dryRun: true,
    });
    assert.ok(plan.preservedUnmapped.includes("reports.material_demand.view"));
  });
});

describe("permissionDualWrite apply integration (memory)", () => {
  it("structured→legacy apply grava permissions e preserva unmapped", async () => {
    const effective = buildEffectiveFlagsMap("VIEWER", []);
    const port = createInMemoryDualWritePort([
      {
        userId: "u1",
        role: "VIEWER",
        legacyPermissions: ["reports.material_demand.view"],
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
    assert.ok(dry.afterLegacy.includes("reports.material_demand.view"));

    const applied = await applyDualWrite({
      port,
      userId: "u1",
      dryRun: false,
      effectiveByResourceKey: effective,
    });
    assert.equal(applied.applied, true);
    assert.ok(port.store.get("u1")!.legacyPermissions.includes("reports.material_demand.view"));
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
  it("fixtures fictícias + presets: legado RT ok; estruturado RT só nos canônicos 1:1", () => {
    const report = buildDualWriteCompatibilityReport(buildAllDualWriteFixtures());
    assert.ok(report.catalogUnmappedLegacyKeys.length > 0);
    for (const f of report.fixtures) {
      assert.equal(f.legacyRoundTripOk, true, `${f.id} legacy RT`);
    }
    // Role presets com grants em recursos não-canônicos podem falhar structured RT (esperado P06).
    const leticia = report.fixtures.find((f) => f.id === "leticia-ap-only");
    assert.ok(leticia);
    assert.equal(leticia!.structuredRoundTripOk, true, "Leticia structured RT");
  });
});

describe("permissionDualWrite project", () => {
  it("eleva ancestral com elevateAncestors true (1:1 canônico)", () => {
    const index = getDualWriteAliasIndex();
    let legacyKey: string | null = null;
    let parent: string | null = null;
    for (const [lk, binding] of index.canonicalByLegacy) {
      const p = index.parentByResource.get(binding.resourceKey) ?? null;
      if (p) {
        legacyKey = lk;
        parent = p;
        break;
      }
    }
    if (!legacyKey || !parent) return;
    const withElevate = projectLegacyToStructured({
      role: "VIEWER",
      legacyPermissions: [legacyKey],
      elevateAncestors: true,
    });
    assert.equal(withElevate.projectedFlags[parent]?.canView, true);
    const without = projectLegacyToStructured({
      role: "VIEWER",
      legacyPermissions: [legacyKey],
      elevateAncestors: false,
    });
    assert.equal(without.projectedFlags[parent]?.canView ?? false, false);
  });
});

describe("P06 materialize service — deny / Leticia / idempotência / unknown", () => {
  it("deny no recurso canônico remove chave materializada", () => {
    const withAllow = materializeUserLegacyBag({
      effectiveByResourceKey: {
        "comercial.pedidos_venda": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      previousLegacyPermissions: ["sales_orders.view"],
      dryRun: true,
    });
    assert.ok(withAllow.legacyPermissions.includes("sales_orders.view"));

    const withDeny = materializeUserLegacyBag({
      effectiveByResourceKey: {
        "comercial.pedidos_venda": {
          canView: false,
          canExecute: false,
          canManage: false,
        },
      },
      previousLegacyPermissions: ["sales_orders.view"],
      dryRun: true,
    });
    assert.equal(withDeny.legacyPermissions.includes("sales_orders.view"), false);
    assert.ok(withDeny.plan.lostLegacy.includes("sales_orders.view"));
  });

  it("Leticia absoluto: bag sem comercial/dashboard bleed; preserva unmapped", () => {
    const effective = buildLeticiaStructuredFlags();
    const first = materializeUserLegacyBag({
      effectiveByResourceKey: effective,
      previousLegacyPermissions: ["reports.material_demand.view", "crm.view", "dashboard.view"],
      dryRun: false,
    });
    assert.ok(first.legacyPermissions.includes("finance.accountsPayable.view"));
    assert.ok(first.legacyPermissions.includes("reports.material_demand.view"));
    assert.equal(first.legacyPermissions.includes("crm.view"), false);
    assert.equal(first.legacyPermissions.includes("dashboard.view"), false);
    assert.equal(first.legacyPermissions.includes("sales_orders.view"), false);

    const second = materializeUserLegacyBag({
      effectiveByResourceKey: effective,
      previousLegacyPermissions: first.legacyPermissions,
      dryRun: false,
    });
    assert.deepEqual(second.legacyPermissions, first.legacyPermissions);
    assert.equal(second.unchanged, true);
  });

  it("novo usuário: mapa vazio não injeta baseline VIEWER", () => {
    const r = materializeUserLegacyBag({
      effectiveByResourceKey: {},
      previousLegacyPermissions: [],
      dryRun: true,
    });
    assert.deepEqual(r.legacyPermissions, []);
  });

  it("chave desconhecida fora do catálogo cai no relatório e não entra na bag", () => {
    const r = materializeUserLegacyBag({
      effectiveByResourceKey: {
        dashboard: { canView: true, canExecute: false, canManage: false },
      },
      previousLegacyPermissions: ["dashboard.view", "zzz.not.a.permission"],
      dryRun: true,
      filterKnown: true,
    });
    assert.equal(r.legacyPermissions.includes("zzz.not.a.permission"), false);
    assert.ok(
      r.unknownKeysReport.some(
        (e) => e.key === "zzz.not.a.permission" && e.reason === "outside_catalog"
      )
    );
  });

  it("troca de perfil semântica: bag vira snapshot; não acumula mapped antigo", () => {
    const before = ["dashboard.view", "crm.view", "sales_orders.view", "reports.material_demand.view"];
    // Perfil “só AP”
    const profileFlags = buildLeticiaStructuredFlags();
    const after = materializeUserLegacyBag({
      effectiveByResourceKey: profileFlags,
      previousLegacyPermissions: before,
      dryRun: true,
    });
    assert.equal(after.legacyPermissions.includes("crm.view"), false);
    assert.equal(after.legacyPermissions.includes("sales_orders.view"), false);
    assert.ok(after.legacyPermissions.includes("reports.material_demand.view"), "unmapped preservado");
    assert.ok(after.legacyPermissions.includes("finance.accountsPayable.view"));
  });

  it("applyDualWrite dry-run + apply + rollback memory", async () => {
    const effective = buildLeticiaStructuredFlags();
    const port = createInMemoryDualWritePort([
      {
        userId: "leticia",
        role: "VIEWER",
        legacyPermissions: ["crm.view", "reports.material_demand.view"],
        overrides: [
          {
            resourceKey: "comercial",
            canView: false,
            canExecute: null,
            canManage: null,
            reason: "old",
          },
        ],
      },
    ]);
    const dry = await applyDualWrite({
      port,
      userId: "leticia",
      dryRun: true,
      effectiveByResourceKey: effective,
    });
    assert.equal(dry.applied, false);
    assert.deepEqual(port.store.get("leticia")!.legacyPermissions, [
      "crm.view",
      "reports.material_demand.view",
    ]);

    const applied = await applyDualWrite({
      port,
      userId: "leticia",
      dryRun: false,
      effectiveByResourceKey: effective,
    });
    assert.equal(applied.applied, true);
    assert.equal(port.store.get("leticia")!.legacyPermissions.includes("crm.view"), false);
    assert.ok(port.store.get("leticia")!.legacyPermissions.includes("reports.material_demand.view"));

    // rollback: force failure inside transaction
    const port2 = createInMemoryDualWritePort([
      {
        userId: "u-rb",
        role: "VIEWER",
        legacyPermissions: ["crm.view"],
        overrides: [],
      },
    ]);
    const origTx = port2.transaction.bind(port2);
    port2.transaction = async (fn) => {
      return origTx(async (tx) => {
        await fn({
          ...tx,
          async updateLegacyPermissions() {
            throw new Error("ROLLBACK_TEST");
          },
        });
      });
    };
    await assert.rejects(() =>
      applyDualWrite({
        port: port2,
        userId: "u-rb",
        dryRun: false,
        effectiveByResourceKey: effective,
      })
    );
    assert.deepEqual(port2.store.get("u-rb")!.legacyPermissions, ["crm.view"]);
  });

  it("aliases 1:1: colisões reportadas; emissão só do canônico", () => {
    const collisions = listAliasCollisions();
    assert.ok(collisions.length > 0, "seed ainda tem colisões N:1 (runtime mega-keys intactas)");
    const index = getDualWriteAliasIndex();
    const crm = index.canonicalByLegacy.get("crm.view");
    assert.ok(crm);
    assert.equal(crm!.resourceKey, "comercial.crm", "crm.view → comercial.crm");
    const ap = index.canonicalByLegacy.get("finance.accountsPayable.view");
    assert.equal(ap?.resourceKey, "financeiro.contas_pagar");
  });
});
