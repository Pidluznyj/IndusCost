import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeProductSimulationCostAnalysis } from "./projectsProductSimulationCost.js";
import {
  applyBaselineDeltaRollup,
  computeSimulatedProductIndustrialCost,
  recalculateEngineeringCostRollup,
  type EngineeringRollupLine,
} from "./projectsEngineeringCostRollup.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

const ROOT = "612-03aa";
const MOTOR_OFFICIAL = 1.309301;

function structureLine(
  partial: Partial<ProjectStructureLineRow> & Pick<ProjectStructureLineRow, "id">
): ProjectStructureLineRow {
  return {
    simulatedProductId: null,
    parentLineId: null,
    level: 1,
    treePath: partial.id,
    snapshotRootProductId: ROOT,
    lineType: "COMPONENT",
    sourceType: "EXISTING_PRODUCT",
    existingProductId: "p1",
    existingMaterialId: null,
    simulatedItemId: null,
    sourceOfficialBomId: "b1",
    sourceOfficialRoutingId: null,
    descriptionSnapshot: "Comp",
    unitSnapshot: "UN",
    quantity: 1,
    lossPercent: 0,
    officialQuantitySnapshot: 1,
    officialLossPercentSnapshot: 0,
    officialUnitCostSnapshot: 50,
    unitCostSnapshot: 50,
    totalCost: 50,
    costSource: "OFFICIAL_COST_ANALYSIS",
    isChangedFromOfficial: false,
    isMissingCost: false,
    countsInSimulatedProductCost: true,
    supplierNameSnapshot: null,
    notes: `snapshot:${ROOT}`,
    sortOrder: 1,
    ...partial,
  };
}

function imported61203Fixture(): ProjectStructureLineRow[] {
  const comp = structureLine({
    id: "comp-l0",
    parentLineId: null,
    unitCostSnapshot: 0.466661,
    officialUnitCostSnapshot: 0.466661,
    totalCost: 0.466661,
    countsInSimulatedProductCost: true,
  });
  const nested = structureLine({
    id: "comp-nested",
    parentLineId: "comp-l0",
    unitCostSnapshot: 0.295645,
    officialUnitCostSnapshot: 0.295645,
    totalCost: 0.295645,
    countsInSimulatedProductCost: false,
    level: 2,
  });
  const mat = structureLine({
    id: "mat-1",
    parentLineId: "comp-nested",
    lineType: "RAW_MATERIAL",
    unitCostSnapshot: 0.05,
    officialUnitCostSnapshot: 0.05,
    totalCost: 0.05,
    countsInSimulatedProductCost: false,
    level: 3,
  });
  return [comp, nested, mat];
}

