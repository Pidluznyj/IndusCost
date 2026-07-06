import test from "node:test";
import assert from "node:assert/strict";
import { parseNomusPtBrNumber } from "./nomusNumberParser.ts";

test("parseNomusPtBrNumber parses thousands-only with dot", () => {
  assert.equal(parseNomusPtBrNumber("2.376"), 2376);
});

test("parseNomusPtBrNumber parses unit text with decimal comma", () => {
  assert.equal(parseNomusPtBrNumber("5,9400 por PC"), 5.94);
});

