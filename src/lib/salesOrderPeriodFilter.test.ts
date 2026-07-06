import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SALES_ORDER_MONTH_OPTIONS,
  buildSalesOrderYearOptions,
  isValidSalesOrderMonth,
  isValidSalesOrderYear,
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
  resolveSalesOrderIssueDateRange,
} from "./salesOrderPeriodFilter.js";

describe("salesOrderPeriodFilter", () => {
  it("oferece 12 meses começando em Janeiro", () => {
    assert.equal(SALES_ORDER_MONTH_OPTIONS.length, 12);
    assert.deepEqual(SALES_ORDER_MONTH_OPTIONS[0], { value: 1, label: "Janeiro" });
    assert.deepEqual(SALES_ORDER_MONTH_OPTIONS[11], { value: 12, label: "Dezembro" });
  });

  it("anos vão do atual até atual-5 (6 opções)", () => {
    const years = buildSalesOrderYearOptions(2026, 5);
    assert.deepEqual(years, [2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("valida ano e mês", () => {
    assert.equal(isValidSalesOrderYear(2026), true);
    assert.equal(isValidSalesOrderYear(0), false);
    assert.equal(isValidSalesOrderYear(2026.5), false);
    assert.equal(isValidSalesOrderMonth(6), true);
    assert.equal(isValidSalesOrderMonth(0), false);
    assert.equal(isValidSalesOrderMonth(13), false);
  });

  it("parseia query params válidos e ignora inválidos", () => {
    assert.equal(parseSalesOrderYearParam("2026"), 2026);
    assert.equal(parseSalesOrderYearParam(["2026"]), 2026);
    assert.equal(parseSalesOrderYearParam("abc"), null);
    assert.equal(parseSalesOrderYearParam(""), null);
    assert.equal(parseSalesOrderMonthParam("6"), 6);
    assert.equal(parseSalesOrderMonthParam("13"), null);
    assert.equal(parseSalesOrderMonthParam("0"), null);
  });

  it("só ano: [ano-01-01, (ano+1)-01-01)", () => {
    const range = resolveSalesOrderIssueDateRange(2026, null);
    assert.ok(range);
    assert.deepEqual(range, {
      gte: new Date(2026, 0, 1, 0, 0, 0, 0),
      lt: new Date(2027, 0, 1, 0, 0, 0, 0),
    });
  });

  it("ano + mês: [ano-mês-01, próximo mês-01)", () => {
    const range = resolveSalesOrderIssueDateRange(2026, 6);
    assert.ok(range);
    assert.deepEqual(range, {
      gte: new Date(2026, 5, 1, 0, 0, 0, 0),
      lt: new Date(2026, 6, 1, 0, 0, 0, 0),
    });
  });

  it("dezembro vira corretamente para janeiro do ano seguinte", () => {
    const range = resolveSalesOrderIssueDateRange(2026, 12);
    assert.ok(range);
    assert.deepEqual(range, {
      gte: new Date(2026, 11, 1, 0, 0, 0, 0),
      lt: new Date(2027, 0, 1, 0, 0, 0, 0),
    });
    assert.equal(range!.lt.getFullYear(), 2027);
    assert.equal(range!.lt.getMonth(), 0);
  });

  it("ano inválido => null (mês isolado é ignorado sem ano)", () => {
    assert.equal(resolveSalesOrderIssueDateRange(null, 6), null);
    assert.equal(resolveSalesOrderIssueDateRange(undefined, 6), null);
    assert.equal(resolveSalesOrderIssueDateRange(0, 6), null);
  });

  it("mês inválido com ano válido cai para o ano inteiro", () => {
    const range = resolveSalesOrderIssueDateRange(2026, 13);
    assert.deepEqual(range, {
      gte: new Date(2026, 0, 1, 0, 0, 0, 0),
      lt: new Date(2027, 0, 1, 0, 0, 0, 0),
    });
  });
});
