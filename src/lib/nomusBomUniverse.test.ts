import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON,
  isAutoRemovableObsoleteLocalLine,
  isCodeKnownInNomusUniverse,
} from "./nomusBomUniverse";

describe("nomusBomUniverse — universo Nomus", () => {
  const universe = new Set(["115.03--", "140.04--", "301.04AA", "301.08AA"]);

  it("isCodeKnownInNomusUniverse retorna true para código presente", () => {
    assert.equal(isCodeKnownInNomusUniverse("115.03--", universe), true);
    assert.equal(isCodeKnownInNomusUniverse("301.04AA", universe), true);
  });

  it("isCodeKnownInNomusUniverse retorna false para código ausente", () => {
    assert.equal(isCodeKnownInNomusUniverse("LOCAL.99--", universe), false);
  });

  it("linha no universo Nomus, não protegida → removível automaticamente", () => {
    assert.equal(
      isAutoRemovableObsoleteLocalLine({
        componentCode: "115.03--",
        nomusUniverse: universe,
      }),
      true
    );
  });

  it("linha fora do universo Nomus → não removível (local real)", () => {
    assert.equal(
      isAutoRemovableObsoleteLocalLine({
        componentCode: "LOCAL.99--",
        nomusUniverse: universe,
      }),
      false
    );
  });

  it("800.xx → não removível", () => {
    assert.equal(
      isAutoRemovableObsoleteLocalLine({
        componentCode: "800.01--",
        nomusUniverse: new Set(["800.01--"]),
      }),
      false
    );
  });

  it("localException=true → não removível", () => {
    assert.equal(
      isAutoRemovableObsoleteLocalLine({
        componentCode: "115.03--",
        localException: true,
        nomusUniverse: universe,
      }),
      false
    );
  });

  it("item operacional (montagem por descrição) → não removível", () => {
    assert.equal(
      isAutoRemovableObsoleteLocalLine({
        componentCode: "999.01--",
        componentDescription: "Montagem principal",
        nomusUniverse: new Set(["999.01--"]),
      }),
      false
    );
  });

  it("motivo padrão de auto-obsoleto está definido", () => {
    assert.match(AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON, /universo Nomus/i);
    assert.match(AUTO_OBSOLETE_NOMUS_UNIVERSE_REASON, /BOM efetiva Nomus/i);
  });
});
