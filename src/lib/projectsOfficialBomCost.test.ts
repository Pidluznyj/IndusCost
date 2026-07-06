import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateStructureLineTotalCost } from "./projectsCalculations.js";
import {
  computeOfficialBomLineTotal,
  projectUnitCostFromOfficialLineTotal,
  resolveOfficialMaterialEffectiveUnitCost,
} from "./projectsOfficialBomCost.js";
import { enrichBomRowsWithOfficialCosts } from "./projectsProductSnapshot.js";
import { setProjectsProductCostResolver } from "./projectsProductCostResolver.js";

describe("projectsOfficialBomCost", () => {
  it("material efetivo considera frete e perda padrão", () => {
    const unit = resolveOfficialMaterialEffectiveUnitCost({
      currentCost: 10,
      freight: 1,
      standardLoss: 10,
    });
    assert.equal(unit, 12.22);
  });

  it("unitCost do projeto reproduz total oficial da linha BOM", () => {
    const officialTotal = computeOfficialBomLineTotal(2, 5, 15);
    const unitCost = projectUnitCostFromOfficialLineTotal(officialTotal, 2, 5);
    const projectTotal = calculateStructureLineTotalCost(2, unitCost, 5);
    assert.ok(Math.abs(projectTotal - officialTotal) < 0.02);
  });

  it("enrichBomRowsWithOfficialCosts aplica custos do motor por bomLineId", async () => {
    setProjectsProductCostResolver(async () => ({
      details: {
        materials: [
          { bomLineId: "bom-1", unitCost: 120, excludedFromCost: false },
          { bomLineId: "bom-2", unitCost: 0, excludedFromCost: true },
        ],
      },
    }));

    const rows = [
      {
        officialBomId: "bom-1",
        sourceType: "EXISTING_PRODUCT" as const,
        lineType: "COMPONENT" as const,
        existingMaterialId: null,
        existingProductId: "child-1",
        description: "Filho",
        unit: "UN",
        quantity: 2,
        lossPercent: 0,
        unitCost: 0,
        notes: null,
      },
    ];

    await enrichBomRowsWithOfficialCosts("parent-1", rows);
    assert.ok(rows[0].unitCost > 0);
    assert.equal(calculateStructureLineTotalCost(2, rows[0].unitCost, 0), 120);

    setProjectsProductCostResolver(null);
  });
});
