import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMIL_DURATION,
  EMIL_EASE_OUT,
  emilCardVariants,
  emilOverlayEnter,
} from "./emilUiMotion.js";

describe("emilUiMotion", () => {
  it("usa ease-out forte e nunca escala de zero", () => {
    assert.deepEqual(EMIL_EASE_OUT, [0.23, 1, 0.32, 1]);
    assert.ok(EMIL_DURATION.overlay <= 0.3);
    assert.ok((emilOverlayEnter.scale as number) >= 0.95);
    assert.ok((emilCardVariants.hidden.scale as number) >= 0.95);
  });
});
