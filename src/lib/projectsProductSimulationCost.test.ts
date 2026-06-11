import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProductSimulationCostAnalysis,
  engineeringRollupBaselinePatch,
} from "./projectsProductSimulationCost.js";
import {
  recalculateEngineeringCostRollup,
  rollupEngineeringSnapshotNode,
  sumSimulatedRootProductCost,
  type EngineeringRollupLine,
} from "./projectsEngineeringCostRollup.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

const ROOT = "612-03aa";

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

function rollupLine(
  partial: Partial<EngineeringRollupLine> & Pick<EngineeringRollupLine, "id">
): EngineeringRollupLine {
  return {
    parentLineId: null,
    snapshotRootProductId: ROOT,
    lineType: "COMPONENT",
    quantity: 1,
    lossPercent: 0,
    unitCostSnapshot: 0,
    totalCost: 0,
    officialQuantitySnapshot: 1,
    officialLossPercentSnapshot: 0,
    officialUnitCostSnapshot: 0,
    countsInSimulatedProductCost: false,
    isChangedFromOfficial: false,
    ...partial,
  };
}

function imported612Fixture(): ProjectStructureLineRow[] {
  const comp = structureLine({
    id: "comp-l0",
    parentLineId: null,
    lineType: "COMPONENT",
    quantity: 1,
    unitCostSnapshot: 50,
    totalCost: 50,
    officialUnitCostSnapshot: 50,
    countsInSimulatedProductCost: true,
  });
  const mat1 = structureLine({
    id: "mat-1",
    parentLineId: "comp-l0",
    lineType: "RAW_MATERIAL",
    quantity: 2,
    unitCostSnapshot: 10,
    totalCost: 20,
    officialUnitCostSnapshot: 10,
    countsInSimulatedProductCost: false,
    level: 2,
  });
  const mat2 = structureLine({
    id: "mat-2",
    parentLineId: "comp-l0",
    lineType: "RAW_MATERIAL",
    quantity: 1,
    unitCostSnapshot: 30,
    totalCost: 30,
    officialUnitCostSnapshot: 30,
    countsInSimulatedProductCost: false,
    level: 2,
  });
  const proc = structureLine({
    id: "proc-l0",
    parentLineId: null,
    lineType: "PROCESS",
    unitSnapshot: "HH",
    quantity: 1,
    unitCostSnapshot: 59.301,
    totalCost: 59.301,
    officialUnitCostSnapshot: 59.301,
    countsInSimulatedProductCost: true,
  });
  return [comp, mat1, mat2, proc];
}

