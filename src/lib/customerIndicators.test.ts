import assert from "node:assert";
import { describe, it } from "node:test";
import { normalizeBrazilUf } from "./customerIndicators.js";

describe("customerIndicators", () => {
  it("normalizeBrazilUf: vazio → —", () => {
    assert.strictEqual(normalizeBrazilUf(null), "—");
    assert.strictEqual(normalizeBrazilUf("  "), "—");
  });
  it("normalizeBrazilUf: sigla", () => {
    assert.strictEqual(normalizeBrazilUf("sp"), "SP");
    assert.strictEqual(normalizeBrazilUf("RJ"), "RJ");
  });
  it("normalizeBrazilUf: nome completo", () => {
    assert.strictEqual(normalizeBrazilUf("São Paulo"), "SP");
    assert.strictEqual(normalizeBrazilUf("minas gerais"), "MG");
  });
});
