import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BRAZIL_STATES, normalizeBrazilUf, parseBrazilUfFilter } from "./customerIndicators.js";

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

  it("os 27 estados entram no filtro e no clique do mapa", () => {
    assert.strictEqual(BRAZIL_STATES.length, 27);
    for (const state of BRAZIL_STATES) {
      assert.strictEqual(parseBrazilUfFilter(state.name), state.uf);
    }
    const page = readFileSync(join(process.cwd(), "src/components/CustomerModule.tsx"), "utf8");
    const map = readFileSync(
      join(process.cwd(), "src/components/contextual/customerActivityMap/CustomerActivityLeafletMap.tsx"),
      "utf8"
    );
    const section = readFileSync(
      join(process.cwd(), "src/components/contextual/customerActivityMap/CustomerActivityMapSection.tsx"),
      "utf8"
    );
    assert.match(page, /data-testid="customers-filter-state"/);
    assert.match(page, /q\.set\("state", stateFilter\)/);
    assert.match(map, /onStateClick\?\.\(uf, name \|\| uf\)/);
    assert.match(section, /CustomerStateCustomersOverlay/);
  });
});