describe("projectsProductSimulationCost", () => {
  it("produto importado sem alteração: oficial = simulado e diferença = 0", () => {
    const lines = imported612Fixture();
    const rolled = recalculateEngineeringCostRollup(
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
        isChangedFromOfficial: l.isChangedFromOfficial,
      }))
    );
    const baseline = rolled.map((l) => ({ ...l, ...engineeringRollupBaselinePatch(l) }));
    const officialMotor = sumSimulatedRootProductCost(baseline);

    const analysis = computeProductSimulationCostAnalysis(
      baseline.map((l) => {
        const row = lines.find((r) => r.id === l.id)!;
        return {
          ...row,
          unitCostSnapshot: l.unitCostSnapshot,
          totalCost: l.totalCost,
          officialUnitCostSnapshot: l.officialUnitCostSnapshot!,
          isChangedFromOfficial: false,
        };
      }),
      { officialIndustrialCost: officialMotor }
    );

    assert.ok(Math.abs(analysis.simulatedIndustrialCost - officialMotor) < 0.0001);
    assert.ok(analysis.difference != null && Math.abs(analysis.difference) < 0.0001);
  });

  it("alterar material interno muda simulado e diferença; oficial do motor permanece", () => {
    const lines = imported612Fixture();
    const officialMotor = 109.301;
    const edited = lines.map((l) =>
      l.id === "mat-1" ? { ...l, unitCostSnapshot: 15, totalCost: 30, isChangedFromOfficial: true } : l
    );
    const analysis = computeProductSimulationCostAnalysis(edited, {
      officialIndustrialCost: officialMotor,
    });
    assert.ok(analysis.simulatedIndustrialCost > officialMotor);
    assert.ok(analysis.difference != null && analysis.difference > 0);
    assert.equal(analysis.officialIndustrialCost, officialMotor);
  });

  it("materiais internos não duplicam no total do produto", () => {
    const lines = imported612Fixture();
    const analysis = computeProductSimulationCostAnalysis(lines, { officialIndustrialCost: 109.301 });
    assert.equal(analysis.rawMaterialCost, 0);
    assert.ok(analysis.componentCost > 0);
    assert.ok(Math.abs(analysis.unitCostTotal - analysis.simulatedIndustrialCost) < 0.0001);
  });

  it("componentes de 1º nível recebem rollup dos filhos", () => {
    const node = {
      quantity: 1,
      lossPercent: 0,
      officialUnitCost: 999,
      simulatedUnitCost: 999,
      totalCost: 999,
      children: [
        {
          quantity: 2,
          lossPercent: 0,
          officialUnitCost: 10,
          simulatedUnitCost: 10,
          totalCost: 20,
          children: [],
        },
        {
          quantity: 1,
          lossPercent: 0,
          officialUnitCost: 30,
          simulatedUnitCost: 30,
          totalCost: 30,
          children: [],
        },
      ],
    };
    rollupEngineeringSnapshotNode(node);
    assert.equal(node.totalCost, 50);
    assert.equal(node.simulatedUnitCost, 50);
    assert.equal(node.officialUnitCost, 50);
  });

  it("custo unitário total abre parcelas e sem extras iguala industrial", () => {
    const lines = imported612Fixture();
    const analysis = computeProductSimulationCostAnalysis(lines, { officialIndustrialCost: 109.301 });
    assert.ok(analysis.parts.industrial > 0);
    assert.equal(analysis.parts.other, 0);
    assert.ok(Math.abs(analysis.unitCostTotal - analysis.parts.industrial) < 0.0001);
  });

  it("filtra apenas linhas do produto selecionado (sem misturar outro snapshot)", () => {
    const productA = imported612Fixture();
    const otherProduct = structureLine({
      id: "other-comp",
      snapshotRootProductId: "other-product",
      notes: "snapshot:other-product",
      unitCostSnapshot: 1000,
      totalCost: 1000,
      countsInSimulatedProductCost: true,
    });
    const analysisA = computeProductSimulationCostAnalysis([...productA, otherProduct], {
      officialIndustrialCost: 109.301,
      snapshotRootProductId: ROOT,
    });
    const analysisOnlyA = computeProductSimulationCostAnalysis(productA, {
      officialIndustrialCost: 109.301,
      snapshotRootProductId: ROOT,
    });
    assert.ok(Math.abs(analysisA.simulatedIndustrialCost - analysisOnlyA.simulatedIndustrialCost) < 0.0001);
    assert.ok(analysisA.simulatedIndustrialCost < 200);
  });

  it("não retorna NaN, Infinity ou custo negativo indevido", () => {
    const lines = imported612Fixture();
    const analysis = computeProductSimulationCostAnalysis(lines, { officialIndustrialCost: 109.301 });
    for (const v of [
      analysis.simulatedIndustrialCost,
      analysis.unitCostTotal,
      analysis.rawMaterialCost,
      analysis.componentCost,
      analysis.serviceCost,
    ]) {
      assert.ok(Number.isFinite(v));
      assert.ok(v >= 0);
    }
  });

  it("rollupEngineeringSnapshotNode evita custo parcial de linha BOM no pai", () => {
    const lines = [
      rollupLine({
        id: "comp",
        parentLineId: null,
        unitCostSnapshot: 1.309301,
        totalCost: 1.309301,
        officialUnitCostSnapshot: 1.309301,
        countsInSimulatedProductCost: true,
      }),
      rollupLine({
        id: "mat",
        parentLineId: "comp",
        lineType: "RAW_MATERIAL",
        unitCostSnapshot: 0.466661,
        totalCost: 0.466661,
        countsInSimulatedProductCost: false,
      }),
    ];
    const rolled = recalculateEngineeringCostRollup(lines);
    const root = sumSimulatedRootProductCost(rolled);
    assert.ok(Math.abs(root - 0.466661) < 0.0001);
    assert.notEqual(root, 1.309301);
  });
});
