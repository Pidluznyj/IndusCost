import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySelectAllEligible,
  eligibleWorklistRowIds,
  supplierEvaluationSelectAllState,
} from "./supplierEvaluationWorklistSelection.js";

const rows = [
  { nomusPurchaseOrderId: "a", eligible: true },
  { nomusPurchaseOrderId: "b", eligible: false },
  { nomusPurchaseOrderId: "c", eligible: true },
];

describe("supplier evaluation worklist selection", () => {
  it("select-all considera só pedidos elegíveis da página", () => {
    assert.deepEqual(eligibleWorklistRowIds(rows), ["a", "c"]);
  });

  it("nenhum elegível: checkbox desligado e desabilitado", () => {
    const state = supplierEvaluationSelectAllState([], { a: true });
    assert.deepEqual(state, { checked: false, indeterminate: false, disabled: true });
  });

  it("todos os elegíveis marcados: checked", () => {
    const state = supplierEvaluationSelectAllState(["a", "c"], { a: true, c: true });
    assert.equal(state.checked, true);
    assert.equal(state.indeterminate, false);
    assert.equal(state.disabled, false);
  });

  it("parte dos elegíveis: indeterminate", () => {
    const state = supplierEvaluationSelectAllState(["a", "c"], { a: true });
    assert.equal(state.checked, false);
    assert.equal(state.indeterminate, true);
  });

  it("marcar todos não apaga seleção de outra página", () => {
    const next = applySelectAllEligible({ other: true }, ["a", "c"], true);
    assert.deepEqual(next, { other: true, a: true, c: true });
  });

  it("desmarcar todos só desliga os elegíveis da página", () => {
    const next = applySelectAllEligible({ other: true, a: true, c: true }, ["a", "c"], false);
    assert.equal(next.other, true);
    assert.equal(next.a, false);
    assert.equal(next.c, false);
  });
});
