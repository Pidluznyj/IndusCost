import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusParentStructureFingerprint,
  buildNomusStructureLineFingerprints,
  localLineMatchesDecisionSnapshot,
} from "./nomusBomStructureFingerprint.js";
import type { NomusEffectiveBomLine } from "./nomusBomComparison.js";

function stageLine(overrides: Partial<NomusEffectiveBomLine> & { componentCode: string }): NomusEffectiveBomLine {
  return {
    externalLineId: overrides.externalLineId ?? 1,
    parentCode: "610.04AA",
    componentCode: overrides.componentCode,
    componentDescription: null,
    quantity: overrides.quantity ?? 1,
    opcional: overrides.opcional ?? false,
    alternativo: overrides.alternativo ?? false,
    preferencial: overrides.preferencial ?? false,
    lossQuantity: overrides.lossQuantity ?? null,
    requiredQuantity: overrides.quantity ?? 1,
    listaMateriaisId: 10,
    listaMateriaisNome: "Lista A",
    posicao: 0,
    ...overrides,
  };
}

describe("nomusBomStructureFingerprint", () => {
  it("fingerprint estável quando só externalLineId muda", () => {
    const linesA = buildNomusStructureLineFingerprints([
      stageLine({ externalLineId: 100, componentCode: "307.07A", quantity: 2 }),
    ]);
    const linesB = buildNomusStructureLineFingerprints([
      stageLine({ externalLineId: 999, componentCode: "307.07A", quantity: 2 }),
    ]);
    const hashA = buildNomusParentStructureFingerprint({
      parentCode: "610.04AA",
      listaMateriaisId: 10,
      lines: linesA,
    });
    const hashB = buildNomusParentStructureFingerprint({
      parentCode: "610.04AA",
      listaMateriaisId: 10,
      lines: linesB,
    });
    assert.equal(hashA, hashB);
  });

  it("fingerprint muda quando quantidade muda", () => {
    const base = buildNomusStructureLineFingerprints([
      stageLine({ componentCode: "114.02", quantity: 0.001 }),
    ]);
    const changed = buildNomusStructureLineFingerprints([
      stageLine({ componentCode: "114.02", quantity: 0.002 }),
    ]);
    const hashBase = buildNomusParentStructureFingerprint({
      parentCode: "309.71AA",
      lines: base,
    });
    const hashChanged = buildNomusParentStructureFingerprint({
      parentCode: "309.71AA",
      lines: changed,
    });
    assert.notEqual(hashBase, hashChanged);
  });

  it("localLineMatchesDecisionSnapshot valida código e quantidade", () => {
    assert.equal(
      localLineMatchesDecisionSnapshot({
        componentCode: "307.07A",
        quantity: 1,
        decision: { componentCode: "307.07A", quantitySnapshot: 1 },
      }),
      true
    );
    assert.equal(
      localLineMatchesDecisionSnapshot({
        componentCode: "307.07A",
        quantity: 2,
        decision: { componentCode: "307.07A", quantitySnapshot: 1 },
      }),
      false
    );
  });
});
