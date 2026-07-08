import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFinanceKpiCurrency,
  formatFinanceKpiVariationPercent,
} from "./financeKpiFormat.js";

describe("formatFinanceKpiCurrency", () => {
  it("formata valores abaixo de 10 mil com 2 casas decimais", () => {
    assert.equal(formatFinanceKpiCurrency(942.81), "R$\u00a0942,81");
    assert.equal(formatFinanceKpiCurrency(0), "R$\u00a00,00");
  });

  it("formata milhares com sufixo mil e 1 casa decimal", () => {
    assert.equal(formatFinanceKpiCurrency(12_400), "R$\u00a012,4\u00a0mil");
    assert.equal(formatFinanceKpiCurrency(827_500), "R$\u00a0827,5\u00a0mil");
    assert.equal(formatFinanceKpiCurrency(284_900), "R$\u00a0284,9\u00a0mil");
    assert.equal(formatFinanceKpiCurrency(449_300), "R$\u00a0449,3\u00a0mil");
  });

  it("formata milhões com sufixo Mi e 2 casas decimais", () => {
    assert.equal(formatFinanceKpiCurrency(1_300_000), "R$\u00a01,30\u00a0Mi");
    assert.equal(formatFinanceKpiCurrency(5_830_000), "R$\u00a05,83\u00a0Mi");
    assert.equal(formatFinanceKpiCurrency(14_010_000), "R$\u00a014,01\u00a0Mi");
    assert.equal(formatFinanceKpiCurrency(9_630_000), "R$\u00a09,63\u00a0Mi");
  });

  it("compacto usa espaço inseparável para evitar quebra feia em cards", () => {
    const july = formatFinanceKpiCurrency(449_300);
    assert.doesNotMatch(july, /R\$ 449,3 mil/);
    assert.match(july, /\u00a0/);
  });

  it("não exibe valor longo para grandes montantes", () => {
    const formatted = formatFinanceKpiCurrency(5_827_010.62);
    assert.doesNotMatch(formatted, /5\.827\.010/);
    assert.match(formatted, /Mi$/);
  });

  it("retorna traço para null, undefined ou não finito", () => {
    assert.equal(formatFinanceKpiCurrency(null), "—");
    assert.equal(formatFinanceKpiCurrency(undefined), "—");
    assert.equal(formatFinanceKpiCurrency(NaN), "—");
    assert.equal(formatFinanceKpiCurrency(Infinity), "—");
    assert.doesNotMatch(formatFinanceKpiCurrency(null), /NaN/);
  });
});

describe("formatFinanceKpiVariationPercent", () => {
  it("inclui sinal positivo e formata com 1 casa decimal", () => {
    assert.equal(formatFinanceKpiVariationPercent(12.4), "+12,4%");
    assert.equal(formatFinanceKpiVariationPercent(-8.1), "-8,1%");
  });

  it("retorna mensagem sem base para divisor inválido", () => {
    assert.equal(formatFinanceKpiVariationPercent(null), "Sem base comparativa");
    assert.equal(formatFinanceKpiVariationPercent(NaN), "Sem base comparativa");
    assert.doesNotMatch(formatFinanceKpiVariationPercent(null), /NaN/);
    assert.doesNotMatch(formatFinanceKpiVariationPercent(null), /Infinity/);
  });
});
