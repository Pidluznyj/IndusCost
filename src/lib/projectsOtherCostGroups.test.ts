import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOtherCostNotes,
  findOtherCostBatchItems,
  isGuidedOtherCostItem,
  loadOtherCostBatchLines,
  parseOtherCostMeta,
  simulatedItemToOtherCostLine,
} from "./projectsOtherCostGroups.js";
import type { ProjectSimulatedItemRow } from "@/src/types/projects.js";

function otherCostItem(
  id: string,
  batchId: string,
  description: string,
  cost: number
): ProjectSimulatedItemRow {
  return {
    id,
    provisionalCode: null,
    description,
    itemType: "OTHER",
    unit: "UN",
    estimatedUnitCost: cost,
    quotedUnitCost: cost,
    supplierName: null,
    leadTimeDays: null,
    estimatedWeight: null,
    lossPercent: 0,
    requiresQuotation: false,
    requiresEngineeringReview: false,
    canBecomeOfficial: false,
    notes: buildOtherCostNotes("TEST", batchId),
  };
}

describe("projectsOtherCostGroups", () => {
  it("identifica itens guiados de outros custos", () => {
    assert.equal(isGuidedOtherCostItem(buildOtherCostNotes("FREIGHT", "b1")), true);
    assert.equal(isGuidedOtherCostItem("notas comuns"), false);
  });

  it("agrupa linhas por batch", () => {
    const items = [
      otherCostItem("a", "batch-1", "Try-out", 1000),
      otherCostItem("b", "batch-1", "Frete", 500),
      otherCostItem("c", "batch-2", "Outro", 200),
    ];
    const batch1 = loadOtherCostBatchLines(items, "batch-1");
    assert.equal(batch1.length, 2);
    assert.equal(findOtherCostBatchItems(items, "batch-1").length, 2);
  });

  it("converte item simulado em linha editável", () => {
    const item = otherCostItem("x", "batch-9", "Protótipo", 3200);
    const line = simulatedItemToOtherCostLine(item);
    assert.equal(line.description, "Protótipo");
    assert.equal(line.totalCost, 3200);
    assert.equal(parseOtherCostMeta(item.notes).group, "TEST");
  });
});
