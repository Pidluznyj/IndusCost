import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCommercialCompactCurrency,
  formatCommercialCompactNumber,
  formatCommercialKpiValueWithTitle,
  formatCommercialShortDate,
} from "./commercialKpiFormat.js";

describe("commercialKpiFormat", () => {
  it("moeda abaixo de 10 mil mostra valor completo sem title", () => {
    const r = formatCommercialCompactCurrency(5249.99);
    assert.match(r.display, /5\.249,99/);
    assert.equal(r.title, null);
  });

  it("moeda grande usa compacto com title completo", () => {
    const r = formatCommercialCompactCurrency(524_199.99);
    assert.equal(r.display, "R$ 524,2 mil");
    assert.match(r.title!, /524\.199,99/);
  });

  it("moeda acima de 1 Mi usa sufixo Mi", () => {
    const r = formatCommercialCompactCurrency(1_200_000);
    assert.equal(r.display, "R$ 1,20 Mi");
    assert.match(r.title!, /1\.200\.000,00/);
  });

  it("quantidade grande usa compacto com title", () => {
    const r = formatCommercialCompactNumber(187_235);
    assert.equal(r.display, "187,2 mil");
    assert.equal(r.title, "187.235");
  });

  it("quantidade acima de 1 Mi", () => {
    const r = formatCommercialCompactNumber(1_200_000);
    assert.equal(r.display, "1,2 Mi");
    assert.equal(r.title, "1.200.000");
  });

  it("quantidade até 9999 permanece completa", () => {
    const r = formatCommercialCompactNumber(9999);
    assert.equal(r.display, "9.999");
    assert.equal(r.title, null);
  });

  it("formatCommercialKpiValueWithTitle prefixa label quando compacto", () => {
    const formatted = formatCommercialCompactCurrency(524_199.99);
    const { value, valueTitle } = formatCommercialKpiValueWithTitle(formatted, "Receita total");
    assert.equal(value, "R$ 524,2 mil");
    assert.match(valueTitle!, /Receita total:/);
    assert.match(valueTitle!, /524\.199,99/);
  });

  it("data formata pt-BR", () => {
    const r = formatCommercialShortDate("2026-06-18");
    assert.equal(r.display, "18/06/2026");
    assert.equal(r.title, "18/06/2026");
  });

  it("null e NaN retornam traço sem title", () => {
    assert.equal(formatCommercialCompactCurrency(null).display, "—");
    assert.equal(formatCommercialCompactNumber(NaN).display, "—");
    assert.equal(formatCommercialCompactCurrency(Infinity).display, "—");
  });
});
