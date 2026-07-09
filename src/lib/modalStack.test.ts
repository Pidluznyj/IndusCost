import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODAL_Z_INDEX_BASE,
  MODAL_Z_INDEX_ELEVATED,
  MODAL_Z_INDEX_STACKED,
  resolveModalStackZIndex,
} from "./modalStack.js";

describe("modalStack", () => {
  it("resolve camadas padrão de z-index", () => {
    assert.equal(MODAL_Z_INDEX_BASE, "z-50");
    assert.equal(MODAL_Z_INDEX_ELEVATED, "z-[60]");
    assert.equal(MODAL_Z_INDEX_STACKED, "z-[85]");
    assert.equal(resolveModalStackZIndex(false), MODAL_Z_INDEX_BASE);
    assert.equal(resolveModalStackZIndex(true), MODAL_Z_INDEX_STACKED);
  });
});
