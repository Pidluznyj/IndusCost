import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSimulatedProductRefNotes,
  GUIDED_REF_SIMULATED_PRODUCT_PREFIX,
} from "./projectsGuidedFlow.js";
import {
  computeSimulatedProductRefLineUpdate,
  resolveReferencedSimulatedProductUnitCost,
  sumNativeSimulatedProductStructureCost,
} from "./projectsSimulatedProductRefs.js";

const HASTE_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const TORNEIRA_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000002";

describe("projectsSimulatedProductRefs", () => {
  it("roll-up da Haste reflete soma das linhas do componente filho", () => {
    const childLines = [
      {
        simulatedProductId: HASTE_ID,
        snapshotRootProductId: null,
        totalCost: 12.5,
      },
      {
        simulatedProductId: HASTE_ID,
        snapshotRootProductId: null,
        totalCost: 7.5,
      },
    ];
    assert.equal(resolveReferencedSimulatedProductUnitCost(childLines, HASTE_ID), 20);
    assert.equal(sumNativeSimulatedProductStructureCost(childLines, HASTE_ID), 20);
  });

  it("linha de referência na Torneira IRIS usa custo agregado do filho", () => {
    const allLines = [
      {
        id: "mp1",
        simulatedProductId: HASTE_ID,
        snapshotRootProductId: null,
        totalCost: 15,
      },
      {
        id: "ref1",
        simulatedProductId: TORNEIRA_ID,
        snapshotRootProductId: null,
        sourceType: "MANUAL",
        quantity: 1,
        lossPercent: 0,
        unitCostSnapshot: 0,
        totalCost: 0,
        notes: buildSimulatedProductRefNotes(HASTE_ID),
      },
    ];
    const update = computeSimulatedProductRefLineUpdate(allLines[1]!, allLines);
    assert.ok(update);
    assert.equal(update!.unitCostSnapshot, 15);
    assert.equal(update!.totalCost, 15);
    assert.equal(update!.isMissingCost, false);
  });

  it("recalculate dispara sincronização de referências simuladas", () => {
    const service = readFileSync(join(process.cwd(), "src", "lib", "projectsService.ts"), "utf8");
    assert.match(service, /persistSimulatedProductRefCostsForVersion/);
    assert.match(service, /computeSimulatedProductRefLineUpdate/);
    assert.match(service, /persistSimulatedProductRefCostsForVersion\(versionId\)/);
  });

  it("marcador de referência permanece estável", () => {
    assert.match(GUIDED_REF_SIMULATED_PRODUCT_PREFIX, /guided-ref-sim-product:/);
  });
});
