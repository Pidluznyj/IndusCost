import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyBaselineDeltaRollup,
  computeSimulatedProductIndustrialCost,
  deriveUnitCostFromChildrenTotal,
  lineTotalFromParts,
  recalculateEngineeringCostRollup,
  sumProjectRollupStructureCost,
  sumSimulatedRootProductCost,
  type EngineeringRollupLine,
} from "./projectsEngineeringCostRollup.js";

const ROOT = "root-product-id";

function line(
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

function build61202Fixture(): EngineeringRollupLine[] {
  const comp = line({
    id: "comp-311",
    parentLineId: null,
    lineType: "COMPONENT",
    quantity: 1,
    unitCostSnapshot: 50,
    totalCost: 50,
    officialUnitCostSnapshot: 50,
    countsInSimulatedProductCost: true,
  });

  const mat115 = line({
    id: "mat-115",
    parentLineId: "comp-311",
    lineType: "RAW_MATERIAL",
    quantity: 2,
    lossPercent: 0,
    unitCostSnapshot: 10,
    totalCost: 20,
    officialQuantitySnapshot: 2,
    officialUnitCostSnapshot: 10,
    countsInSimulatedProductCost: false,
  });

  const mat121 = line({
    id: "mat-121",
    parentLineId: "comp-311",
    lineType: "RAW_MATERIAL",
    quantity: 1,
    lossPercent: 0,
    unitCostSnapshot: 30,
    totalCost: 30,
    officialQuantitySnapshot: 1,
    officialUnitCostSnapshot: 30,
    countsInSimulatedProductCost: false,
  });

  const comp2 = line({
    id: "comp-612",
    parentLineId: null,
    lineType: "COMPONENT",
    quantity: 1,
    unitCostSnapshot: 200,
    totalCost: 200,
    officialUnitCostSnapshot: 200,
    countsInSimulatedProductCost: true,
  });

  const montagem = line({
    id: "comp-800",
    parentLineId: null,
    lineType: "COMPONENT",
    quantity: 1,
    unitCostSnapshot: 59.301,
    totalCost: 59.301,
    officialUnitCostSnapshot: 59.301,
    countsInSimulatedProductCost: true,
  });

  return [comp, mat115, mat121, comp2, montagem];
}

describe("projectsEngineeringCostRollup", () => {
  it("pai com filhos preserva custo oficial completo (não substitui por soma dos filhos)", () => {
    const parent = line({
      id: "parent",
      parentLineId: null,
      unitCostSnapshot: 0.295645,
      officialUnitCostSnapshot: 0.295645,
      totalCost: 0.295645,
      countsInSimulatedProductCost: true,
    });
    const child = line({
      id: "child",
      parentLineId: "parent",
      lineType: "RAW_MATERIAL",
      unitCostSnapshot: 0.05,
      officialUnitCostSnapshot: 0.05,
      totalCost: 0.05,
      quantity: 1,
    });
    const rolled = recalculateEngineeringCostRollup([parent, child]);
    const p = rolled.find((l) => l.id === "parent")!;
    assert.ok(Math.abs(p.totalCost - 0.295645) < 0.000001);
    assert.ok(Math.abs(p.unitCostSnapshot - 0.295645) < 0.000001);
  });

  it("sem alteração manual: projectDelta = 0 e simulado = motor oficial", () => {
    const motor = 1.309301;
    const l0 = line({
      id: "l0",
      parentLineId: null,
      unitCostSnapshot: 0.466661,
      officialUnitCostSnapshot: 0.466661,
      totalCost: 0.466661,
      countsInSimulatedProductCost: true,
    });
    const result = computeSimulatedProductIndustrialCost([l0], motor);
    assert.equal(result.totalProjectDelta, 0);
    assert.ok(Math.abs(result.simulatedIndustrialCost - motor) < 0.000001);
    assert.ok(Math.abs(result.preservedOfficialResidual - 0.84264) < 0.0001);
  });

  it("rollup inicial do componente pai preserva baseline oficial", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const comp = rolled.find((l) => l.id === "comp-311")!;
    assert.equal(comp.totalCost, 50);
    assert.equal(comp.unitCostSnapshot, 50);
  });

  it("custo de 1º nível sem alteração bate com soma oficial aberta", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const rootCost = sumSimulatedRootProductCost(rolled);
    assert.ok(Math.abs(rootCost - 309.301) < 0.01);
  });

  it("alterar material interno propaga delta ao pai sem marcar pai como alterado", () => {
    const base = build61202Fixture();
    const mat = base.find((l) => l.id === "mat-115")!;
    mat.unitCostSnapshot = 15;
    mat.isChangedFromOfficial = true;
    mat.totalCost = lineTotalFromParts(mat.quantity, mat.unitCostSnapshot, mat.lossPercent);

    const rolled = recalculateEngineeringCostRollup(base);
    const comp = rolled.find((l) => l.id === "comp-311")!;
    const matRolled = rolled.find((l) => l.id === "mat-115")!;

    assert.equal(matRolled.totalCost, 30);
    assert.equal(comp.totalCost, 60);
    assert.equal(comp.unitCostSnapshot, 50);
    assert.equal(matRolled.isChangedFromOfficial, true);
    assert.equal(comp.isChangedFromOfficial, false);

    const rollup = applyBaselineDeltaRollup(base);
    assert.equal(rollup.totalProjectDelta, 10);

    const rootCost = sumSimulatedRootProductCost(rolled);
    assert.ok(Math.abs(rootCost - 319.301) < 0.01);
  });

  it("custo total do projeto não duplica materiais internos", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const rollupSum = sumProjectRollupStructureCost(rolled);
    const naiveSum = rolled.reduce((s, l) => s + l.totalCost, 0);
    assert.ok(naiveSum > rollupSum);
    assert.ok(Math.abs(rollupSum - 309.301) < 0.01);
  });

  it("alteração propagada não retorna NaN nem Infinity", () => {
    const base = build61202Fixture();
    const mat = base.find((l) => l.id === "mat-121")!;
    mat.unitCostSnapshot = 45;
    mat.isChangedFromOfficial = true;
    mat.totalCost = lineTotalFromParts(mat.quantity, mat.unitCostSnapshot, mat.lossPercent);

    const rolled = recalculateEngineeringCostRollup(base);
    for (const l of rolled) {
      assert.equal(Number.isFinite(l.unitCostSnapshot), true);
      assert.equal(Number.isFinite(l.totalCost), true);
      assert.notEqual(l.unitCostSnapshot, Infinity);
      assert.notEqual(l.totalCost, Infinity);
    }
  });

  it("rollup não altera isChangedFromOfficial automaticamente", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    assert.ok(rolled.every((l) => !l.isChangedFromOfficial));
  });

  it("deriveUnitCostFromChildrenTotal é inverso de lineTotalFromParts", () => {
    const childrenTotal = 60;
    const unit = deriveUnitCostFromChildrenTotal(childrenTotal, 1, 0);
    assert.equal(lineTotalFromParts(1, unit, 0), childrenTotal);
  });

  it("isolamento: rollup é função pura sem prisma", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "projectsEngineeringCostRollup.ts"),
      "utf8"
    );
    assert.equal(src.includes("prisma."), false);
    assert.match(src, /applyBaselineDeltaRollup/);
  });
});
