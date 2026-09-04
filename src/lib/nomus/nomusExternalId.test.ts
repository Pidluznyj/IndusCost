import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNomusExternalId,
  normalizeNomusExternalIdKey,
} from "./nomusExternalId.js";

test("normalizeNomusExternalId — number inteiro válido", () => {
  const r = normalizeNomusExternalId(4001);
  assert.deepEqual(r, { key: "4001", numeric: 4001, valid: true });
});

test("normalizeNomusExternalId — string numérica com espaços", () => {
  const r = normalizeNomusExternalId("  4001 ");
  assert.equal(r.valid, true);
  assert.equal(r.key, "4001");
  assert.equal(r.numeric, 4001);
});

test("normalizeNomusExternalId — zeros à esquerda em número puro são normalizados (mesmo valor numérico)", () => {
  const r = normalizeNomusExternalId("007");
  assert.equal(r.valid, true);
  assert.equal(r.key, "7");
  assert.equal(r.numeric, 7);
});

test("normalizeNomusExternalId — código alfanumérico preservado literalmente (nunca vira 0)", () => {
  const r = normalizeNomusExternalId("MP-0001");
  assert.equal(r.valid, true);
  assert.equal(r.key, "MP-0001");
  assert.equal(r.numeric, null);
});

test("normalizeNomusExternalId — null/undefined nunca viram string 'null'/'undefined'", () => {
  assert.deepEqual(normalizeNomusExternalId(null), { key: "", numeric: null, valid: false });
  assert.deepEqual(normalizeNomusExternalId(undefined), { key: "", numeric: null, valid: false });
});

test("normalizeNomusExternalId — string vazia é inválida, não vira 0", () => {
  const r = normalizeNomusExternalId("   ");
  assert.equal(r.valid, false);
  assert.notEqual(r.key, "0");
});

test("normalizeNomusExternalId — NaN/Infinity são inválidos", () => {
  assert.equal(normalizeNomusExternalId(Number.NaN).valid, false);
  assert.equal(normalizeNomusExternalId(Number.POSITIVE_INFINITY).valid, false);
});

test("normalizeNomusExternalId — objeto/array não numérico é inválido", () => {
  assert.equal(normalizeNomusExternalId({}).valid, false);
  assert.equal(normalizeNomusExternalId([1, 2]).valid, false);
});

test("normalizeNomusExternalIdKey — atalho retorna null quando inválido", () => {
  assert.equal(normalizeNomusExternalIdKey(null), null);
  assert.equal(normalizeNomusExternalIdKey("4001"), "4001");
});

test("normalizeNomusExternalId — number e string do mesmo id numérico produzem a mesma key (comparável entre fontes)", () => {
  const fromNumber = normalizeNomusExternalId(4001);
  const fromString = normalizeNomusExternalId("4001");
  assert.equal(fromNumber.key, fromString.key);
});
