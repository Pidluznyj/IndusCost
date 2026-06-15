import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationRefNotes,
  isGuidedSimulationItem,
  parseSimulationIdFromNotes,
  resolveSimulationSnapshotUnitCost,
} from "./projectsSimulationRefs.js";

describe("projectsSimulationRefs", () => {
  const simulationId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("monta notas de referência à simulação", () => {
    const notes = buildSimulationRefNotes(simulationId);
    assert.match(notes, /guided-origin:SIMULATION/);
    assert.match(notes, /guided-simulation-id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
    assert.equal(isGuidedSimulationItem(notes), true);
    assert.equal(parseSimulationIdFromNotes(notes), simulationId);
  });

  it("resolve custo industrial do snapshot sem recalcular", () => {
    const cost = resolveSimulationSnapshotUnitCost({
      result: { costBase: 42.5 },
    });
    assert.equal(cost, 42.5);
    assert.equal(resolveSimulationSnapshotUnitCost({}), null);
    assert.equal(resolveSimulationSnapshotUnitCost(null), null);
  });
});
