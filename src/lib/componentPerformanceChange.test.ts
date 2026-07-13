import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProcessCompletionDefaults,
  ComponentPerformanceValidationError,
  diffProcessSnapshots,
  mergeProcessSnapshot,
  parseComponentPerformancePatchBody,
  snapshotFromProduct,
  validateMergedProcessSnapshot,
  validatePositiveFieldsWhenPresent,
} from "./componentPerformanceChange.js";

describe("componentPerformanceChange — parse e diff", () => {
  it("parse exige responsiblePersonName", () => {
    assert.throws(
      () =>
        parseComponentPerformancePatchBody({
          cycleTimeSeconds: 40,
          responsiblePersonName: "",
        }),
      (error: unknown) =>
        error instanceof ComponentPerformanceValidationError &&
        error.code === "RESPONSIBLE_REQUIRED"
    );
  });

  it("parse exige ao menos um campo produtivo", () => {
    assert.throws(
      () =>
        parseComponentPerformancePatchBody({
          responsiblePersonName: "João da Produção",
        }),
      (error: unknown) =>
        error instanceof ComponentPerformanceValidationError && error.code === "NO_FIELDS"
    );
  });

  it("diff detecta mudança de ciclo e cavidades juntos", () => {
    const before = snapshotFromProduct({
      cycleTimeSeconds: 45,
      cavities: 4,
      setupTimeMin: 10,
      efficiencyExpected: 95,
    });
    const after = { ...before, cycleTimeSeconds: 40, cavities: 2 };
    const changed = diffProcessSnapshots(before, after);
    assert.deepEqual(changed, ["cycleTimeSeconds", "cavities"]);
  });

  it("diff vazio quando valores iguais", () => {
    const snap = snapshotFromProduct({
      cycleTimeSeconds: 45,
      cavities: 4,
      setupTimeMin: 10,
      efficiencyExpected: 95,
    });
    assert.deepEqual(diffProcessSnapshots(snap, snap), []);
  });

  it("merge preserva campos não enviados", () => {
    const current = snapshotFromProduct({
      cycleTimeSeconds: 45,
      cavities: 4,
      setupTimeMin: 10,
      efficiencyExpected: 95,
    });
    const patch = parseComponentPerformancePatchBody({
      cycleTimeSeconds: 40,
      responsiblePersonName: "João da Produção",
    });
    const merged = mergeProcessSnapshot(current, patch);
    assert.equal(merged.cycleTimeSeconds, 40);
    assert.equal(merged.cavities, 4);
    assert.equal(merged.setupTimeMin, 10);
    assert.equal(merged.efficiencyExpected, 95);
    validateMergedProcessSnapshot(merged);
  });

  it("rejeita ciclo inválido quando enviado", () => {
    const patch = parseComponentPerformancePatchBody({
      cycleTimeSeconds: 0,
      responsiblePersonName: "João",
    });
    assert.throws(
      () => validatePositiveFieldsWhenPresent(patch),
      (error: unknown) =>
        error instanceof ComponentPerformanceValidationError && error.code === "INVALID_CYCLE"
    );
  });

  it("applyProcessCompletionDefaults preenche setup/eficiência ausentes", () => {
    const incomplete = snapshotFromProduct({
      cycleTimeSeconds: 59,
      cavities: 16,
      setupTimeMin: null,
      efficiencyExpected: 80,
    });
    assert.throws(() => validateMergedProcessSnapshot(incomplete));
    const completed = applyProcessCompletionDefaults(incomplete);
    assert.equal(completed.setupTimeMin, 0);
    assert.equal(completed.efficiencyExpected, 80);
    validateMergedProcessSnapshot(completed);
  });
});
