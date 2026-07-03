import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  assertMaterialCostTableVersionEditable,
  compareMaterialCostTableVersionsForResolver,
  isMaterialCostTableVersionEditable,
  materialCostTableCodeFromEffectiveDate,
  materialCostTableNameFromCode,
  nextMaterialCostTableRevision,
  resolveEffectiveMaterialCostFromCatalog,
  type MaterialCostTableVersionWithItems,
} from "./materialCostVersioning.js";

function d(iso: string): Date {
  return civilDateToLocalDate(iso);
}

function version(
  partial: Partial<MaterialCostTableVersionWithItems> &
    Pick<
      MaterialCostTableVersionWithItems,
      "id" | "code" | "name" | "effectiveDate" | "status" | "revision"
    >
): MaterialCostTableVersionWithItems {
  return {
    publishedAt: null,
    createdAt: d("2026-06-01"),
    items: [],
    ...partial,
  };
}

function item(
  materialId: string,
  landedCost: number,
  versionId: string,
  currentCost = landedCost,
  createdAt = d("2026-06-01")
) {
  return {
    id: `${versionId}-${materialId}`,
    materialCostTableVersionId: versionId,
    materialId,
    materialCodeSnapshot: materialId.toUpperCase(),
    materialDescriptionSnapshot: `MP ${materialId}`,
    unitSnapshot: "kg",
    currentCostSnapshot: currentCost,
    freightSnapshot: 0,
    landedCostSnapshot: landedCost,
    averageCostSnapshot: null,
    standardCostSnapshot: null,
    standardLossSnapshot: null,
    costSource: "CURRENT_MATERIAL",
    warningsJson: null,
    calculationHash: null,
    calculationSnapshot: null,
    createdAt,
  };
}

describe("materialCostVersioning", () => {
  it("DRAFT é editável; PUBLISHED/SUPERSEDED/ARCHIVED são imutáveis", () => {
    assert.equal(isMaterialCostTableVersionEditable("DRAFT"), true);
    assert.equal(isMaterialCostTableVersionEditable("PUBLISHED"), false);
    assert.throws(() => assertMaterialCostTableVersionEditable("PUBLISHED", "editar"));
  });

  it("nextMaterialCostTableRevision incrementa revisão", () => {
    assert.equal(nextMaterialCostTableRevision(null), 1);
    assert.equal(nextMaterialCostTableRevision(2), 3);
  });

  it("materialCostTableCodeFromEffectiveDate retorna YYYY-MM", () => {
    assert.equal(materialCostTableCodeFromEffectiveDate(d("2026-07-01")), "2026-07");
  });

  it("materialCostTableNameFromCode inclui revisão", () => {
    assert.equal(
      materialCostTableNameFromCode("2026-07", 2),
      "Custo de matéria-prima 2026-07 (rev. 2)"
    );
  });

  it("resolve custo vigente por material/data — versão mais recente aplicável", () => {
    const catalog: MaterialCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-05",
        name: "Mai/2026 v1",
        effectiveDate: d("2026-05-01"),
        status: "SUPERSEDED",
        revision: 1,
        publishedAt: d("2026-05-02"),
        items: [item("mp-h503", 16.5, "v1")],
      }),
      version({
        id: "v2",
        code: "2026-07",
        name: "Jul/2026 v1",
        effectiveDate: d("2026-07-01"),
        status: "PUBLISHED",
        revision: 1,
        publishedAt: d("2026-07-02"),
        items: [item("mp-h503", 11.5, "v2")],
      }),
    ];

    const may = resolveEffectiveMaterialCostFromCatalog(catalog, "mp-h503", d("2026-05-15"));
    const jul = resolveEffectiveMaterialCostFromCatalog(catalog, "mp-h503", d("2026-07-15"));

    assert.equal(may.status, "OK");
    if (may.status === "OK") assert.equal(may.landedCostSnapshot, 16.5);

    assert.equal(jul.status, "OK");
    if (jul.status === "OK") assert.equal(jul.landedCostSnapshot, 11.5);
  });

  it("PUBLISHED prevalece sobre SUPERSEDED com mesma vigência", () => {
    const catalog: MaterialCostTableVersionWithItems[] = [
      version({
        id: "sup",
        code: "2026-06",
        name: "Jun superseded",
        effectiveDate: d("2026-06-01"),
        status: "SUPERSEDED",
        revision: 1,
        publishedAt: d("2026-06-02"),
        items: [item("mp-a", 10, "sup")],
      }),
      version({
        id: "pub",
        code: "2026-06",
        name: "Jun published",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 2,
        publishedAt: d("2026-06-15"),
        items: [item("mp-a", 12, "pub")],
      }),
    ];

    const resolved = resolveEffectiveMaterialCostFromCatalog(catalog, "mp-a", d("2026-06-20"));
    assert.equal(resolved.status, "OK");
    if (resolved.status === "OK") {
      assert.equal(resolved.landedCostSnapshot, 12);
      assert.equal(resolved.materialCostTableVersionId, "pub");
    }

    assert.ok(
      compareMaterialCostTableVersionsForResolver(catalog[1], catalog[0]) > 0
    );
  });

  it("material sem item publicado retorna SEM_CUSTO", () => {
    const catalog: MaterialCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-06",
        name: "Jun",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("mp-a", 10, "v1")],
      }),
    ];
    const missing = resolveEffectiveMaterialCostFromCatalog(catalog, "mp-z", d("2026-06-15"));
    assert.equal(missing.status, "SEM_CUSTO");
  });
});