describe("projectsProductSimulationCost", () => {
  it("produto importado sem alteração: oficial = simulado e diferença = 0", () => {
    const lines = imported61203Fixture();
    recalculateEngineeringCostRollup(
      lines.map((l) => ({
        id: l.id,
        parentLineId: l.parentLineId,
        snapshotRootProductId: l.snapshotRootProductId,
        lineType: l.lineType,
        quantity: l.quantity,
        lossPercent: l.lossPercent ?? 0,
        unitCostSnapshot: l.unitCostSnapshot,
        totalCost: l.totalCost,
        officialQuantitySnapshot: l.officialQuantitySnapshot,
        officialLossPercentSnapshot: l.officialLossPercentSnapshot,
        officialUnitCostSnapshot: l.officialUnitCostSnapshot,
        countsInSimulatedProductCost: l.countsInSimulatedProductCost,
        isChangedFromOfficial: false,
      }))
    );

    const analysis = computeProductSimulationCostAnalysis(lines, {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });

    assert.ok(Math.abs(analysis.simulatedIndustrialCost - MOTOR_OFFICIAL) < 0.0001);
    assert.ok(analysis.difference != null && Math.abs(analysis.difference) < 0.0001);
    assert.equal(analysis.totalProjectDelta, 0);
    assert.ok(analysis.preservedOfficialResidual > 0.8);
  });

  it("componente pai preserva custo oficial maior que soma dos filhos", () => {
    const lines = imported61203Fixture();
    const rollup = applyBaselineDeltaRollup(
      lines.map((l) => ({
        id: l.id,
        parentLineId: l.parentLineId,
        snapshotRootProductId: ROOT,
        lineType: l.lineType,
        quantity: l.quantity,
        lossPercent: l.lossPercent ?? 0,
        unitCostSnapshot: l.unitCostSnapshot,
        totalCost: l.totalCost,
        officialQuantitySnapshot: l.officialQuantitySnapshot,
        officialLossPercentSnapshot: l.officialLossPercentSnapshot,
        officialUnitCostSnapshot: l.officialUnitCostSnapshot,
        countsInSimulatedProductCost: l.countsInSimulatedProductCost,
        isChangedFromOfficial: false,
      }))
    );
    const nested = rollup.lines.find((l) => l.id === "comp-nested")!;
    assert.ok(Math.abs(nested.totalCost - 0.295645) < 0.000001);
    assert.ok(Math.abs(nested.unitCostSnapshot - 0.295645) < 0.000001);
  });

  it("alterar filho interno propaga delta ao produto raiz via motor", () => {
    const lines = imported61203Fixture();
    const edited = lines.map((l) =>
      l.id === "mat-1"
        ? {
            ...l,
            unitCostSnapshot: 0.06,
            totalCost: 0.06,
            isChangedFromOfficial: true,
          }
        : l
    );

    const analysis = computeProductSimulationCostAnalysis(edited, {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });

    assert.ok(Math.abs(analysis.totalProjectDelta - 0.01) < 0.0001);
    assert.ok(Math.abs(analysis.simulatedIndustrialCost - (MOTOR_OFFICIAL + 0.01)) < 0.0001);
    assert.equal(analysis.officialIndustrialCost, MOTOR_OFFICIAL);
  });

  it("materiais internos não duplicam no total do produto", () => {
    const lines = imported61203Fixture();
    const analysis = computeProductSimulationCostAnalysis(lines, {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });
    assert.equal(analysis.rawMaterialCost, 0);
    assert.ok(analysis.componentCost > 0);
    assert.ok(Math.abs(analysis.unitCostTotal - analysis.simulatedIndustrialCost) < 0.0001);
  });

  it("filtra apenas linhas do produto selecionado", () => {
    const productA = imported61203Fixture();
    const otherProduct = structureLine({
      id: "other-comp",
      snapshotRootProductId: "other-product",
      notes: "snapshot:other-product",
      unitCostSnapshot: 1000,
      totalCost: 1000,
      countsInSimulatedProductCost: true,
    });
    const analysisA = computeProductSimulationCostAnalysis([...productA, otherProduct], {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });
    const analysisOnlyA = computeProductSimulationCostAnalysis(productA, {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });
    assert.ok(
      Math.abs(analysisA.simulatedIndustrialCost - analysisOnlyA.simulatedIndustrialCost) < 0.0001
    );
  });

  it("não retorna NaN, Infinity ou custo negativo indevido", () => {
    const lines = imported61203Fixture();
    const analysis = computeProductSimulationCostAnalysis(lines, {
      officialIndustrialCost: MOTOR_OFFICIAL,
      snapshotRootProductId: ROOT,
    });
    for (const v of [
      analysis.simulatedIndustrialCost,
      analysis.unitCostTotal,
      analysis.totalProjectDelta,
      analysis.preservedOfficialResidual,
    ]) {
      assert.ok(Number.isFinite(v));
      assert.ok(v >= 0);
    }
  });

  it("computeSimulatedProductIndustrialCost com delta zero preserva motor", () => {
    const rollupLine: EngineeringRollupLine = {
      id: "l0",
      parentLineId: null,
      snapshotRootProductId: ROOT,
      lineType: "COMPONENT",
      quantity: 1,
      lossPercent: 0,
      unitCostSnapshot: 0.466661,
      totalCost: 0.466661,
      officialQuantitySnapshot: 1,
      officialLossPercentSnapshot: 0,
      officialUnitCostSnapshot: 0.466661,
      countsInSimulatedProductCost: true,
      isChangedFromOfficial: false,
    };
    const r = computeSimulatedProductIndustrialCost([rollupLine], MOTOR_OFFICIAL);
    assert.equal(r.totalProjectDelta, 0);
    assert.ok(Math.abs(r.simulatedIndustrialCost - MOTOR_OFFICIAL) < 0.0001);
  });
});
