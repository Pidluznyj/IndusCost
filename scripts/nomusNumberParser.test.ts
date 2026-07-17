import test from "node:test";
import assert from "node:assert/strict";
import { parseNomusPtBrNumber } from "./nomusNumberParser.ts";

test("parseNomusPtBrNumber parses thousands-only with dot", () => {
  assert.equal(parseNomusPtBrNumber("2.376"), 2376);
});

test("parseNomusPtBrNumber parses unit text with decimal comma", () => {
  assert.equal(parseNomusPtBrNumber("5,9400 por PC"), 5.94);
});

test('parseNomusPtBrNumber: "117.000,00" → 117000', () => {
  assert.equal(parseNomusPtBrNumber("117.000,00"), 117000);
});

test('parseNomusPtBrNumber: "1.234,56" → 1234.56', () => {
  assert.equal(parseNomusPtBrNumber("1.234,56"), 1234.56);
});

test('parseNomusPtBrNumber: "117.000" (milhares BR) → 117000', () => {
  assert.equal(parseNomusPtBrNumber("117.000"), 117000);
});

test('parseNomusPtBrNumber: "0,00" → 0', () => {
  assert.equal(parseNomusPtBrNumber("0,00"), 0);
});

test("parseNomusPtBrNumber: null e string vazia → 0", () => {
  assert.equal(parseNomusPtBrNumber(null), 0);
  assert.equal(parseNomusPtBrNumber(""), 0);
  assert.equal(parseNomusPtBrNumber("   "), 0);
});

