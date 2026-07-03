import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  buildMaterialCostEngineCatalogFromVersion,
  loadMaterialCostEngineCatalogForProductionDraft,
  NO_PUBLISHED_MATERIAL_COST_TABLE_MESSAGE,
  previewMaterialCostTableSourceForProductionDraft,
  resolveMaterialLineCostForEngine,
  resolvePublishedMaterialCostTableVersionForDate,
} from "./materialCostEngineResolver.js";

function createMockDb(materialVersions: Array<{
  id: string;
  code: string;
  name: string;
  revision: number;
  status: string;
  effectiveDate: Date;
  items: Array<{
    materialId: string;
    materialCodeSnapshot: string;
    currentCostSnapshot: number;
    freightSnapshot: number;
    landedCostSnapshot: number;
    standardLossSnapshot: number | null;
    unitSnapshot: string;
    costSource: string;
  }>;
}>) {
  const db = {
    materialCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        include,
      }: {
        where: { status?: string; effectiveDate?: { lte: Date } };
        orderBy?: Array<Record<string, string>>;
        include?: { items?: unknown };
      }) => {
        let rows = [...materialVersions];
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        if (where.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        rows.sort((a, b) => {
          const eff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
          if (eff !== 0) return eff;
          return b.revision - a.revision;
        });
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) {
          return { ...row, items: row.items };
        }
        return row;
      },
    },
  };
  return db;
}

describe("materialCostEngineResolver", () => {
  it("resolveMaterialLineCostForEngine usa landed da tabela versionada em modo oficial", () => {
    const catalog = buildMaterialCostEngineCatalogFromVersion(
      {
        id: "mp-v1",
        code: "2026-07",
        revision: 1,
        effectiveDate: civilDateToLocalDate("2026-07-01"),
        items: [
          {
            materialId: "mp-a",
            materialCodeSnapshot: "PP H503",
            currentCostSnapshot: 11,
            freightSnapshot: 0.5,
            landedCostSnapshot: 11.5,
            standardLossSnapshot: 2,
            unitSnapshot: "kg",
            costSource: "CURRENT_MATERIAL",
          },
        ],
      },
      { officialProductionDraft: true }
    );

    const resolved = resolveMaterialLineCostForEngine(
      {
        id: "mp-a",
        code: "PP H503",
        description: "PP",
        currentCost: 99,
        freight: 0,
        standardLoss: 0,
      },
      catalog
    );
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.landedCost, 11.5);
      assert.equal(resolved.costSource, "VERSIONED_MATERIAL_COST_TABLE");
    }
  });

  it("modo oficial falha se material não está na tabela publicada", () => {
    const catalog = buildMaterialCostEngineCatalogFromVersion(
      {
        id: "mp-v1",
        code: "2026-07",
        revision: 1,
        effectiveDate: civilDateToLocalDate("2026-07-01"),
        items: [],
      },
      { officialProductionDraft: true }
    );
    const resolved = resolveMaterialLineCostForEngine(
      { id: "mp-x", code: "X", description: "X", currentCost: 10, freight: 0, standardLoss: 0 },
      catalog
    );
    assert.equal(resolved.ok, false);
  });

  it("sem catálogo usa Material.currentCost vivo (compatibilidade)", () => {
    const resolved = resolveMaterialLineCostForEngine(
      { id: "mp-a", code: "A", description: "A", currentCost: 8, freight: 1, standardLoss: 0 },
      null
    );
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.landedCost, 9);
  });

  it("loadMaterialCostEngineCatalogForProductionDraft bloqueia sem tabela publicada", async () => {
    const db = createMockDb([]);
    await assert.rejects(
      () => loadMaterialCostEngineCatalogForProductionDraft(db as never, civilDateToLocalDate("2026-07-01")),
      new RegExp(NO_PUBLISHED_MATERIAL_COST_TABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  });

  it("previewMaterialCostTableSourceForProductionDraft indica disponibilidade", async () => {
    const db = createMockDb([
      {
        id: "mp-v1",
        code: "2026-07",
        name: "MP Jul",
        revision: 1,
        status: "PUBLISHED",
        effectiveDate: civilDateToLocalDate("2026-07-01"),
        items: [
          {
            materialId: "mp-a",
            materialCodeSnapshot: "A",
            currentCostSnapshot: 10,
            freightSnapshot: 0,
            landedCostSnapshot: 10,
            standardLossSnapshot: null,
            unitSnapshot: "kg",
            costSource: "CURRENT_MATERIAL",
          },
        ],
      },
    ]);
    const preview = await previewMaterialCostTableSourceForProductionDraft(
      db as never,
      civilDateToLocalDate("2026-07-15")
    );
    assert.equal(preview.available, true);
    assert.equal(preview.materialCostTableVersionId, "mp-v1");
    assert.equal(preview.itemsCount, 1);
  });

  it("resolvePublishedMaterialCostTableVersionForDate escolhe vigência mais recente <= data", async () => {
    const db = createMockDb([
      {
        id: "mp-may",
        code: "2026-05",
        name: "Mai",
        revision: 1,
        status: "PUBLISHED",
        effectiveDate: civilDateToLocalDate("2026-05-01"),
        items: [{ materialId: "mp-a", materialCodeSnapshot: "A", currentCostSnapshot: 16.5, freightSnapshot: 0, landedCostSnapshot: 16.5, standardLossSnapshot: null, unitSnapshot: "kg", costSource: "CURRENT_MATERIAL" }],
      },
      {
        id: "mp-jul",
        code: "2026-07",
        name: "Jul",
        revision: 1,
        status: "PUBLISHED",
        effectiveDate: civilDateToLocalDate("2026-07-01"),
        items: [{ materialId: "mp-a", materialCodeSnapshot: "A", currentCostSnapshot: 11.5, freightSnapshot: 0, landedCostSnapshot: 11.5, standardLossSnapshot: null, unitSnapshot: "kg", costSource: "CURRENT_MATERIAL" }],
      },
    ]);
    const may = await resolvePublishedMaterialCostTableVersionForDate(
      db as never,
      civilDateToLocalDate("2026-05-15")
    );
    const jul = await resolvePublishedMaterialCostTableVersionForDate(
      db as never,
      civilDateToLocalDate("2026-07-15")
    );
    assert.equal(may?.id, "mp-may");
    assert.equal(jul?.id, "mp-jul");
  });
});
