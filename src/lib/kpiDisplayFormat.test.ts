import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
  formatKpiShortDate,
} from "./kpiDisplayFormat.js";

describe("kpiDisplayFormat", () => {
  it("moeda abaixo de 10 mil mostra valor completo sem title", () => {
    const r = formatKpiCompactCurrency(5249.99);
    assert.match(r.display, /5\.249,99/);
    assert.equal(r.title, null);
    assert.equal(r.isCompact, false);
  });

  it("moeda grande usa compacto com title completo", () => {
    const r = formatKpiCompactCurrency(524_199.99);
    assert.equal(r.display, "R$ 524,2 mil");
    assert.match(r.title!, /524\.199,99/);
    assert.equal(r.isCompact, true);
  });

  it("moeda acima de 1 Mi usa sufixo Mi", () => {
    const r = formatKpiCompactCurrency(1_200_000);
    assert.equal(r.display, "R$ 1,20 Mi");
    assert.match(r.title!, /1\.200\.000,00/);
  });

  it("quantidade grande usa compacto com title", () => {
    const r = formatKpiCompactNumber(187_235);
    assert.equal(r.display, "187,2 mil");
    assert.equal(r.title, "187.235");
  });

  it("quantidade acima de 1 Mi", () => {
    const r = formatKpiCompactNumber(1_200_000);
    assert.equal(r.display, "1,2 Mi");
    assert.equal(r.title, "1.200.000");
  });

  it("percentual mantém até 2 casas", () => {
    const r = formatKpiCompactPercent(12.34);
    assert.equal(r.display, "12,34%");
    assert.equal(r.title, null);
  });

  it("formatKpiDisplayValue prefixa label quando compacto", () => {
    const formatted = formatKpiCompactCurrency(524_199.99);
    const { value, valueTitle, isCompact } = formatKpiDisplayValue(formatted, "Receita");
    assert.equal(value, "R$ 524,2 mil");
    assert.match(valueTitle!, /Receita:/);
    assert.equal(isCompact, true);
  });

  it("data formata pt-BR com title", () => {
    const r = formatKpiShortDate("2026-06-18");
    assert.equal(r.display, "18/06/2026");
    assert.equal(r.title, "18/06/2026");
  });

  it("null, NaN e Infinity retornam traço sem title", () => {
    assert.equal(formatKpiCompactCurrency(null).display, "—");
    assert.equal(formatKpiCompactNumber(NaN).display, "—");
    assert.equal(formatKpiCompactCurrency(Infinity).display, "—");
    assert.equal(formatKpiCompactPercent(undefined).display, "—");
  });
});
