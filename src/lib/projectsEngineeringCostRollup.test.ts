import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildCostBreakdown } from "./projectsCalculations.js";
import {
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
  it("rollup inicial do componente pai bate com soma dos materiais", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const comp = rolled.find((l) => l.id === "comp-311")!;
    assert.equal(comp.totalCost, 50);
    assert.equal(comp.unitCostSnapshot, 50);
  });

  it("custo inicial do produto raiz (1º nível) bate com custo oficial agregado", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const rootCost = sumSimulatedRootProductCost(rolled);
    assert.ok(Math.abs(rootCost - 309.301) < 0.01);
  });

  it("alterar custo unitário de material neto recalcula componente pai e raiz", () => {
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
    assert.equal(comp.unitCostSnapshot, 60);
    assert.equal(comp.isChangedFromOfficial, true);

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

  it("buildCostBreakdown ignora linhas profundas com countsInSimulatedProductCost=false", () => {
    const rolled = recalculateEngineeringCostRollup(build61202Fixture());
    const breakdown = buildCostBreakdown({
      structureLines: rolled.map((l) => ({
        lineType: l.lineType as "RAW_MATERIAL" | "COMPONENT",
        quantity: l.quantity,
        lossPercent: l.lossPercent,
        unitCostSnapshot: l.unitCostSnapshot,
        countsInSimulatedProductCost: l.countsInSimulatedProductCost,
      })),
      molds: [],
    });
    assert.ok(Math.abs(breakdown.unitCost - 309.301) < 0.05);
    assert.equal(Number.isFinite(breakdown.unitCost), true);
    assert.notEqual(breakdown.unitCost, 0);
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
    assert.match(src, /recalculateEngineeringCostRollup/);
  });
});
