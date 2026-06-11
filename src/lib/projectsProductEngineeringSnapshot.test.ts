import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countEngineeringSnapshotLines,
  type ProjectEngineeringSnapshotNode,
} from "./projectsProductEngineeringSnapshot.js";
import { buildProjectEngineeringTree } from "./projectsEngineeringTree.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

function node(
  partial: Partial<ProjectEngineeringSnapshotNode> & Pick<ProjectEngineeringSnapshotNode, "nodeKey">
): ProjectEngineeringSnapshotNode {
  return {
    parentNodeKey: null,
    level: 0,
    path: partial.nodeKey,
    nodeType: "PRODUCT",
    officialProductId: null,
    officialMaterialId: null,
    officialBomId: null,
    officialRoutingId: null,
    code: "X",
    description: "X",
    unit: "UN",
    quantity: 1,
    lossPercent: 0,
    officialUnitCost: 10,
    simulatedUnitCost: 10,
    totalCost: 10,
    costSource: "OFFICIAL_COST_ANALYSIS",
    isInherited: true,
    isChanged: false,
    isMissingCost: false,
    countsInSimulatedProductCost: true,
    children: [],
    ...partial,
  };
}

describe("projectsProductEngineeringSnapshot", () => {
  it("conta nós da árvore recursiva (não só 1º nível)", () => {
    const tree = node({
      nodeKey: "root",
      nodeType: "ROOT_PRODUCT",
      children: [
        node({
          nodeKey: "c1",
          children: [
            node({ nodeKey: "m1", nodeType: "MATERIAL", countsInSimulatedProductCost: false }),
            node({ nodeKey: "m2", nodeType: "MATERIAL", countsInSimulatedProductCost: false }),
          ],
        }),
        node({ nodeKey: "c2" }),
        node({ nodeKey: "c3" }),
      ],
    });
    assert.equal(countEngineeringSnapshotLines(tree), 5);
  });

  it("buildProjectEngineeringTree monta hierarquia por parentLineId", () => {
    const lines: ProjectStructureLineRow[] = [
      {
        id: "l1",
        simulatedProductId: null,
        parentLineId: null,
        level: 1,
        treePath: "root/b1",
        snapshotRootProductId: "root-id",
        lineType: "COMPONENT",
        sourceType: "EXISTING_PRODUCT",
        existingProductId: "p1",
        existingMaterialId: null,
        simulatedItemId: null,
        sourceOfficialBomId: "b1",
        sourceOfficialRoutingId: null,
        descriptionSnapshot: "612.04AA — Filho",
        unitSnapshot: "UN",
        quantity: 1,
        lossPercent: 0,
        officialQuantitySnapshot: 1,
        officialLossPercentSnapshot: 0,
        officialUnitCostSnapshot: 5,
        unitCostSnapshot: 5,
        totalCost: 5,
        costSource: "OFFICIAL_COST_ANALYSIS",
        isChangedFromOfficial: false,
        isMissingCost: false,
        countsInSimulatedProductCost: true,
        supplierNameSnapshot: null,
        notes: "snapshot:root-id",
        sortOrder: 1,
      },
      {
        id: "l2",
        simulatedProductId: null,
        parentLineId: "l1",
        level: 2,
        treePath: "root/b1/m1",
        snapshotRootProductId: "root-id",
        lineType: "RAW_MATERIAL",
        sourceType: "EXISTING_MATERIAL",
        existingProductId: null,
        existingMaterialId: "m1",
        simulatedItemId: null,
        sourceOfficialBomId: "bm1",
        sourceOfficialRoutingId: null,
        descriptionSnapshot: "115.03 — MP",
        unitSnapshot: "KG",
        quantity: 0.5,
        lossPercent: 2,
        officialQuantitySnapshot: 0.5,
        officialLossPercentSnapshot: 2,
        officialUnitCostSnapshot: 12,
        unitCostSnapshot: 12,
        totalCost: 6.12,
        costSource: "OFFICIAL_MATERIAL_COST",
        isChangedFromOfficial: false,
        isMissingCost: false,
        countsInSimulatedProductCost: false,
        supplierNameSnapshot: null,
        notes: "snapshot:root-id",
        sortOrder: 2,
      },
    ];

    const tree = buildProjectEngineeringTree(
      { productId: "root-id", sku: "612.02AA", name: "Torneira" },
      lines
    );
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0]!.children.length, 1);
    assert.equal(tree.children[0]!.children[0]!.line?.id, "l2");
    assert.ok(tree.children[0]!.line!.unitCostSnapshot > 0);
  });
});
