import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTreasuryProjectionSourceVersion } from "./treasuryProjectionSourceHash.js";
import { buildTreasuryProjectionAdvisoryLockKeys } from "./treasuryProjectionLock.js";

describe("treasuryProjectionSourceHash", () => {
  it("é estável independentemente da ordem das chaves", () => {
    const a = buildTreasuryProjectionSourceVersion({ b: 1, a: 2 });
    const b = buildTreasuryProjectionSourceVersion({ a: 2, b: 1 });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });
});

describe("treasuryProjectionLock", () => {
  it("deriva chaves determinísticas por empresa/cenário", () => {
    const x = buildTreasuryProjectionAdvisoryLockKeys("ACME", "PROBABLE");
    const y = buildTreasuryProjectionAdvisoryLockKeys("ACME", "PROBABLE");
    const z = buildTreasuryProjectionAdvisoryLockKeys("ACME", "CONTRACTUAL");
    assert.equal(x.key1, y.key1);
    assert.equal(x.key2, y.key2);
    assert.notEqual(`${x.key1}:${x.key2}`, `${z.key1}:${z.key2}`);
  });
});
