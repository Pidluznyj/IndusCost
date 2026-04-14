import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avgScenarioAdjustments, newProductSnapshotCounts } from "./simulationIndicatorsStats";

describe("simulationIndicatorsStats", () => {
  it("média de ajustes e contagem de snapshots", () => {
    const avg = avgScenarioAdjustments([
      { id: "1", name: "a", materialAdj: 10, laborAdj: 0, indirectAdj: 0, efficiencyAdj: 0, marginAdj: 0 },
      { id: "2", name: "b", materialAdj: 30, laborAdj: 0, indirectAdj: 0, efficiencyAdj: 0, marginAdj: 0 },
    ]);
    assert.equal(avg.mp, 20);
    const c = newProductSnapshotCounts([
      { id: "x", name: "n", status: "SAVED" },
      { id: "y", name: "d", status: "DRAFT" },
    ]);
    assert.equal(c.saved, 1);
    assert.equal(c.draft, 1);
  });
});
