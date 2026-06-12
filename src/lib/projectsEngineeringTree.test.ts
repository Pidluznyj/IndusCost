import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildProjectEngineeringTree } from "./projectsEngineeringTree.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

function line(partial: Partial<ProjectStructureLineRow> & { id: string }): ProjectStructureLineRow {
  return {
    simulatedProductId: null,
    parentLineId: null,
    level: null,
    treePath: null,
    snapshotRootProductId: null,
    lineType: "RAW_MATERIAL",
    sourceType: "EXISTING_MATERIAL",
    existingProductId: null,
    existingMaterialId: null,
    simulatedItemId: null,
    sourceOfficialBomId: null,
    sourceOfficialRoutingId: null,
    descriptionSnapshot: "Item",
    unitSnapshot: "KG",
    quantity: 1,
    lossPercent: 0,
    unitCostSnapshot: 10,
    totalCost: 10,
    costSource: "MATERIAL",
    isMissingCost: false,
    countsInSimulatedProductCost: true,
    isChangedFromOfficial: false,
    sortOrder: 0,
    notes: null,
    supplierNameSnapshot: null,
    officialQuantitySnapshot: null,
    officialLossPercentSnapshot: null,
    officialUnitCostSnapshot: null,
    ...partial,
  };
}

describe("projectsEngineeringTree", () => {
  it("filtra linhas por produto simulado nativo", () => {
    const simId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const otherId = "11111111-2222-3333-4444-555555555555";
    const tree = buildProjectEngineeringTree(
      { productId: simId, sku: "PRJ-01", name: "Produto teste" },
      [
        line({
          id: "l1",
          simulatedProductId: simId,
          descriptionSnapshot: "MP A",
          parentLineId: null,
        }),
        line({
          id: "l2",
          simulatedProductId: otherId,
          descriptionSnapshot: "Outro produto",
        }),
        line({
          id: "l3",
          snapshotRootProductId: "official-1",
          descriptionSnapshot: "Snapshot",
        }),
      ],
      { kind: "simulated_product", simulatedProductId: simId }
    );
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0]?.label, "MP A");
  });

  it("importação recursiva existe em projectsProductEngineeringSnapshot", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "projectsProductEngineeringSnapshot.ts"),
      "utf8"
    );
    assert.match(src, /buildBomTreeProduct/);
    assert.match(src, /MAX_ENGINEERING_TREE_DEPTH/);
    assert.match(src, /Ciclo detectado/);
    assert.match(src, /parentLineId/);
  });
});
